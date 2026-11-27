import type { Candidate } from "./discover";

export type Filters = {
  minLiq: number;
  minMc: number;
  minVol: number;
  minAgeH: number;
  maxTop10: number;
  maxTop1: number;
  needRevoked: boolean;
  needVerified: boolean; // ORBIT Verified: real traders, no fake volume, no launch bundle
};

export const DEFAULTS: Filters = {
  minLiq: 10_000,
  minMc: 20_000,
  minVol: 10_000,
  minAgeH: 1,
  maxTop10: 30,
  maxTop1: 5,
  needRevoked: true,
  needVerified: true,
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
  if (f.needVerified && !r.length) r.push(...verifyReasons(c)); // only once everything else passes
  return r;
}

const FAIL: Record<string, (c: Candidate) => string> = {
  "Organic volume": (c) => `Fake volume (organic ${c.verify?.organicPct ?? 0}%)`,
  "Volume spread": () => "Volume from a few wallets",
  "No wash trading": () => "Wash trading",
  "No bot pattern": () => "Bot trades",
  "Real crowd": (c) => `Few real traders (${c.verify?.traders ?? 0})`,
  "No launch bundle": () => "Launch bundle",
  "Enough trades": () => "Too few trades",
};

/** ORBIT Verified: why a coin is not verified (empty = verified) */
export function verifyReasons(c: Candidate): string[] {
  const v = c.verify;
  if (!v) return ["Verifying real traders…"];
  if (v.err) return ["Trade check unavailable"];
  return v.checks.filter((x) => !x.ok).map((x) => (FAIL[x.k] ?? (() => x.k))(c));
}
