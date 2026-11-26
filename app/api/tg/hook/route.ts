import { NextResponse } from "next/server";
import { kvGet, kvPipeline } from "@/lib/kv";
import { tgHookSecret, tgSend, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Telegram webhook: /start <code> links a chat to an Ultra subscriber, /stop unlinks it */
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== tgHookSecret()) return new NextResponse(null, { status: 401 });
  const u = (await req.json().catch(() => null)) as { message?: { chat: { id: number }; text?: string } } | null;
  const msg = u?.message;
  if (!msg?.text) return NextResponse.json({ ok: true });
  const chat = msg.chat.id;
  const [cmd, code] = msg.text.trim().split(/\s+/);

  if (cmd === "/start" && code) {
    const link = await kvGet(`tglink:${code}`);
    if (!link) {
      await tgSend(chat, "This link has expired. Open ORBIT → Subscribe → Telegram alerts and tap Connect again.");
      return NextResponse.json({ ok: true });
    }
    const { id, exp } = JSON.parse(link) as { id: string; exp: number };
    const old = await kvGet(`tgsub:${id}`);
    const sub: TgSub = old ? { ...(JSON.parse(old) as TgSub), chat, exp } : { chat, exp, alerts: [], wallets: [] };
    await kvPipeline([
      ["SET", `tgsub:${id}`, JSON.stringify(sub)],
      ["SADD", "tgsubs", id],
      ["SET", `tgchat:${chat}`, id],
      ["DEL", `tglink:${code}`],
    ]);
    await tgSend(chat, "<b>ORBIT connected.</b>\nYour price alerts and smart-money wallets will arrive here, even when the app is closed.\nSend /stop to disconnect.");
    return NextResponse.json({ ok: true });
  }
  if (cmd === "/stop") {
    const id = await kvGet(`tgchat:${chat}`);
    if (id) await kvPipeline([["DEL", `tgsub:${id}`], ["SREM", "tgsubs", id], ["DEL", `tgchat:${chat}`]]);
    await tgSend(chat, "Disconnected. You will not get ORBIT alerts here any more.");
    return NextResponse.json({ ok: true });
  }
  await tgSend(chat, "ORBIT alerts bot. Connect from the ORBIT app: Subscribe → Telegram alerts → Connect.");
  return NextResponse.json({ ok: true });
}
