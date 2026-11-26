import { NextResponse } from "next/server";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";

export const dynamic = "force-dynamic";

// Shared, cached copy of GeckoTerminal pair lists: used by the Discover table when the browser
// is rate-limited by GeckoTerminal. One fetch per list/page every 45 s for all visitors.
const PATHS: Record<string, string> = {
  trending: "trending_pools",
  new: "new_pools",
  volume: "pools?sort=h24_volume_usd_desc",
  txns: "pools?sort=h24_tx_count_desc",
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const list = q.get("list") ?? "";
  const page = Math.max(1, Math.min(10, Number(q.get("page")) || 1));
  const path = PATHS[list];
  if (!path) return NextResponse.json({ error: "Unknown list" }, { status: 400 });
  const key = `pairs:${list}:${page}`;
  if (kvConfigured()) {
    const hit = await kvGet(key).catch(() => null);
    if (hit) return new NextResponse(hit, { headers: { "content-type": "application/json", "cache-control": "public, max-age=20", "x-cache": "hit" } });
  }
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/${path}${path.includes("?") ? "&" : "?"}page=${page}&include=base_token,dex`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (r.ok) {
      const body = await r.text();
      if (kvConfigured()) await kvPipeline([["SET", key, body, "EX", 45]]).catch(() => {});
      return new NextResponse(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=20", "x-cache": "miss" } });
    }
    if (r.status !== 429) return NextResponse.json({ error: `GeckoTerminal ${r.status}` }, { status: 502 });
    await new Promise((x) => setTimeout(x, 2000));
  }
  return NextResponse.json({ error: "rate" }, { status: 429 });
}
