import { NextResponse } from "next/server";
import { fetchCandles, volumeZone } from "@/lib/analysis";
import { isValidMint } from "@/lib/holders";

export const dynamic = "force-dynamic";

// Zon volume satu coin (15m x 2 hari). Disimpan di CDN Vercel 10 minit — dikongsi semua pengguna.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const pool = q.get("pool") ?? "";
  const token = q.get("token") ?? "";
  if (!isValidMint(pool) || !isValidMint(token)) return NextResponse.json({ error: "Alamat tak sah" }, { status: 400 });
  try {
    const zone = volumeZone(await fetchCandles(pool, token, "minute", 15, 192));
    return NextResponse.json({ zone }, { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=600" } });
  } catch (e) {
    const status = (e as { status?: number }).status === 429 ? 429 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status, headers: { "cache-control": "no-store" } });
  }
}
