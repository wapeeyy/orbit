import { NextResponse } from "next/server";
import { keyFrom, signFree } from "@/lib/auth";
import { discover } from "@/lib/discover";
import { DEFAULTS, reasons } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const FREE_COINS = 3;

export async function GET(req: Request) {
  try {
    const data = await discover();
    if (keyFrom(req)) {
      // Pelanggan: senarai penuh (jangan simpan di CDN — bergantung pada kod akses)
      return NextResponse.json({ ...data, locked: null }, { headers: { "cache-control": "private, no-store" } });
    }
    // Percuma: 3 coin teratas yang lulus penapis lalai, selebihnya dikunci
    const passed = data.candidates.filter((c) => reasons(c, DEFAULTS).length === 0);
    const free = passed.slice(0, FREE_COINS).map((c) => ({ ...c, free: signFree(c.ca) }));
    return NextResponse.json(
      {
        updatedAt: data.updatedAt,
        scanned: data.scanned,
        candidates: free,
        locked: { hidden: Math.max(0, passed.length - free.length), total: data.candidates.length },
      },
      { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
