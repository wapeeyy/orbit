import { NextResponse } from "next/server";
import { isValidMint } from "@/lib/holders";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";

export const dynamic = "force-dynamic";

// Shared, cached copy of a pool's last 300 trades: the Txns tab uses it when the browser is rate-limited
// by GeckoTerminal. One fetch per pool every 5 s for all viewers.
export async function GET(req: Request) {
  const pool = new URL(req.url).searchParams.get("pool") ?? "";
  if (!isValidMint(pool)) return NextResponse.json({ error: "Invalid pool" }, { status: 400 });
  const key = `trades:${pool}`;
  if (kvConfigured()) {
    const hit = await kvGet(key).catch(() => null);
    if (hit) return new NextResponse(hit, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-cache": "hit" } });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (r.ok) {
      const body = await r.text();
      if (kvConfigured()) await kvPipeline([["SET", key, body, "EX", 5]]).catch(() => {});
      return new NextResponse(body, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-cache": "miss" } });
    }
    if (r.status !== 429) return NextResponse.json({ error: `GeckoTerminal ${r.status}` }, { status: 502 });
    await new Promise((x) => setTimeout(x, 1500));
  }
  return NextResponse.json({ error: "rate" }, { status: 429 });
}
