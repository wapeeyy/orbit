import type { Candidate } from "./discover";

export type Filters = {
  minLiq: number;
  minMc: number;
  minVol: number;
  minAgeH: number;
  maxTop10: number;
  maxTop1: number;
  needRevoked: boolean;
};

export const DEFAULTS: Filters = {
  minLiq: 10_000,
  minMc: 20_000,
  minVol: 10_000,
  minAgeH: 1,
  maxTop10: 30,
  maxTop1: 5,
  needRevoked: true,
};

const usd = (n: number | null) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const age = (h: number | null) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;

/** Sebab coin gagal penapis (kosong = lulus) */
export function reasons(c: Candidate, f: Filters): string[] {
  const r: string[] = [];
  if (c.liquidityUsd < f.minLiq) r.push(`Liquidity ${usd(c.liquidityUsd)}`);
  if ((c.marketCap ?? 0) < f.minMc) r.push(`MC ${usd(c.marketCap)}`);
  if (c.volume24h < f.minVol) r.push(`Volume ${usd(c.volume24h)}`);
  if (c.ageHours != null && c.ageHours < f.minAgeH) r.push(`New ${age(c.ageHours)}`);
  if (!c.holders) {
    r.push(c.holdersError ? "Holder check failed" : "Holders not checked");
    return r;
  }
  if (c.holders.top10Pct > f.maxTop10) r.push(`Top 10 ${c.holders.top10Pct.toFixed(1)}%`);
  if (c.holders.top1Pct > f.maxTop1) r.push(`Whale ${c.holders.top1Pct.toFixed(1)}%`);
  if (f.needRevoked && !c.holders.mintRevoked) r.push("Mint active");
  if (f.needRevoked && !c.holders.freezeRevoked) r.push("Freeze active");
  return r;
}
