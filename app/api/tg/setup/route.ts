import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { tgHookSecret, tgReady, tgToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Owner only: point the Telegram bot at /api/tg/hook (run once after setting TELEGRAM_BOT_TOKEN) */
export async function GET(req: Request) {
  if (keyFrom(req)?.id !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (!tgReady()) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_NAME in Vercel first" }, { status: 400 });
  const r = await fetch(`https://api.telegram.org/bot${tgToken()}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.orbitonsol.com/api/tg/hook", secret_token: tgHookSecret(), allowed_updates: ["message"] }),
  });
  return NextResponse.json(await r.json());
}
