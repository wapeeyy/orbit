import { NextResponse } from "next/server";
import { isValidMint } from "@/lib/holders";
import { SOL_MINT } from "@/lib/pay";

export const dynamic = "force-dynamic";

type Pair = {
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  info?: { imageUrl?: string };
  pairAddress: string;
};

/** Harga semasa (USD & SOL) untuk demo trade: /api/price?cas=a,b,c (maks 30) */
export async function GET(req: Request) {
  const cas = (new URL(req.url).searchParams.get("cas") ?? "").split(",").filter(isValidMint).slice(0, 29);
  const ids = [SOL_MINT, ...cas.filter((c) => c !== SOL_MINT)];
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${ids.join(",")}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`DexScreener ${r.status}`);
    const pairs = (await r.json()) as Pair[];
    const best = new Map<string, Pair>();
    for (const p of pairs) {
      const cur = best.get(p.baseToken.address);
      if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(p.baseToken.address, p);
    }
    const solUsd = Number(best.get(SOL_MINT)?.priceUsd ?? 0);
    const prices: Record<string, { usd: number; sol: number; symbol: string; name: string; image?: string; liq: number }> = {};
    for (const ca of cas) {
      const p = best.get(ca);
      if (!p?.priceUsd) continue;
      const usd = Number(p.priceUsd);
      const sol = p.quoteToken.address === SOL_MINT && p.priceNative ? Number(p.priceNative) : solUsd ? usd / solUsd : 0;
      prices[ca] = { usd, sol, symbol: p.baseToken.symbol, name: p.baseToken.name, image: p.info?.imageUrl, liq: p.liquidity?.usd ?? 0 };
    }
    return NextResponse.json({ solUsd, prices }, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
