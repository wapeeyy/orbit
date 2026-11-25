// Big trades ("whales") on a pool, straight from GeckoTerminal in the browser.

export type WhaleTrade = { t: number; kind: "buy" | "sell"; usd: number; wallet: string; tx: string; price: number };

export function parseTrades(json: unknown): WhaleTrade[] {
  const list = ((json as { data?: { attributes: Record<string, string> }[] })?.data ?? []).map((d) => d.attributes);
  return list
    .map((a) => ({
      t: Math.floor(Date.parse(a.block_timestamp) / 1000),
      kind: a.kind === "sell" ? ("sell" as const) : ("buy" as const),
      usd: Number(a.volume_in_usd) || 0,
      wallet: a.tx_from_address,
      tx: a.tx_hash,
      price: Number(a.kind === "sell" ? a.price_from_in_usd : a.price_to_in_usd) || 0,
    }))
    .filter((w) => w.usd > 0 && w.t > 0);
}

/** Keep the trades that stand out: at least $2k and in the top 10% by size, max 20 */
export function pickWhales(trades: WhaleTrade[], max = 20): WhaleTrade[] {
  if (trades.length === 0) return [];
  const sizes = trades.map((w) => w.usd).sort((a, b) => a - b);
  const p90 = sizes[Math.floor(sizes.length * 0.9)] ?? 0;
  const min = Math.max(2000, p90);
  return trades
    .filter((w) => w.usd >= min)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, max)
    .sort((a, b) => a.t - b.t);
}

export async function fetchWhales(pool: string, token: string): Promise<WhaleTrade[]> {
  const url =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades` +
    `?trade_volume_in_usd_greater_than=1000&token=${token}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  return pickWhales(parseTrades(await res.json()));
}
