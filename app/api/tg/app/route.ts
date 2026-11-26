import { NextResponse } from "next/server";
import { kvConfigured, kvGet } from "@/lib/kv";
import { tgReady, tgVerifyInitData, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };

/**
 * Telegram Mini App sign-in: ORBIT opened from an "Open in ORBIT" button inside Telegram.
 * Telegram signs who opened it (initData); if that Telegram account is connected to an active
 * ORBIT Ultra code, the app gets that code back, so Ultra unlocks with no typing.
 */
export async function POST(req: Request) {
  if (!tgReady() || !kvConfigured()) return NextResponse.json({ key: null }, { headers: nocache });
  const { initData } = (await req.json().catch(() => ({}))) as { initData?: string };
  const user = tgVerifyInitData(initData ?? "");
  if (!user) return NextResponse.json({ error: "Not signed by Telegram" }, { status: 401, headers: nocache });
  const id = await kvGet(`tgchat:${user}`);
  const raw = id ? await kvGet(`tgsub:${id}`) : null;
  const sub = raw ? (JSON.parse(raw) as TgSub) : null;
  const key = sub && sub.exp > Date.now() ? await kvGet(`tgkey:${id}`) : null;
  return NextResponse.json({ key: key ?? null }, { headers: nocache });
}
