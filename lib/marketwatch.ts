import { parseTrades, type WhaleTrade } from "./whales";

// Live market signals for Telegram alerts: GeckoTerminal pool activity + big trades, DexScreener prices.
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const H = { accept: "application/json" };

export type PoolAct = {
  pool: string;
  m5: { buys: number; sells: number; buyers: number };
  h1: { buys: number; sells: number; buyers: number };
  volM5: number;
  volH1: number;
  chM5: number;
};

async function gt(path: string) {
  let r = await fetch(GT + path, { headers: H, cache: "no-store" });
  if (r.status === 429) {
    await new Promise((x) => setTimeout(x, 2500));
    r = await fetch(GT + path, { headers: H, cache: "no-store" });
  }
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  return r.json();
}

export async function trending(n = 10): Promise<{ pool: string; ca: string; symbol: string; liq: number }[]> {
  const j = await gt(`/trending_pools?page=1&include=base_token`);
  const toks = new Map<string, { address: string; symbol: string }>((j.included ?? []).map((t: { id: string; attributes: { address: string; symbol: string } }) => [t.id, t.attributes]));
  return (j.data ?? [])
    .map((p: { attributes: { address: string; reserve_in_usd: string }; relationships: { base_token: { data: { id: string } } } }) => {
      const t = toks.get(p.relationships.base_token.data.id);
      return t ? { pool: p.attributes.address, ca: t.address, symbol: t.symbol, liq: Number(p.attributes.reserve_in_usd) || 0 } : null;
    })
    .filter((x: unknown): x is { pool: string; ca: string; symbol: string; liq: number } => !!x && (x as { liq: number }).liq >= 20000)
    .slice(0, n);
}

/** Activity for up to 30 pools in one call */
export async function poolActivity(pools: string[]): Promise<Map<string, PoolAct>> {
  const out = new Map<string, PoolAct>();
  if (!pools.length) return out;
  const j = await gt(`/pools/multi/${pools.slice(0, 30).join(",")}`);
  for (const p of j.data ?? []) {
    const a = p.attributes;
    const t = a.transactions ?? {};
    out.set(a.address, {
      pool: a.address,
      m5: { buys: t.m5?.buys ?? 0, sells: t.m5?.sells ?? 0, buyers: t.m5?.buyers ?? 0 },
      h1: { buys: t.h1?.buys ?? 0, sells: t.h1?.sells ?? 0, buyers: t.h1?.buyers ?? 0 },
      volM5: Number(a.volume_usd?.m5) || 0,
      volH1: Number(a.volume_usd?.h1) || 0,
      chM5: Number(a.price_change_percentage?.m5) || 0,
    });
  }
  return out;
}

/** Trades of at least `minUsd` on a pool (newest last) */
export async function bigTrades(pool: string, token: string, minUsd: number): Promise<WhaleTrade[]> {
  const j = await gt(`/pools/${pool}/trades?trade_volume_in_usd_greater_than=${Math.max(500, Math.round(minUsd))}&token=${token}`);
  return parseTrades(j).sort((a, b) => a.t - b.t);
}

export type DexInfo = { price: number; pool: string; symbol: string; liq: number; m5: { buys: number; sells: number }; h1: { buys: number; sells: number }; volM5: number; chM5: number };

/** Price, main pool and 5-min / 1-h trade counts for up to 30 coins per DexScreener call */
export async function dexInfo(cas: string[]) {
  const out = new Map<string, DexInfo>();
  for (let i = 0; i < cas.length; i += 30) {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${cas.slice(i, i + 30).join(",")}`, { cache: "no-store" });
      type P = { baseToken: { address: string; symbol: string }; pairAddress: string; priceUsd?: string; liquidity?: { usd?: number }; txns?: Record<string, { buys: number; sells: number }>; volume?: Record<string, number>; priceChange?: Record<string, number> };
      for (const p of (await r.json()) as P[]) {
        const liq = p.liquidity?.usd ?? 0;
        const cur = out.get(p.baseToken.address);
        if (p.priceUsd && (!cur || liq > cur.liq))
          out.set(p.baseToken.address, {
            price: Number(p.priceUsd),
            pool: p.pairAddress,
            symbol: p.baseToken.symbol,
            liq,
            m5: p.txns?.m5 ?? { buys: 0, sells: 0 },
            h1: p.txns?.h1 ?? { buys: 0, sells: 0 },
            volM5: p.volume?.m5 ?? 0,
            chM5: p.priceChange?.m5 ?? 0,
          });
      }
    } catch {}
  }
  return out;
}

/** "Community buying": 5-min buys well above the hour's pace and clearly outnumbering sells */
export function buyingSurge(a: { m5: { buys: number; sells: number }; h1: { buys: number; sells: number }; volM5: number; chM5: number }) {
  const pace = a.h1.buys / 12;
  const ratio = pace > 0 ? a.m5.buys / pace : a.m5.buys;
  if (a.m5.buys >= Math.max(15, pace * 3) && a.m5.buys >= a.m5.sells * 2) return { ratio, buys: a.m5.buys, sells: a.m5.sells, vol: a.volM5, ch: a.chM5 };
  return null;
}

/** "Wallets rushing in": unique buyers in 5 min well above the hour's pace */
export function walletRush(a: PoolAct) {
  const pace = a.h1.buyers / 12;
  if (a.m5.buyers >= Math.max(10, pace * 3)) return { buyers: a.m5.buyers, pace, ch: a.chM5 };
  return null;
}
