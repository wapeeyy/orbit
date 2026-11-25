// ORBIT technical analysis: market structure, levels, volume profile, indicators.
// Everything is computed in the browser from the OHLCV candles already loaded for the chart.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Swing = { i: number; t: number; price: number; kind: "high" | "low"; label: "HH" | "LH" | "HL" | "LL" | "H" | "L" };
export type Break = { kind: "BOS" | "CHoCH"; dir: "up" | "down"; from: number; to: number; price: number; tFrom: number; tTo: number };
export type Sweep = { i: number; t: number; price: number; dir: "high" | "low" };
export type Zone = { from: number; to: number; mid: number; touches: number; kind: "support" | "resistance" };
export type Profile = { lo: number; step: number; bins: number[]; poc: number; vah: number; val: number; total: number };
export type Fib = { from: number; to: number; tFrom: number; tTo: number; up: boolean; levels: { r: number; price: number }[] };

export function ema(v: number[], n: number) {
  const k = 2 / (n + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1] * (1 - k)));
  return out;
}

export function rsi(closes: number[], n = 14) {
  const out: (number | null)[] = closes.map(() => null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

/** VWAP anchored at the first candle of the window */
export function vwap(cs: Candle[]) {
  let pv = 0, vv = 0;
  return cs.map((c) => {
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v; vv += c.v;
    return vv ? pv / vv : tp;
  });
}

export function atr(cs: Candle[], n = 14) {
  let a = 0;
  cs.forEach((c, i) => {
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c));
    a = i === 0 ? tr : (a * (n - 1) + tr) / n;
  });
  return a;
}

/** Fractal swing points, labelled against the previous swing of the same type */
export function swings(cs: Candle[], k = 3): Swing[] {
  const out: Swing[] = [];
  let lastH: number | null = null, lastL: number | null = null;
  for (let i = k; i < cs.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (cs[j].h >= cs[i].h) isH = false;
      if (cs[j].l <= cs[i].l) isL = false;
    }
    if (isH) {
      out.push({ i, t: cs[i].t, price: cs[i].h, kind: "high", label: lastH === null ? "H" : cs[i].h > lastH ? "HH" : "LH" });
      lastH = cs[i].h;
    }
    if (isL) {
      out.push({ i, t: cs[i].t, price: cs[i].l, kind: "low", label: lastL === null ? "L" : cs[i].l > lastL ? "HL" : "LL" });
      lastL = cs[i].l;
    }
  }
  return out;
}

/** Break of structure / change of character from closes through the latest swing levels */
export function structure(cs: Candle[], sw: Swing[], K = 3) {
  const breaks: Break[] = [];
  const sweeps: Sweep[] = [];
  let trend: "up" | "down" | null = null;
  let hi: Swing | null = null, lo: Swing | null = null;
  let si = 0;
  for (let i = 0; i < cs.length; i++) {
    // a swing is only "known" once its right-hand confirmation candles have printed
    while (si < sw.length && sw[si].i + K <= i) {
      if (sw[si].kind === "high") hi = sw[si]; else lo = sw[si];
      si++;
    }
    const c = cs[i];
    if (hi && c.c > hi.price) {
      breaks.push({ kind: trend === "down" ? "CHoCH" : "BOS", dir: "up", from: hi.i, to: i, price: hi.price, tFrom: hi.t, tTo: c.t });
      trend = "up"; hi = null;
    } else if (hi && c.h > hi.price && c.c < hi.price) {
      sweeps.push({ i, t: c.t, price: hi.price, dir: "high" });
      hi = null;
    }
    if (lo && c.c < lo.price) {
      breaks.push({ kind: trend === "up" ? "CHoCH" : "BOS", dir: "down", from: lo.i, to: i, price: lo.price, tFrom: lo.t, tTo: c.t });
      trend = "down"; lo = null;
    } else if (lo && c.l < lo.price && c.c > lo.price) {
      sweeps.push({ i, t: c.t, price: lo.price, dir: "low" });
      lo = null;
    }
  }
  return { breaks, sweeps, trend };
}

/** Cluster swing prices into support / resistance zones */
export function zones(cs: Candle[], sw: Swing[], a: number, last: number): Zone[] {
  const tol = Math.max(a * 0.5, last * 0.003);
  const pts = sw.map((s) => s.price).sort((x, y) => x - y);
  const groups: number[][] = [];
  for (const p of pts) {
    const g = groups[groups.length - 1];
    // anchored to the first price of the group, so zones cannot chain into one giant band
    if (g && p - g[0] <= tol) g.push(p); else groups.push([p]);
  }
  return groups
    .filter((g) => g.length >= 2)
    .map((g) => {
      const mid = g.reduce((s, x) => s + x, 0) / g.length;
      const half = Math.max((g[g.length - 1] - g[0]) / 2, tol / 3);
      return { from: mid - half, to: mid + half, mid, touches: g.length, kind: mid < last ? ("support" as const) : ("resistance" as const) };
    });
}

export function profile(cs: Candle[], BINS = 40): Profile {
  let lo = Infinity, hi = -Infinity, total = 0;
  for (const c of cs) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); total += c.v; }
  const step = (hi - lo || hi || 1) / BINS;
  const bins = new Array(BINS).fill(0);
  for (const c of cs) {
    const a = Math.max(0, Math.min(BINS - 1, Math.floor((c.l - lo) / step)));
    const b = Math.max(0, Math.min(BINS - 1, Math.floor((c.h - lo) / step)));
    for (let i = a; i <= b; i++) bins[i] += c.v / (b - a + 1);
  }
  const p = bins.indexOf(Math.max(...bins));
  // value area: grow out from the POC until 70% of volume is covered
  let a = p, b = p, acc = bins[p];
  while (acc < total * 0.7 && (a > 0 || b < BINS - 1)) {
    const down = a > 0 ? bins[a - 1] : -1, up = b < BINS - 1 ? bins[b + 1] : -1;
    if (up >= down) acc += bins[++b]; else acc += bins[--a];
  }
  return { lo, step, bins, poc: lo + (p + 0.5) * step, val: lo + a * step, vah: lo + (b + 1) * step, total };
}

/** Fibonacci retracement of the main move in the window (lowest low ↔ highest high, in time order) */
export function fib(cs: Candle[]): Fib | null {
  if (cs.length < 10) return null;
  let h = 0, l = 0;
  cs.forEach((c, i) => { if (c.h > cs[h].h) h = i; if (c.l < cs[l].l) l = i; });
  const up = l < h; // low came first -> the move was up, retrace back down
  const A = up ? { p: cs[l].l, t: cs[l].t } : { p: cs[h].h, t: cs[h].t };
  const B = up ? { p: cs[h].h, t: cs[h].t } : { p: cs[l].l, t: cs[l].t };
  const d = B.p - A.p;
  return {
    from: A.p, to: B.p, tFrom: A.t, tTo: B.t, up,
    levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({ r, price: B.p - d * r })),
  };
}

export type Read = {
  bias: "Bullish" | "Bearish" | "Ranging";
  score: number; // -100..100
  reasons: string[];
  support: Zone[];
  resistance: Zone[];
  invalidation: number | null;
  rsi: number | null;
  plan: string[];
};

export function analyse(cs: Candle[]) {
  const closes = cs.map((c) => c.c);
  const last = closes[closes.length - 1];
  const a = atr(cs);
  const sw = swings(cs, Math.max(3, Math.round(cs.length / 40)));
  const st = structure(cs, sw, Math.max(3, Math.round(cs.length / 40)));
  const zs = zones(cs, sw, a, last);
  const vp = profile(cs);
  const fb = fib(cs);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const vw = vwap(cs);
  const r = rsi(closes);
  const rNow = r[r.length - 1];

  // bias score from structure, EMAs, VWAP, POC
  let score = 0;
  const reasons: string[] = [];
  const lastH = [...sw].reverse().find((s) => s.kind === "high");
  const lastL = [...sw].reverse().find((s) => s.kind === "low");
  if (lastH?.label === "HH" && lastL?.label === "HL") { score += 35; reasons.push("Higher highs and higher lows — uptrend structure"); }
  else if (lastH?.label === "LH" && lastL?.label === "LL") { score -= 35; reasons.push("Lower highs and lower lows — downtrend structure"); }
  else reasons.push("Mixed swings — no clean trend structure");
  const lb = st.breaks[st.breaks.length - 1];
  if (lb) {
    score += lb.dir === "up" ? 15 : -15;
    reasons.push(`Last break: ${lb.kind} ${lb.dir === "up" ? "up" : "down"} through $${lb.price.toPrecision(4)}`);
  }
  const em = e20[e20.length - 1] > e50[e50.length - 1];
  score += em ? 15 : -15;
  reasons.push(em ? "EMA 20 above EMA 50 — short-term momentum up" : "EMA 20 below EMA 50 — short-term momentum down");
  const aboveV = last > vw[vw.length - 1];
  score += aboveV ? 15 : -15;
  reasons.push(aboveV ? "Price above VWAP — buyers in control of the session" : "Price below VWAP — sellers in control of the session");
  const aboveP = last > vp.poc;
  score += aboveP ? 10 : -10;
  reasons.push(`Price ${aboveP ? "above" : "below"} the point of control (busiest price)`);
  if (rNow != null) {
    if (rNow > 70) { score -= 10; reasons.push(`RSI ${rNow.toFixed(0)} — overbought, pullback risk`); }
    else if (rNow < 30) { score += 10; reasons.push(`RSI ${rNow.toFixed(0)} — oversold, bounce possible`); }
    else reasons.push(`RSI ${rNow.toFixed(0)} — neutral`);
  }
  score = Math.max(-100, Math.min(100, score));
  const bias = score >= 25 ? "Bullish" : score <= -25 ? "Bearish" : "Ranging";

  const support = zs.filter((z) => z.mid < last).sort((x, y) => y.mid - x.mid).slice(0, 2);
  const resistance = zs.filter((z) => z.mid > last).sort((x, y) => x.mid - y.mid).slice(0, 2);
  const invalidation = bias === "Bullish" ? lastL?.price ?? null : bias === "Bearish" ? lastH?.price ?? null : null;
  const f = (p: number) => `$${p.toPrecision(4)}`;
  const plan: string[] = [];
  if (resistance[0]) plan.push(`Break and close above ${f(resistance[0].to)} → next resistance ${resistance[1] ? f(resistance[1].mid) : "open sky (new high)"}`);
  if (support[0]) plan.push(`Lose ${f(support[0].from)} → likely revisit ${support[1] ? f(support[1].mid) : f(vp.val)}`);
  if (fb) {
    const g1 = fb.levels.find((l) => l.r === 0.5)!.price, g2 = fb.levels.find((l) => l.r === 0.618)!.price;
    plan.push(`Golden pocket (0.5–0.618 of the ${fb.up ? "pump" : "drop"}): ${f(Math.min(g1, g2))} – ${f(Math.max(g1, g2))}`);
  }
  if (invalidation) plan.push(`${bias} view is invalid on a close ${bias === "Bullish" ? "below" : "above"} ${f(invalidation)}`);

  const read: Read = { bias, score, reasons, support, resistance, invalidation, rsi: rNow, plan };
  const shown = [...support, ...resistance];
  return { last, atr: a, swings: sw, ...st, sweeps: st.sweeps.slice(-4), zones: shown, profile: vp, fib: fb, ema20: e20, ema50: e50, vwap: vw, rsi: r, read };
}
export type Analysis = ReturnType<typeof analyse>;
