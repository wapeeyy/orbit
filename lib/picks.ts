import { getHolders } from "./holders";
import { kvConfigured, kvGet, kvPipeline } from "./kv";
import { analyse, type Candle } from "./ta";

// ORBIT Scalp & Hold (Ultra): candidates from GeckoTerminal, then strict checks before anything is listed.
// Nothing here guarantees profit: every pick ships with an entry zone, a target, a stop and a public track record.

export type Kind = "scalp" | "hold";
export type Check = { k: string; ok: boolean; v: string };
export type Pick = {
  kind: Kind;
  ca: string;
  pool: string;
  symbol: string;
  image?: string;
  score: number;
  price: number;
  entry: [number, number];
  target: number;
  stop: number;
  rr: number;
  horizon: string;
  bias: string;
  checks: Check[];
  liq: number;
  mc: number | null;
  ageDays: number;
  pickedAt: number;
  pickedPrice: number;
};
export type Closed = { kind: Kind; ca: string; symbol: string; entry: number; exit: number; pct: number; result: "target" | "stop" | "expired"; at: number; closedAt: number };
export type PicksState = { at: number; picks: Pick[]; scanned: number; passed: number; shortlisted?: number; failed?: Record<string, number> };

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const SOL = "So11111111111111111111111111111111111111112";
const H = { accept: "application/json" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gt(path: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(GT + path, { headers: H, cache: "no-store" });
    if (r.ok) return r.json();
    if (r.status !== 429) throw new Error(`GeckoTerminal ${r.status}`);
    await wait(2500 * (i + 1));
  }
  throw new Error("GeckoTerminal busy");
}

type Cand = {
  pool: string; ca: string; symbol: string; image?: string; liq: number; mc: number | null; ageDays: number;
  ch: { m5: number; h1: number; h6: number; h24: number };
  tx: Record<"m5" | "h1" | "h24", { buys: number; sells: number; buyers: number; sellers: number }>;
  vol: { h1: number; h24: number };
};

async function candidates(): Promise<Cand[]> {
  const out = new Map<string, Cand>();
  for (const path of ["/trending_pools?page=1", "/trending_pools?page=2", "/pools?sort=h24_volume_usd_desc&page=1"]) {
    const j = await gt(`${path}&include=base_token`);
    const toks = new Map<string, { address: string; symbol: string; image_url?: string }>((j.included ?? []).map((t: { id: string; attributes: { address: string; symbol: string; image_url?: string } }) => [t.id, t.attributes]));
    for (const p of j.data ?? []) {
      const a = p.attributes;
      const t = toks.get(p.relationships?.base_token?.data?.id);
      if (!t || t.address === SOL || out.has(t.address)) continue;
      const tx = (w: string) => ({ buys: a.transactions?.[w]?.buys ?? 0, sells: a.transactions?.[w]?.sells ?? 0, buyers: a.transactions?.[w]?.buyers ?? 0, sellers: a.transactions?.[w]?.sellers ?? 0 });
      const n = (x: unknown) => Number(x) || 0;
      out.set(t.address, {
        pool: a.address, ca: t.address, symbol: t.symbol, image: t.image_url && !t.image_url.includes("missing") ? t.image_url : undefined,
        liq: n(a.reserve_in_usd), mc: a.market_cap_usd ? n(a.market_cap_usd) : a.fdv_usd ? n(a.fdv_usd) : null,
        ageDays: (Date.now() - Date.parse(a.pool_created_at)) / 86_400_000,
        ch: { m5: n(a.price_change_percentage?.m5), h1: n(a.price_change_percentage?.h1), h6: n(a.price_change_percentage?.h6), h24: n(a.price_change_percentage?.h24) },
        tx: { m5: tx("m5"), h1: tx("h1"), h24: tx("h24") },
        vol: { h1: n(a.volume_usd?.h1), h24: n(a.volume_usd?.h24) },
      });
    }
    await wait(600);
  }
  return [...out.values()];
}

/** Quick filters on market data only, ranked; the strict checks run on the best few */
function prefilter(c: Cand[], kind: Kind) {
  if (kind === "scalp")
    return c
      .filter((x) => x.liq >= 30_000 && x.ageDays >= 2 / 24 && x.vol.h1 >= 20_000 && x.tx.h1.buyers >= 40 && x.tx.h1.buys >= x.tx.h1.sells * 1.2 && x.tx.m5.buys >= x.tx.m5.sells && x.ch.h1 > 1 && x.ch.h1 < 60)
      .map((x) => ({ x, s: (x.tx.h1.buys / Math.max(1, x.tx.h1.sells)) * Math.log10(x.vol.h1) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 7)
      .map((y) => y.x);
  return c
    .filter((x) => x.liq >= 150_000 && x.ageDays >= 7 && (x.mc ?? 0) >= 1e6 && (x.mc ?? 0) <= 300e6 && x.vol.h24 >= 200_000 && x.tx.h24.buyers >= 300 && x.ch.h24 > -15 && x.ch.h24 < 60 && x.tx.h24.buyers >= x.tx.h24.sellers)
    .map((x) => ({ x, s: (x.tx.h24.buyers / Math.max(1, x.tx.h24.sellers)) * Math.log10(x.liq) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 7)
    .map((y) => y.x);
}

async function candles(pool: string, ca: string, frame: string, agg: number, limit: number): Promise<Candle[]> {
  const j = await gt(`/pools/${pool}/ohlcv/${frame}?aggregate=${agg}&limit=${limit}&currency=usd&token=${ca}`);
  return ((j?.data?.attributes?.ohlcv_list ?? []) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

async function quote(i: string, o: string, amt: string) {
  const r = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${i}&outputMint=${o}&amount=${amt}&slippageBps=1000&restrictIntermediateTokens=true`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || !j.outAmount) throw new Error("no route");
  return j as { outAmount: string };
}
async function roundTripLoss(ca: string) {
  const buy = await quote(SOL, ca, "100000000");
  const sell = await quote(ca, SOL, buy.outAmount);
  return Math.max(0, (1 - Number(sell.outAmount) / 1e8) * 100);
}

async function rugcheck(ca: string): Promise<{ danger: string[]; score: number | null }> {
  const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`, { cache: "no-store" });
  if (!r.ok) throw new Error("rugcheck");
  const j = await r.json();
  return { danger: (j.risks ?? []).filter((x: { level: string }) => x.level === "danger").map((x: { name: string }) => x.name), score: j.score_normalised ?? null };
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** Strict checks: every one must pass for the coin to be listed */
let lastFail = "";
async function deepCheck(c: Cand, kind: Kind): Promise<Pick | null> {
  const checks: Check[] = [];
  lastFail = "Chart data";
  const pass = (k: string, ok: boolean, v: string) => {
    checks.push({ k, ok, v });
    if (!ok) lastFail = k;
    return ok || process.env.PICKS_DEMO === "1"; // demo mode (local previews only): run every check and show the result
  };

  // 1. chart read
  const cs = kind === "scalp" ? await candles(c.pool, c.ca, "minute", 15, 192) : await candles(c.pool, c.ca, "hour", 4, 180);
  if (cs.length < 40) return null;
  const ta = analyse(cs);
  const r = ta.read;
  const last = ta.last;
  const vwap = ta.vwap[ta.vwap.length - 1];
  if (!pass("Chart bias", r.bias === "Bullish" || (kind === "hold" && r.bias === "Ranging" && r.score >= 10), `${r.bias} ${r.score > 0 ? "+" : ""}${r.score} on ${kind === "scalp" ? "15m" : "4h"}`)) return null;
  if (!pass("Not overheated", (r.rsi ?? 50) < 75, `RSI ${(r.rsi ?? 0).toFixed(0)}`)) return null;
  if (kind === "scalp" && !pass("Above VWAP", last > vwap, "Buyers in control of the session")) return null;

  // 2. buyers vs sellers
  const w = kind === "scalp" ? c.tx.h1 : c.tx.h24;
  const ratio = w.buys / Math.max(1, w.sells);
  if (!pass("Buy pressure", ratio >= (kind === "scalp" ? 1.2 : 1.0) && w.buyers >= w.sellers, `${ratio.toFixed(1)}x buys vs sells, ${w.buyers} buyers (${kind === "scalp" ? "1h" : "24h"})`)) return null;

  // 3. can you sell?
  const loss = await roundTripLoss(c.ca).catch(() => null);
  if (!pass("Sellable", loss != null && loss < (kind === "scalp" ? 8 : 5), loss == null ? "No sell route" : `${loss.toFixed(1)}% lost on a 0.1 SOL round-trip`)) return null;

  // 4. RugCheck red flags
  const rc = await rugcheck(c.ca).catch(() => null);
  if (!pass("No red flags", !!rc && rc.danger.length === 0, rc ? (rc.danger.length ? rc.danger.join(", ") : "RugCheck: no danger flags") : "RugCheck unavailable")) return null;

  // 5. holder concentration
  const hold = await getHolders(c.ca, { [c.pool]: "pool" }).catch(() => null);
  const top10 = hold?.top10Pct ?? null;
  const relax = process.env.PICKS_RELAX_HOLDERS === "1";
  if (!pass("Holders spread", top10 != null ? top10 < (kind === "scalp" ? 30 : 25) : relax, top10 != null ? `Top 10 hold ${top10.toFixed(1)}%` : "Holder data unavailable")) return null;
  if (hold && !pass("Authorities revoked", !hold.mintAuthority && !hold.freezeAuthority, !hold.mintAuthority && !hold.freezeAuthority ? "No mint / freeze" : "Mint or freeze still active")) return null;

  // 6. the plan: entry zone, target, stop, reward / risk
  const s1 = r.support[0]?.mid ?? ta.profile.poc;
  const entryLow = Math.min(last, Math.max(s1, last * (kind === "scalp" ? 0.94 : 0.85)));
  const target = r.resistance[0]?.mid ?? last * (kind === "scalp" ? 1.15 : 1.6);
  const stopBase = r.invalidation && r.invalidation < last ? r.invalidation : (r.support[1]?.mid ?? s1 * 0.95);
  const stop = Math.min(stopBase, entryLow * 0.97);
  const rr = (target - last) / Math.max(1e-18, last - stop);
  if (!pass("Reward vs risk", rr >= 1.5 && target > last * 1.04, `Target +${pct(target, last).toFixed(0)}% vs stop ${pct(stop, last).toFixed(0)}% (${rr.toFixed(1)} : 1)`)) return null;

  const score = Math.round(Math.min(100, 40 + r.score * 0.3 + Math.min(20, (ratio - 1) * 20) + Math.min(15, rr * 4) + (top10 != null ? Math.max(0, 25 - top10) * 0.4 : 0) - (loss ?? 0)));
  return {
    kind, ca: c.ca, pool: c.pool, symbol: c.symbol, image: c.image, score, price: last,
    entry: [entryLow, last], target, stop, rr, horizon: kind === "scalp" ? "Hours to 1 day" : "Up to 30 days",
    bias: `${r.bias} ${r.score > 0 ? "+" : ""}${r.score}`, checks, liq: c.liq, mc: c.mc, ageDays: c.ageDays, pickedAt: Date.now(), pickedPrice: last,
  };
}

/** Rebuild one list; keeps the original pick time / price for coins that stay on it */
export async function refreshPicks(kind: Kind): Promise<PicksState> {
  const all = await candidates();
  const shortlist = prefilter(all, kind);
  const prev = await readPicks(kind);
  const out: Pick[] = [];
  const failed: Record<string, number> = {};
  for (const c of shortlist) {
    try {
      const p = await deepCheck(c, kind);
      if (!p) failed[lastFail] = (failed[lastFail] ?? 0) + 1;
      if (p) {
        const old = prev?.picks.find((x) => x.ca === p.ca);
        if (old) {
          p.pickedAt = old.pickedAt;
          p.pickedPrice = old.pickedPrice;
        }
        out.push(p);
      }
    } catch {
      failed["Data unavailable"] = (failed["Data unavailable"] ?? 0) + 1;
    }
    await wait(500);
    if (out.length >= 5) break;
  }
  out.sort((a, b) => b.score - a.score);
  const state: PicksState = { at: Date.now(), picks: out, scanned: all.length, passed: out.length, shortlisted: shortlist.length, failed };
  if (kvConfigured()) {
    await kvPipeline([["SET", `picks:${kind}`, JSON.stringify(state)]]);
    // open a track-record entry for every new pick
    for (const p of out) await kvPipeline([["SET", `picks:open:${kind}:${p.ca}`, JSON.stringify({ kind, ca: p.ca, symbol: p.symbol, entry: p.pickedPrice, target: p.target, stop: p.stop, at: p.pickedAt }), "NX"]]);
  }
  return state;
}

export async function readPicks(kind: Kind): Promise<PicksState | null> {
  if (!kvConfigured()) return null;
  const raw = await kvGet(`picks:${kind}`);
  return raw ? (JSON.parse(raw) as PicksState) : null;
}

/** Close open picks that hit target / stop or ran out of time (called with fresh prices) */
export async function settlePicks(prices: Map<string, number>) {
  if (!kvConfigured()) return;
  for (const kind of ["scalp", "hold"] as Kind[]) {
    const [keys] = (await kvPipeline([["KEYS", `picks:open:${kind}:*`]])) as [string[]];
    for (const key of keys ?? []) {
      const raw = await kvGet(key);
      if (!raw) continue;
      const o = JSON.parse(raw) as { kind: Kind; ca: string; symbol: string; entry: number; target: number; stop: number; at: number };
      const now = prices.get(o.ca);
      const maxAge = kind === "scalp" ? 86_400_000 : 30 * 86_400_000;
      const result = now == null ? (Date.now() - o.at > maxAge ? "expired" : null) : now >= o.target ? "target" : now <= o.stop ? "stop" : Date.now() - o.at > maxAge ? "expired" : null;
      if (!result) continue;
      const exit = now ?? o.entry;
      const closed: Closed = { kind, ca: o.ca, symbol: o.symbol, entry: o.entry, exit, pct: pct(exit, o.entry), result, at: o.at, closedAt: Date.now() };
      await kvPipeline([["LPUSH", `picks:closed:${kind}`, JSON.stringify(closed)], ["LTRIM", `picks:closed:${kind}`, 0, 199], ["DEL", key]]);
    }
  }
}

export async function trackRecord(kind: Kind) {
  if (!kvConfigured()) return { closed: [] as Closed[], open: 0 };
  const [list, keys] = (await kvPipeline([["LRANGE", `picks:closed:${kind}`, 0, 99], ["KEYS", `picks:open:${kind}:*`]])) as [string[] | null, string[] | null];
  return { closed: (list ?? []).map((s) => JSON.parse(s) as Closed), open: (keys ?? []).length };
}

export async function openPickCas() {
  if (!kvConfigured()) return [] as string[];
  const [a, b] = (await kvPipeline([["KEYS", "picks:open:scalp:*"], ["KEYS", "picks:open:hold:*"]])) as [string[] | null, string[] | null];
  return [...(a ?? []), ...(b ?? [])].map((k) => k.split(":").pop()!);
}
