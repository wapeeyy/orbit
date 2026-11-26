import { getMarket } from "./dex";
import { getHolders, rpc } from "./holders";
import { kvConfigured, kvGet, kvPipeline } from "./kv";

// Ultra: (1) holder flow — how the top-20 wallets changed vs ~1 h and ~24 h ago (snapshots kept in Redis),
// (2) bundle check — which current top holders already bought in the first blocks after launch.

type Snap = { t: number; h: Record<string, number> }; // owner -> % of supply
export type FlowRow = { owner: string; pct: number; d1h: number | null; d24h: number | null; isNew1h: boolean; label?: string };
export type Flow = { rows: FlowRow[]; exited1h: { owner: string; pct: number }[]; since1h: number | null; since24h: number | null };
export type Bundle =
  | { ok: true; launchSlot: number; earlyBuyers: number; bundled: { owner: string; pct: number }[]; bundledPct: number }
  | { ok: false; reason: string };

const HOUR = 3_600_000;

function closest(snaps: Snap[], target: number, maxOff: number) {
  let best: Snap | null = null;
  for (const s of snaps) if (Math.abs(s.t - target) <= maxOff && (!best || Math.abs(s.t - target) < Math.abs(best.t - target))) best = s;
  return best;
}

export async function holderFlow(ca: string): Promise<Flow & { holders: { owner: string; pct: number }[] }> {
  const market = await getMarket(ca).catch(() => null);
  const rep = await getHolders(ca, market?.pairAddresses ?? {});
  const now = Date.now();
  const cur: Snap = { t: now, h: Object.fromEntries(rep.holders.map((h) => [h.owner, Math.round(h.pct * 1000) / 1000])) };
  let snaps: Snap[] = [];
  if (kvConfigured()) {
    const [list] = (await kvPipeline([["LRANGE", `hsnap:${ca}`, 0, 60]])) as [string[] | null];
    snaps = (list ?? []).map((s) => JSON.parse(s) as Snap);
    // keep one snapshot every 15 min, about 2 days of history
    if (!snaps.length || now - snaps[0].t > 15 * 60_000) {
      await kvPipeline([
        ["LPUSH", `hsnap:${ca}`, JSON.stringify(cur)],
        ["LTRIM", `hsnap:${ca}`, 0, 200],
        ["EXPIRE", `hsnap:${ca}`, 3 * 86400],
      ]);
    }
  }
  const a1 = closest(snaps, now - HOUR, 40 * 60_000);
  const a24 = closest(snaps, now - 24 * HOUR, 6 * HOUR);
  const rows: FlowRow[] = rep.holders.map((h) => ({
    owner: h.owner,
    pct: h.pct,
    label: h.label,
    d1h: a1 ? h.pct - (a1.h[h.owner] ?? 0) : null,
    d24h: a24 ? h.pct - (a24.h[h.owner] ?? 0) : null,
    isNew1h: !!a1 && a1.h[h.owner] == null,
  }));
  const exited1h = a1 ? Object.entries(a1.h).filter(([o]) => cur.h[o] == null).map(([owner, pct]) => ({ owner, pct })) : [];
  return { rows, exited1h, since1h: a1?.t ?? null, since24h: a24?.t ?? null, holders: rep.holders.map((h) => ({ owner: h.owner, pct: h.pct })) };
}

type Sig = { signature: string; slot: number; err: unknown };
type EnhancedTx = { accountData?: { tokenBalanceChanges?: { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string } }[] }[] };

export async function bundleCheck(ca: string, holders: { owner: string; pct: number }[]): Promise<Bundle> {
  if (kvConfigured()) {
    const cached = await kvGet(`bundle:${ca}`);
    if (cached) {
      const b = JSON.parse(cached) as { launchSlot: number; early: string[] } | { fail: string };
      if ("fail" in b) return { ok: false, reason: b.fail };
      return summarise(b.launchSlot, new Set(b.early), holders);
    }
  }
  // walk back to the mint's first transactions (max 8 × 1000 signatures)
  let before: string | undefined;
  let oldest: Sig[] = [];
  let reached = false;
  for (let page = 0; page < 8; page++) {
    const sigs = await rpc<Sig[]>("getSignaturesForAddress", [ca, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!sigs.length) {
      reached = true;
      break;
    }
    oldest = sigs;
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) {
      reached = true;
      break;
    }
  }
  if (!reached) {
    const reason = "Too much trading since launch to trace the first buyers.";
    if (kvConfigured()) await kvPipeline([["SET", `bundle:${ca}`, JSON.stringify({ fail: reason }), "EX", 6 * 3600]]);
    return { ok: false, reason };
  }
  const launchSlot = Math.min(...oldest.map((s) => s.slot));
  const first = oldest.filter((s) => !s.err && s.slot <= launchSlot + 2).slice(-100).map((s) => s.signature);
  const key = process.env.HELIUS_API_KEY;
  const base = process.env.HELIUS_API_BASE || "https://api.helius.xyz";
  const res = await fetch(`${base}/v0/transactions?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: first }) });
  if (!res.ok) return { ok: false, reason: `Helius ${res.status}` };
  const txs = (await res.json()) as EnhancedTx[];
  const early = new Set<string>();
  for (const tx of txs)
    for (const a of tx.accountData ?? [])
      for (const t of a.tokenBalanceChanges ?? []) if (t.mint === ca && Number(t.rawTokenAmount.tokenAmount) > 0) early.add(t.userAccount);
  if (kvConfigured()) await kvPipeline([["SET", `bundle:${ca}`, JSON.stringify({ launchSlot, early: [...early] }), "EX", 6 * 3600]]);
  return summarise(launchSlot, early, holders);
}

function summarise(launchSlot: number, early: Set<string>, holders: { owner: string; pct: number }[]): Bundle {
  const bundled = holders.filter((h) => early.has(h.owner));
  return { ok: true, launchSlot, earlyBuyers: early.size, bundled, bundledPct: bundled.reduce((s, h) => s + h.pct, 0) };
}
