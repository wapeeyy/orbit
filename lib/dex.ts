export type DexPair = {
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  info?: { imageUrl?: string };
};

export type Market = {
  name: string;
  symbol: string;
  image?: string;
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number;
  mainPairLiquidityUsd: number | null;
  volume24h: number | null;
  change24h: number | null;
  dexId: string | null;
  url: string | null;
  pairCount: number;
  pairAddresses: Record<string, string>; // pairAddress -> dexId
};

export async function getMarket(mint: string): Promise<Market | null> {
  const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const pairs = ((await res.json()) as DexPair[]) ?? [];
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const main = sorted[0];
  const self = main.baseToken.address === mint ? main.baseToken : main.quoteToken;
  const pairAddresses: Record<string, string> = {};
  for (const p of pairs) pairAddresses[p.pairAddress] = p.dexId;

  return {
    name: self.name,
    symbol: self.symbol,
    image: main.info?.imageUrl,
    priceUsd: main.baseToken.address === mint && main.priceUsd ? Number(main.priceUsd) : null,
    marketCap: main.marketCap ?? null,
    fdv: main.fdv ?? null,
    liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0),
    mainPairLiquidityUsd: main.liquidity?.usd ?? null,
    volume24h: pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
    change24h: main.priceChange?.h24 ?? null,
    dexId: main.dexId,
    url: main.url,
    pairCount: pairs.length,
    pairAddresses,
  };
}
