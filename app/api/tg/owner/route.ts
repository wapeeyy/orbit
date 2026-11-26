import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { kvGet, kvPipeline } from "@/lib/kv";
import { subId, tgSend, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Owner only: mark the Telegram chat already connected with this owner code as the bot owner */
export async function POST(req: Request) {
  const key = keyFrom(req);
  if (key?.id !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const id = subId(req.headers.get("x-orbit-key")!);
  const raw = await kvGet(`tgsub:${id}`);
  if (!raw) return NextResponse.json({ error: "Connect Telegram in the app first" }, { status: 404 });
  const sub = JSON.parse(raw) as TgSub;
  sub.owner = true;
  await kvPipeline([
    ["SET", `tgsub:${id}`, JSON.stringify(sub)],
    ["SET", "tg:ownerchat", String(sub.chat)],
  ]);
  await tgSend(sub.chat, "You are now the ORBIT bot owner.\n\nOwner commands:\n/bindchannel — then post <code>/bind public</code> in your channel\nIn your Ultra group send <code>/bind ultra</code>\n/announce your text — post to the channel and the Ultra group\n/community — show what is connected");
  return NextResponse.json({ ok: true });
}
