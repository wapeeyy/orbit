import { NextResponse } from "next/server";
import { kvConfigured } from "@/lib/kv";
import { getCommunity, tgName, tgReady } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Public: link to the ORBIT Telegram community channel (for everyone) */
export async function GET() {
  if (!kvConfigured() || !tgReady()) return NextResponse.json({ channel: null });
  const c = await getCommunity();
  return NextResponse.json({ channel: c.public?.link ?? null, bot: `https://t.me/${tgName()}` }, { headers: { "cache-control": "public, max-age=300" } });
}
