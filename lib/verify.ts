import { getHolders } from "./holders";
import { bundleCheck } from "./insiders";
import { kvConfigured, kvGet, kvPipeline } from "./kv";

// ORBIT Verified (real-trader check, phase 1): is this coin traded by real people, or is the volume and the
// chart made by a few wallets? Reads the last 300 trades (GeckoTerminal) and the launch bundle (Helius).
// Strict thresholds. Labels say "likely": a careful dev can still hide behind exchange-funded wallets.

export type VerifyCheck = { k: string; ok: boolean; v: string };
export type Verify = {
  at: number;
  ok: boolean;
  score: number; // 0–100 real-trader score
  organicPct: number | null; // share of recent volume that looks organic
  traders: number; // unique wallets in the sample
  checks: VerifyCheck[];
  err?: string;
};

export const STRICT = {
  maxTop5Share: 0.35, // top 5 wallets' share of recent volume
  maxWashShare: 0.15, // buy+sell round trips by the same wallet within 15 min, same size
  maxSameSize: 0.2, // most common trade size, share of trades (bot pattern)
  minTraders: 60, // unique wallets in the last 300 trades
  maxTradesPerWallet: 5,
  maxBundlePct: 10, // % supply still held by wallets that bought in the launch blocks
  minOrganicPct: 70,
};

type Trade = { kind: "buy" | "sell"; from: string; usd: number; sol: number; t: number };

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const SOL = "So11111111111111111111111111111111111111112";
const pct = (x: number) => `${Math.round(x * 100)}%`;

async function trades(pool: string): Promise<Trade[]> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${GT}/pools/${pool}/trades`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const j = (await r.json()) as { data?: { attributes: Record<string, string> }[] };
      return (j.data ?? []).map(({ attributes: a }) => ({
        kind: a.kind === "sell" ? "sell" : "buy",
        from: a.tx_from_address,
        usd: Number(a.volume_in_usd) || 0,
        sol: Number(a.from_token_address === SOL ? a.from_token_amount : a.to_token_address === SOL ? a.to_token_amount : 0) || 0,
        t: Date.parse(a.block_timestamp),
      }));
    }
    if (r.status !== 429) throw new Error(`GeckoTerminal ${r.status}`);
    await new Promise((x) => setTimeout(x, 2500 * (i + 1)));
  }
  throw new Error("GeckoTerminal busy");
}

/** Wash trading, volume concentration and bot patterns in the recent trades */
export function tradeStats(ts: Trade[]) {
  const total = ts.reduce((s, t) => s + t.usd, 0) || 1;
  const by = new Map<string, Trade[]>();
  for (const t of ts) by.set(t.from, [...(by.get(t.from) ?? []), t]);
  const vols = [...by.values()].map((l) => l.reduce((s, t) => s + t.usd, 0)).sort((a, b) => b - a);
  const top5Share = vols.slice(0, 5).reduce((s, v) => s + v, 0) / total;

  // round trips: the same wallet buys and sells a similar size within 15 minutes
  const washIdx = new Set<Trade>();
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (washIdx.has(a)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.t - a.t > 15 * 60_000) break;
        if (b.kind !== a.kind && !washIdx.has(b) && Math.abs(b.usd - a.usd) <= 0.15 * Math.max(a.usd, b.usd)) {
          washIdx.add(a);
          washIdx.add(b);
          break;
        }
      }
    }
  }
  const washShare = [...washIdx].reduce((s, t) => s + t.usd, 0) / total;

  // bot pattern: many trades of exactly the same SOL size
  const sizes = new Map<string, number>();
  for (const t of ts) if (t.sol > 0) sizes.set(t.sol.toPrecision(3), (sizes.get(t.sol.toPrecision(3)) ?? 0) + 1);
  const [topSize, topCount] = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["0", 0];
  const sameSize = ts.length ? topCount / ts.length : 0;
  const botIdx = new Set(topCount >= 20 && sameSize > STRICT.maxSameSize ? ts.filter((t) => t.sol > 0 && t.sol.toPrecision(3) === topSize) : []);

  const organic = ts.filter((t) => !washIdx.has(t) && !botIdx.has(t)).reduce((s, t) => s + t.usd, 0) / total;
  return { n: ts.length, traders: by.size, top5Share, washShare, sameSize, topSize, organic, perWallet: ts.length / Math.max(1, by.size) };
}

/** Full check for one coin (no cache) */
export async function verifyCoin(ca: string, pool: string, dexId = "pool"): Promise<Verify> {
  const at = Date.now();
  try {
    const ts = await trades(pool);
    if (ts.length < 50) return { at, ok: false, score: 0, organicPct: null, traders: 0, checks: [{ k: "Enough trades", ok: false, v: `Only ${ts.length} recent trades` }] };
    const s = tradeStats(ts);
    const checks: VerifyCheck[] = [
      { k: "Organic volume", ok: s.organic * 100 >= STRICT.minOrganicPct, v: `${pct(s.organic)} of recent volume looks organic` },
      { k: "Volume spread", ok: s.top5Share <= STRICT.maxTop5Share, v: `Top 5 wallets did ${pct(s.top5Share)} of the volume` },
      { k: "No wash trading", ok: s.washShare <= STRICT.maxWashShare, v: s.washShare > 0.01 ? `${pct(s.washShare)} of volume is buy-and-sell back by the same wallet` : "No same-wallet round trips" },
      { k: "No bot pattern", ok: s.sameSize <= STRICT.maxSameSize, v: s.sameSize > 0.1 ? `${pct(s.sameSize)} of trades are exactly ${s.topSize} SOL` : "Trade sizes look natural" },
      { k: "Real crowd", ok: s.traders >= STRICT.minTraders && s.perWallet <= STRICT.maxTradesPerWallet, v: `${s.traders} different wallets in the last ${s.n} trades` },
    ];
    // launch bundle (wallets that bought in the first blocks and still hold)
    try {
      const h = await getHolders(ca, { [pool]: dexId });
      const b = await bundleCheck(ca, h.holders.map((x) => ({ owner: x.owner, pct: x.pct })));
      if (b.ok) checks.push({ k: "No launch bundle", ok: b.bundledPct <= STRICT.maxBundlePct, v: b.bundled.length ? `Launch-block wallets still hold ${b.bundledPct.toFixed(1)}%` : "No launch-block buyers among top holders" });
      else checks.push({ k: "No launch bundle", ok: true, v: "Too much history to trace the launch (older coin)" });
    } catch {
      checks.push({ k: "No launch bundle", ok: false, v: "Launch check unavailable" });
    }
    const fails = checks.filter((c) => !c.ok).length;
    const score = Math.max(0, Math.round(s.organic * 70 + (1 - Math.min(1, s.top5Share)) * 20 + Math.min(10, s.traders / 15) - fails * 12));
    return { at, ok: fails === 0, score, organicPct: Math.round(s.organic * 100), traders: s.traders, checks };
  } catch (e) {
    return { at, ok: false, score: 0, organicPct: null, traders: 0, checks: [], err: (e as Error).message };
  }
}

const TTL = 30 * 60; // seconds

/** Cached results for many coins (one round trip) */
export async function cachedVerify(cas: string[]): Promise<Record<string, Verify>> {
  if (!kvConfigured() || !cas.length) return {};
  const res = (await kvPipeline(cas.map((ca) => ["GET", `verify:${ca}`]))) as (string | null)[];
  const out: Record<string, Verify> = {};
  res.forEach((r, i) => {
    if (r) out[cas[i]] = JSON.parse(r);
  });
  return out;
}

/** Check (or reuse) one coin, cached 30 min; data errors are cached only 5 min */
export async function getVerify(ca: string, pool: string, dexId?: string): Promise<Verify> {
  if (kvConfigured()) {
    const hit = await kvGet(`verify:${ca}`);
    if (hit) return JSON.parse(hit);
  }
  const v = await verifyCoin(ca, pool, dexId);
  if (kvConfigured()) await kvPipeline([["SET", `verify:${ca}`, JSON.stringify(v), "EX", v.err ? 300 : TTL]]);
  return v;
}

/** Check up to `max` coins that are not cached yet, within a time budget */
export async function verifyPending(items: { ca: string; pool: string; dexId?: string }[], max = 5, budgetMs = 40_000) {
  const start = Date.now();
  const have = await cachedVerify(items.map((i) => i.ca));
  let done = 0;
  for (const it of items) {
    if (have[it.ca] || done >= max || Date.now() - start > budgetMs) continue;
    if (kvConfigured()) {
      const [lock] = (await kvPipeline([["SET", `verifylock:${it.ca}`, "1", "NX", "EX", 120]])) as [string | null];
      if (lock !== "OK") continue;
    }
    await getVerify(it.ca, it.pool, it.dexId);
    done++;
  }
  return done;
}
