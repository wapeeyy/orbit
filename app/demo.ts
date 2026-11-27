"use client";

// Demo trade: SOL tipu, disimpan dalam browser pengguna sahaja.
export const START_SOL = 10;
export const FEE = 0.01; // simulasi fee + slippage 1% setiap belah

export type Pos = { ca: string; symbol: string; name: string; image?: string; amount: number; costSol: number; openedAt: number };
export type Trade = { ts: number; side: "BUY" | "SELL"; ca: string; symbol: string; amount: number; sol: number; priceSol: number; priceUsd?: number; pnlSol?: number };
export type DemoState = { start: number; sol: number; pos: Record<string, Pos>; hist: Trade[]; realized: number };

const K = "orbit.demo.v1";
const listeners = new Set<() => void>();
const fresh = (): DemoState => ({ start: START_SOL, sol: START_SOL, pos: {}, hist: [], realized: 0 });

export function load(): DemoState {
  try {
    const s = JSON.parse(localStorage.getItem(K) ?? "null");
    if (s && typeof s.sol === "number") return s;
  } catch {}
  return fresh();
}

function save(s: DemoState) {
  try {
    localStorage.setItem(K, JSON.stringify(s));
  } catch {}
  listeners.forEach((f) => f());
}

export function onDemoChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function buy(meta: { ca: string; symbol: string; name: string; image?: string }, solAmt: number, priceSol: number, priceUsd?: number) {
  const s = load();
  if (!(priceSol > 0)) throw new Error("Price not available");
  if (!(solAmt > 0)) throw new Error("Enter a SOL amount");
  if (solAmt > s.sol + 1e-9) throw new Error(`Not enough fake SOL (you have ${s.sol.toFixed(3)} SOL)`);
  const amount = (solAmt * (1 - FEE)) / priceSol;
  const p = s.pos[meta.ca] ?? { ...meta, amount: 0, costSol: 0, openedAt: Date.now() };
  p.amount += amount;
  p.costSol += solAmt;
  s.pos[meta.ca] = p;
  s.sol -= solAmt;
  s.hist.unshift({ ts: Date.now(), side: "BUY", ca: meta.ca, symbol: meta.symbol, amount, sol: solAmt, priceSol, ...(priceUsd ? { priceUsd } : {}) });
  s.hist = s.hist.slice(0, 100);
  save(s);
  return amount;
}

export function sell(ca: string, fraction: number, priceSol: number, priceUsd?: number) {
  const s = load();
  const p = s.pos[ca];
  if (!p) throw new Error("No position");
  if (!(priceSol > 0)) throw new Error("Price not available");
  const f = Math.min(1, Math.max(0, fraction));
  const amount = p.amount * f;
  const solOut = amount * priceSol * (1 - FEE);
  const cost = p.costSol * f;
  const pnl = solOut - cost;
  p.amount -= amount;
  p.costSol -= cost;
  if (f >= 0.999 || p.amount <= 1e-12) delete s.pos[ca];
  s.sol += solOut;
  s.realized += pnl;
  s.hist.unshift({ ts: Date.now(), side: "SELL", ca, symbol: p.symbol, amount, sol: solOut, priceSol, ...(priceUsd ? { priceUsd } : {}), pnlSol: pnl });
  if (!s.pos[ca]) setTpsl(ca, null);
  s.hist = s.hist.slice(0, 100);
  save(s);
  return { solOut, pnl };
}

export function reset() {
  save(fresh());
}

/** Harga semasa (SOL & USD) dari /api/price */
export async function prices(cas: string[]) {
  const r = await fetch(`/api/price?cas=${cas.join(",")}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Couldn't fetch prices");
  return j as { solUsd: number; prices: Record<string, { usd: number; sol: number; symbol: string; name: string; image?: string; liq: number }> };
}

/* ---------- demo take-profit / stop-loss (USD prices), per coin ---------- */
export type Tpsl = { tp?: number; sl?: number };
const TK = "orbit.demo.tpsl.v1";
export function getTpsl(ca: string): Tpsl {
  try {
    return (JSON.parse(localStorage.getItem(TK) ?? "{}") as Record<string, Tpsl>)[ca] ?? {};
  } catch {
    return {};
  }
}
export function setTpsl(ca: string, v: Tpsl | null) {
  try {
    const all = JSON.parse(localStorage.getItem(TK) ?? "{}") as Record<string, Tpsl>;
    if (!v || (!v.tp && !v.sl)) delete all[ca];
    else all[ca] = v;
    localStorage.setItem(TK, JSON.stringify(all));
  } catch {}
  listeners.forEach((f) => f());
}

/** Average entry (USD) of the open position: buys since it was opened, weighted by amount */
export function avgEntryUsd(s: DemoState, ca: string, solUsd: number | null): number | null {
  const p = s.pos[ca];
  if (!p) return null;
  const buys = s.hist.filter((t) => t.ca === ca && t.side === "BUY" && t.ts >= p.openedAt - 1000);
  let w = 0;
  let sum = 0;
  for (const t of buys) {
    const usd = t.priceUsd ?? (solUsd ? t.priceSol * solUsd : null);
    if (usd == null) continue;
    sum += usd * t.amount;
    w += t.amount;
  }
  if (w > 0) return sum / w;
  return solUsd ? (p.costSol * (1 - FEE) / p.amount) * solUsd : null;
}
