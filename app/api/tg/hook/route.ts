import { NextResponse } from "next/server";
import { kvGet, kvPipeline } from "@/lib/kv";
import { SITE, esc, getCommunity, setCommunity, tgCall, tgHookSecret, tgName, tgSend, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type Chat = { id: number; type: string; title?: string; username?: string };
type Msg = { chat: Chat; from?: { id: number }; text?: string };
type Update = { message?: Msg; channel_post?: Msg; chat_join_request?: { chat: Chat; from: { id: number }; user_chat_id: number } };

const isOwner = async (userId?: number) => !!userId && String(userId) === (await kvGet("tg:ownerchat"));

async function inviteLink(chat: Chat, joinRequest: boolean) {
  if (chat.username && !joinRequest) return `https://t.me/${chat.username}`;
  const r = await tgCall<{ invite_link: string }>("createChatInviteLink", { chat_id: chat.id, name: joinRequest ? "ORBIT Ultra (approved by bot)" : "ORBIT community", ...(joinRequest ? { creates_join_request: true } : {}) });
  return r.result?.invite_link;
}

/** Owner: make this chat the public channel / the private Ultra group */
async function bind(chat: Chat, which: "public" | "ultra") {
  const c = await getCommunity();
  c[which] = { id: chat.id, title: chat.title ?? which, link: await inviteLink(chat, which === "ultra") };
  await setCommunity(c);
  if (which === "ultra" && c.ultra?.link) {
    // invite every active Ultra subscriber who already connected Telegram
    const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
    let n = 0;
    for (const id of ids ?? []) {
      const raw = await kvGet(`tgsub:${id}`);
      if (!raw) continue;
      const s = JSON.parse(raw) as TgSub;
      if (!s.chat || s.exp < Date.now() || s.invited === chat.id) continue;
      if (await tgSend(s.chat, "<b>The ORBIT Ultra group is open.</b>\nLive whale trades, community buying waves and wallet rushes on trending coins. Tap the button — the bot lets you in automatically.", { text: "Join ORBIT Ultra", url: c.ultra.link })) {
        s.invited = chat.id;
        await kvPipeline([["SET", `tgsub:${id}`, JSON.stringify(s)]]);
        n++;
      }
    }
    const owner = await kvGet("tg:ownerchat");
    if (owner) await tgSend(owner, `Ultra group bound. Invite sent to ${n} Ultra subscriber(s) already on Telegram; new ones get it when they connect.`);
  }
  await tgSend(chat.id, which === "ultra"
    ? "<b>This is now the ORBIT Ultra group.</b>\nMembers join through a link in the ORBIT app; the bot approves Ultra subscribers only and removes them when Ultra ends. Live whale trades, community buying and wallet rushes on trending coins are posted here."
    : "<b>This is now the ORBIT community channel.</b>\nUpdates, new features and the daily ORBIT reads are posted here.");
}

/** Telegram webhook */
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== tgHookSecret()) return new NextResponse(null, { status: 401 });
  const u = (await req.json().catch(() => null)) as Update | null;
  if (!u) return NextResponse.json({ ok: true });

  // join requests to the Ultra group: approve active Ultra subscribers only
  if (u.chat_join_request) {
    const { chat, from, user_chat_id } = u.chat_join_request;
    const c = await getCommunity();
    if (c.ultra?.id !== chat.id) return NextResponse.json({ ok: true });
    const id = await kvGet(`tgchat:${from.id}`);
    const sub = id ? ((JSON.parse((await kvGet(`tgsub:${id}`)) ?? "null") as TgSub | null)) : null;
    if (sub && sub.exp > Date.now()) {
      await tgCall("approveChatJoinRequest", { chat_id: chat.id, user_id: from.id });
      await tgSend(user_chat_id, "Welcome to <b>ORBIT Ultra</b>. Live whale trades and buying waves on trending coins are posted in the group; your personal alerts keep coming here.");
    } else {
      await tgCall("declineChatJoinRequest", { chat_id: chat.id, user_id: from.id });
      await tgSend(user_chat_id, "The ORBIT Ultra group is for Ultra subscribers. Get Ultra in the ORBIT app, connect Telegram (Pro tab), then use the Join button there.", { text: "Get ORBIT Ultra", url: `${SITE}/?tab=sub&src=tg-join` });
    }
    return NextResponse.json({ ok: true });
  }

  // channel posts: only "/bind public", and only right after the owner asked for it in private chat
  if (u.channel_post?.text) {
    const p = u.channel_post;
    if (/^\/bind(@\w+)?\s+public\b/i.test(p.text!.trim()) && (await kvGet("tg:bindarm"))) {
      await bind(p.chat, "public");
      await kvPipeline([["DEL", "tg:bindarm"]]);
      const owner = await kvGet("tg:ownerchat");
      if (owner) await tgSend(owner, `Bound <b>${esc(p.chat.title ?? "channel")}</b> as the ORBIT community channel.`);
      await tgCall("deleteMessage", { chat_id: p.chat.id, message_id: (p as unknown as { message_id: number }).message_id });
    }
    return NextResponse.json({ ok: true });
  }

  const msg = u.message;
  if (!msg?.text) return NextResponse.json({ ok: true });
  const chat = msg.chat;
  const text = msg.text.trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.replace(new RegExp(`@${tgName()}$`, "i"), "").toLowerCase();

  // in a group: "/bind ultra" or "/bind public" by the owner
  if (chat.type === "group" || chat.type === "supergroup") {
    if (cmd === "/bind" && (await isOwner(msg.from?.id))) {
      const which = rest[0]?.toLowerCase() === "public" ? "public" : "ultra";
      await bind(chat, which);
    }
    return NextResponse.json({ ok: true });
  }

  // private chat
  if (cmd === "/start" && rest[0]) {
    const link = await kvGet(`tglink:${rest[0]}`);
    if (!link) {
      await tgSend(chat.id, "This link has expired. Open ORBIT → Pro tab → Telegram alerts and tap Connect again.");
      return NextResponse.json({ ok: true });
    }
    const { id, exp, owner } = JSON.parse(link) as { id: string; exp: number; owner?: boolean };
    const old = await kvGet(`tgsub:${id}`);
    const c0 = await getCommunity();
    const sub: TgSub = old ? { ...(JSON.parse(old) as TgSub), chat: chat.id, exp, owner } : { chat: chat.id, exp, owner, alerts: [], wallets: [] };
    if (c0.ultra?.link) sub.invited = c0.ultra.id; // the welcome message below carries the Join button
    await kvPipeline([
      ["SET", `tgsub:${id}`, JSON.stringify(sub)],
      ["SADD", "tgsubs", id],
      ["SET", `tgchat:${chat.id}`, id],
      ["DEL", `tglink:${rest[0]}`],
      ...(owner ? [["SET", "tg:ownerchat", String(chat.id)]] : []),
    ]);
    const c = await getCommunity();
    await tgSend(
      chat.id,
      `<b>ORBIT connected.</b>\nPrice alerts, followed wallets and live signals on your watchlist will arrive here, even when the app is closed.\nSend /stop to disconnect.${c.ultra?.link ? "\n\nYou can also join the private ORBIT Ultra group:" : ""}`,
      c.ultra?.link ? { text: "Join ORBIT Ultra", url: c.ultra.link } : undefined,
    );
    if (owner) await tgSend(chat.id, "Owner commands:\n/announce your text — post to the channel and the Ultra group\n/bindchannel — then post <code>/bind public</code> in your channel\nIn your Ultra group send <code>/bind ultra</code>\n/community — show what is connected");
    return NextResponse.json({ ok: true });
  }
  if (cmd === "/stop") {
    const id = await kvGet(`tgchat:${chat.id}`);
    if (id) await kvPipeline([["DEL", `tgsub:${id}`], ["SREM", "tgsubs", id], ["DEL", `tgchat:${chat.id}`]]);
    await tgSend(chat.id, "Disconnected. You will not get ORBIT alerts here any more.");
    return NextResponse.json({ ok: true });
  }
  if (await isOwner(chat.id)) {
    if (cmd === "/bindchannel") {
      await kvPipeline([["SET", "tg:bindarm", "1", "EX", 600]]);
      await tgSend(chat.id, "Now post <code>/bind public</code> in your channel within 10 minutes (the bot must be an admin there). The bot deletes that post right away.");
      return NextResponse.json({ ok: true });
    }
    if (cmd === "/announce" && rest.length) {
      const c = await getCommunity();
      const body = esc(text.slice(cmdRaw.length).trim());
      const targets = [c.public?.id, c.ultra?.id].filter((x): x is number => !!x);
      for (const t of targets) await tgSend(t, body, { text: "Open ORBIT", url: `${SITE}/?src=tg-news` });
      await tgSend(chat.id, targets.length ? `Posted to ${targets.length} chat(s).` : "No channel or group is bound yet.");
      return NextResponse.json({ ok: true });
    }
    if (cmd === "/community") {
      const c = await getCommunity();
      await tgSend(chat.id, `Channel: ${c.public ? `${esc(c.public.title)} ${c.public.link ?? ""}` : "not bound"}\nUltra group: ${c.ultra ? `${esc(c.ultra.title)} ${c.ultra.link ?? ""}` : "not bound"}`);
      return NextResponse.json({ ok: true });
    }
  }
  const c = await getCommunity();
  await tgSend(chat.id, "ORBIT alerts bot. Connect from the ORBIT app: Pro tab → Telegram alerts → Connect.", c.public?.link ? { text: "ORBIT community", url: c.public.link } : { text: "Open ORBIT", url: SITE });
  return NextResponse.json({ ok: true });
}
