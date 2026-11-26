import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { tgHookSecret, tgReady, tgToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Owner only: point the Telegram bot at /api/tg/hook (run once after setting TELEGRAM_BOT_TOKEN) */
export async function GET(req: Request) {
  if (keyFrom(req)?.id !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (!tgReady()) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_NAME in Vercel first" }, { status: 400 });
  // check the token first (never returns the token itself)
  const t = tgToken();
  const me = await (await fetch(`https://api.telegram.org/bot${t}/getMe`)).json();
  if (!me.ok) {
    return NextResponse.json({
      error: "Telegram rejected TELEGRAM_BOT_TOKEN",
      telegram: me.description,
      tokenLooksValid: /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t),
      tokenLength: t.length,
    }, { status: 400 });
  }
  const r = await fetch(`https://api.telegram.org/bot${t}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.orbitonsol.com/api/tg/hook", secret_token: tgHookSecret(), allowed_updates: ["message", "channel_post", "chat_join_request"] }),
  });
  return NextResponse.json(await r.json());
}
