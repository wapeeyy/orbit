"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchCandles } from "@/lib/analysis";
import { analyse as taAnalyse, type Analysis, type Zone } from "@/lib/ta";

// tf -> [timeframe GeckoTerminal, aggregate, bilangan candle]  (sama dengan /api/chart)
const GT: Record<string, [string, number, number]> = {
  "5m": ["minute", 5, 288],
  "15m": ["minute", 15, 192],
  "1h": ["hour", 1, 168],
  "4h": ["hour", 4, 180],
  "1d": ["day", 1, 365],
};

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const TFS = [
  { id: "5m", label: "5m", span: "24h" },
  { id: "15m", label: "15m", span: "2d" },
  { id: "1h", label: "1h", span: "7d" },
  { id: "4h", label: "4h", span: "30d" },
  { id: "1d", label: "1d", span: "1y" },
];

const UP = "#3ee6a0";
const DOWN = "#ff4d5e";
const ZONE = "#ffb84d";

/** Harga kecil: kekalkan 4 digit bererti, contoh 0.000002181 */
export function fmtPrice(p: number) {
  if (!isFinite(p)) return "—";
  if (p < 0) return ""; // paksi kadang-kadang turun bawah 0 — sembunyikan
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (p === 0) return "0";
  const zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  return p.toFixed(Math.min(zeros + 4, 18));
}
const usd = (n: number) =>
  "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const when = (t: number) =>
  new Date(t * 1000).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;

function analyse(cs: Candle[]) {
  if (cs.length === 0) return null;
  let hi = cs[0], lo = cs[0], big = cs[0], total = 0, ups = 0;
  for (const c of cs) {
    if (c.h > hi.h) hi = c;
    if (c.l < lo.l) lo = c;
    if (c.v > big.v) big = c;
    total += c.v;
    if (c.c >= c.o) ups++;
  }
  const last = cs[cs.length - 1];
  const first = cs[0];

  // Profil volume: agih volume setiap candle ke zon harga yang dilaluinya
  const BINS = 24;
  const range = hi.h - lo.l || hi.h || 1;
  const step = range / BINS;
  const bins = new Array(BINS).fill(0);
  for (const c of cs) {
    const a = Math.max(0, Math.min(BINS - 1, Math.floor((c.l - lo.l) / step)));
    const b = Math.max(0, Math.min(BINS - 1, Math.floor((c.h - lo.l) / step)));
    for (let i = a; i <= b; i++) bins[i] += c.v / (b - a + 1);
  }
  const top = bins.indexOf(Math.max(...bins));
  const zone = {
    from: lo.l + top * step,
    to: lo.l + (top + 1) * step,
    share: total ? (bins[top] / total) * 100 : 0,
  };

  return {
    last: last.c,
    hi,
    lo,
    big,
    total,
    ups,
    downs: cs.length - ups,
    change: first.o ? (last.c / first.o - 1) * 100 : 0,
    fromHi: hi.h ? (last.c / hi.h - 1) * 100 : 0,
    fromLo: lo.l ? (last.c / lo.l - 1) * 100 : 0,
    zone,
    bins,
  };
}

type Layer = "structure" | "levels" | "profile" | "fib" | "ema" | "vwap" | "rsi";
const LAYERS: { id: Layer; label: string; color: string }[] = [
  { id: "structure", label: "Structure", color: "#f3d9a4" },
  { id: "levels", label: "S/R zones", color: "#7aa2ff" },
  { id: "profile", label: "Volume profile", color: ZONE },
  { id: "fib", label: "Fib", color: "#c792ea" },
  { id: "ema", label: "EMA 20/50", color: "#5ad1ff" },
  { id: "vwap", label: "VWAP", color: "#ffffff" },
  { id: "rsi", label: "RSI", color: "#b388ff" },
];
const DEFAULT_LAYERS: Layer[] = ["structure", "levels", "profile", "ema", "rsi"];

export default function Chart({ pool, token, fixture, layers: initialLayers }: { pool: string; token: string; fixture?: Record<string, Candle[]>; layers?: Layer[] }) {
  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(initialLayers ?? DEFAULT_LAYERS));
  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let dead = false;
    setCandles(null);
    setError(null);
    if (fixture) {
      setCandles(fixture[tf] ?? []);
      return;
    }
    // Straight from the browser (GeckoTerminal blocks Vercel IPs); fall back to the server route
    const [frame, agg, limit] = GT[tf];
    fetchCandles(pool, token, frame, agg, limit)
      .catch(() =>
        fetch(`/api/chart?pool=${pool}&token=${token}&tf=${tf}`).then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          return j.candles as Candle[];
        }),
      )
      .then((cs) => !dead && setCandles(cs))
      .catch((e) => !dead && setError(e.message));
    return () => {
      dead = true;
    };
  }, [pool, token, tf, fixture]);

  const a = useMemo(() => (candles ? analyse(candles) : null), [candles]);
  const ta = useMemo(() => (candles && candles.length > 30 ? taAnalyse(candles) : null), [candles]);
  const on = (l: Layer) => layers.has(l);
  const toggle = (l: Layer) =>
    setLayers((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l); else n.add(l);
      return n;
    });

  useEffect(() => {
    if (!box.current || !candles || candles.length === 0 || !a) return;
    const el = box.current;
    const showRsi = on("rsi") && !!ta;
    const chart = createChart(el, {
      height: showRsi ? 430 : 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a90a6",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: "#1f2333", enableResize: false },
      },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#1f2333" },
      timeScale: { borderColor: "#1f2333", timeVisible: tf !== "1d", secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: fmtPrice, timeFormatter: (t: number) => when(t) },
      crosshair: { mode: 0 },
    });

    const price = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 },
    });
    price.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));

    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    price.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    vol.setData(
      candles.map((c) => ({
        time: c.t as UTCTimestamp,
        value: c.v,
        color: c.t === a.big.t ? ZONE : c.c >= c.o ? "rgba(62,230,160,0.3)" : "rgba(255,77,94,0.3)",
      })),
    );

    const line = (data: number[], color: string, width = 1, style = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as 1, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: fmtPrice, minMove: 1e-12 } });
      s.setData(candles.map((c, i) => ({ time: c.t as UTCTimestamp, value: data[i] })));
    };
    if (ta && on("ema")) {
      line(ta.ema20, "#5ad1ff", 1);
      line(ta.ema50, "#3f6fd8", 2);
    }
    if (ta && on("vwap")) line(ta.vwap, "rgba(255,255,255,0.75)", 1, LineStyle.Dashed);

    price.createPriceLine({ price: a.hi.h, color: UP, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "High" });
    price.createPriceLine({ price: a.lo.l, color: DOWN, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Low" });
    if (ta && on("profile")) price.createPriceLine({ price: ta.profile.poc, color: ZONE, lineStyle: LineStyle.Solid, lineWidth: 1, axisLabelVisible: true, title: "POC" });

    const markers: SeriesMarker<UTCTimestamp>[] = [];
    if (ta && on("structure")) {
      for (const s of ta.swings.slice(el.clientWidth < 600 ? -8 : -14)) {
        if (s.label === "H" || s.label === "L") continue;
        const bull = s.label === "HH" || s.label === "HL";
        markers.push({ time: s.t as UTCTimestamp, position: s.kind === "high" ? "aboveBar" : "belowBar", color: bull ? UP : DOWN, shape: "circle", size: 0.3, text: s.label });
      }
      for (const w of ta.sweeps)
        markers.push({ time: w.t as UTCTimestamp, position: w.dir === "high" ? "aboveBar" : "belowBar", color: "#f3d9a4", shape: w.dir === "high" ? "arrowDown" : "arrowUp", text: "Sweep" });
    } else {
      markers.push({ time: a.hi.t as UTCTimestamp, position: "aboveBar", color: UP, shape: "arrowDown", text: "HIGH" });
      markers.push({ time: a.lo.t as UTCTimestamp, position: "belowBar", color: DOWN, shape: "arrowUp", text: "LOW" });
    }
    createSeriesMarkers(price, markers.sort((x, y) => (x.time as number) - (y.time as number)));

    if (showRsi && ta) {
      const r = chart.addSeries(LineSeries, { color: "#b388ff", lineWidth: 1, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: 0, minMove: 1 } }, 1);
      r.setData(candles.map((c, i) => (ta.rsi[i] == null ? { time: c.t as UTCTimestamp } : { time: c.t as UTCTimestamp, value: ta.rsi[i] as number })));
      r.createPriceLine({ price: 70, color: "rgba(255,77,94,0.5)", lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      r.createPriceLine({ price: 30, color: "rgba(62,230,160,0.5)", lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      chart.panes()[1]?.setHeight(80);
    }

    // ---- overlay: zones, BOS/CHoCH, fib, volume profile ----
    const cv = overlay.current!;
    let alive = true;
    const draw = () => {
      if (!ta || !alive) return;
      const dpr = window.devicePixelRatio || 1;
      const W = el.clientWidth, H = chart.paneSize(0).height;
      const plotW = chart.timeScale().width();
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      cv.width = W * dpr;
      cv.height = H * dpr;
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.save();
      g.beginPath();
      g.rect(0, 0, plotW, H);
      g.clip();
      const y = (p: number) => price.priceToCoordinate(p);
      const x = (t: number) => chart.timeScale().timeToCoordinate(t as UTCTimestamp);
      g.font = "600 10px system-ui, sans-serif";

      if (on("levels")) {
        const names = new Map<Zone, string>();
        ta.read.resistance.forEach((z, i) => names.set(z, `R${i + 1}`));
        ta.read.support.forEach((z, i) => names.set(z, `S${i + 1}`));
        let lastLabelY = -99;
        for (const z of [...ta.zones].sort((p, q) => q.mid - p.mid)) {
          const y1 = y(z.to), y2 = y(z.from);
          if (y1 == null || y2 == null) continue;
          const sup = z.kind === "support";
          g.fillStyle = sup ? "rgba(62,230,160,0.08)" : "rgba(255,77,94,0.08)";
          g.fillRect(0, y1, plotW, Math.max(2, y2 - y1));
          g.strokeStyle = sup ? "rgba(62,230,160,0.35)" : "rgba(255,77,94,0.35)";
          g.lineWidth = 1;
          g.strokeRect(-1, y1, plotW + 2, Math.max(2, y2 - y1));
          g.fillStyle = sup ? "rgba(62,230,160,0.9)" : "rgba(255,77,94,0.9)";
          const ly = Math.max(y1 - 3, lastLabelY + 12);
          g.fillText(`${names.get(z) ?? ""} ${sup ? "Support" : "Resistance"} ×${z.touches}`, 6, ly);
          lastLabelY = ly;
        }
      }

      if (on("fib") && ta.fib) {
        const f = ta.fib;
        const x0 = x(f.tFrom) ?? 0;
        const gp = f.levels.filter((l) => l.r === 0.5 || l.r === 0.618);
        const ga = y(gp[0].price), gb = y(gp[1].price);
        if (ga != null && gb != null) {
          g.fillStyle = "rgba(199,146,234,0.12)";
          g.fillRect(x0, Math.min(ga, gb), plotW - x0, Math.abs(gb - ga));
        }
        for (const l of f.levels) {
          const yy = y(l.price);
          if (yy == null) continue;
          g.strokeStyle = "rgba(199,146,234,0.55)";
          g.setLineDash([2, 3]);
          g.beginPath(); g.moveTo(x0, yy); g.lineTo(plotW, yy); g.stroke();
          g.setLineDash([]);
          g.fillStyle = "rgba(199,146,234,0.95)";
          const fl = l.r === 0.618 ? "0.618 golden" : `${l.r}`;
          g.fillText(fl, plotW - Math.min(90, plotW * 0.22) - g.measureText(fl).width - 6, yy - 2);
        }
      }

      if (on("structure")) {
        for (const b of ta.breaks) {
          const x1 = x(b.tFrom), x2 = x(b.tTo), yy = y(b.price);
          if (x1 == null || x2 == null || yy == null) continue;
          const col = b.dir === "up" ? UP : DOWN;
          g.strokeStyle = col;
          g.lineWidth = 1;
          g.setLineDash(b.kind === "CHoCH" ? [4, 3] : []);
          g.beginPath(); g.moveTo(x1, yy); g.lineTo(x2, yy); g.stroke();
          g.setLineDash([]);
          g.fillStyle = col;
          const label = b.kind;
          const tw = g.measureText(label).width;
          g.fillText(label, (x1 + x2) / 2 - tw / 2, b.dir === "up" ? yy - 4 : yy + 11);
        }
      }
      g.restore();

      if (on("profile")) {
        const vp = ta.profile;
        const maxB = Math.max(...vp.bins);
        const PW = Math.min(90, plotW * 0.22);
        for (let i = 0; i < vp.bins.length; i++) {
          const lo = vp.lo + i * vp.step, hi = lo + vp.step;
          const y1 = y(hi), y2 = y(lo);
          if (y1 == null || y2 == null) continue;
          const w = (vp.bins[i] / maxB) * PW;
          const inVA = lo >= vp.val - 1e-18 && hi <= vp.vah + 1e-18;
          const isPoc = vp.poc >= lo && vp.poc < hi;
          g.fillStyle = isPoc ? "rgba(255,184,77,0.75)" : inVA ? "rgba(255,184,77,0.32)" : "rgba(255,255,255,0.12)";
          g.fillRect(plotW - w, y1 + 0.5, w, Math.max(1, y2 - y1 - 1));
        }
      }
    };
    const redraw = () => requestAnimationFrame(draw);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.subscribeCrosshairMove(redraw);
    chart.timeScale().fitContent();
    setTimeout(draw, 30);
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
      redraw();
    });
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      chart.remove();
      cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, a, ta, tf, layers]);

  const span = TFS.find((x) => x.id === tf)!.span;

  return (
    <section className="card">
      <div className="section-head">
        <h3>Chart</h3>
        <div className="tf">
          {TFS.map((x) => (
            <button key={x.id} className={tf === x.id ? "on" : ""} onClick={() => setTf(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="layers">
        {LAYERS.map((l) => (
          <button key={l.id} className={on(l.id) ? "on" : ""} onClick={() => toggle(l.id)} style={{ ["--c" as string]: l.color }}>
            <i />{l.label}
          </button>
        ))}
      </div>

      {error && <div className="alert danger">Chart: {error}</div>}
      {!error && !candles && <div className="chart-loading muted">Loading chart…</div>}
      {candles && candles.length === 0 && <div className="chart-loading muted">No candle data for this pool.</div>}
      <div className="chart-wrap" hidden={!candles || candles.length === 0}>
        <div ref={box} className="chart-box" />
        <canvas ref={overlay} className="chart-overlay" />
      </div>

      {ta && <OrbitRead ta={ta} tf={tf} />}

      {a && (
        <>
          <div className="insights">
            <Insight label={`High (${span})`} value={`$${fmtPrice(a.hi.h)}`} sub={`${when(a.hi.t)} · now ${pct(a.fromHi)}`} tone="up" />
            <Insight label={`Low (${span})`} value={`$${fmtPrice(a.lo.l)}`} sub={`${when(a.lo.t)} · now ${pct(a.fromLo)}`} tone="down" />
            <Insight
              label="Highest-volume zone"
              value={`$${fmtPrice(a.zone.from)} – $${fmtPrice(a.zone.to)}`}
              sub={`${a.zone.share.toFixed(0)}% of volume traded in this range`}
              tone="zone"
            />
            <Insight
              label="Biggest volume candle"
              value={usd(a.big.v)}
              sub={`${when(a.big.t)} · candle ${a.big.c >= a.big.o ? "up" : "down"} ${pct((a.big.c / a.big.o - 1) * 100)}`}
              tone="zone"
            />
            <Insight label={`Change (${span})`} value={pct(a.change)} sub={`Price now $${fmtPrice(a.last)}`} tone={a.change >= 0 ? "up" : "down"} />
            <Insight label={`Volume (${span})`} value={usd(a.total)} sub={`${a.ups} up candles · ${a.downs} down`} />
          </div>
          <RangeBar lo={a.lo.l} hi={a.hi.h} now={a.last} zone={a.zone} />
        </>
      )}
      <p className="muted small">Candle data: GeckoTerminal · Analysis is automatic and educational — not financial advice.</p>
    </section>
  );
}

/** Daily read: bias, key levels, reasons and what to watch */
function OrbitRead({ ta, tf }: { ta: Analysis; tf: string }) {
  const r = ta.read;
  const tone = r.bias === "Bullish" ? "up" : r.bias === "Bearish" ? "down" : "flat";
  const dist = (p: number) => pct((p / ta.last - 1) * 100);
  const rows: { k: string; p: number; tone: string; note?: string }[] = [
    ...r.resistance.slice().reverse().map((z, i, arr) => ({ k: `R${arr.length - i}`, p: z.mid, tone: "down", note: `${z.touches} touches` })),
    { k: "Now", p: ta.last, tone: "now" },
    ...r.support.map((z, i) => ({ k: `S${i + 1}`, p: z.mid, tone: "up", note: `${z.touches} touches` })),
  ];
  return (
    <div className={`read ${tone}`}>
      <div className="read-head">
        <div>
          <span className="label">ORBIT read · {tf}</span>
          <div className="read-bias">{r.bias}</div>
        </div>
        <div className="read-meter" title={`Score ${r.score}`}>
          <div className="read-meter-track"><span style={{ left: `${(r.score + 100) / 2}%` }} /></div>
          <div className="read-meter-ends small"><span>Bearish</span><span>{r.score > 0 ? "+" : ""}{r.score}</span><span>Bullish</span></div>
        </div>
      </div>
      <div className="read-grid">
        <div>
          <span className="label">Key levels</span>
          <ul className="levels">
            {rows.map((row) => (
              <li key={row.k} className={row.tone}>
                <b>{row.k}</b>
                <span>${fmtPrice(row.p)}</span>
                <em>{row.tone === "now" ? (r.rsi != null ? `RSI ${r.rsi.toFixed(0)}` : "") : dist(row.p)}</em>
              </li>
            ))}
            <li className="zone"><b>POC</b><span>${fmtPrice(ta.profile.poc)}</span><em>{dist(ta.profile.poc)}</em></li>
            <li className="zone"><b>Value</b><span>${fmtPrice(ta.profile.val)} – ${fmtPrice(ta.profile.vah)}</span><em>70% vol</em></li>
            {r.invalidation != null && (
              <li className="warn"><b>Invalid</b><span>${fmtPrice(r.invalidation)}</span><em>{dist(r.invalidation)}</em></li>
            )}
          </ul>
        </div>
        <div>
          <span className="label">Why</span>
          <ul className="why">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          <span className="label">What to watch</span>
          <ul className="why watch">{r.plan.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function Insight({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" | "down" | "zone" }) {
  return (
    <div className={`insight ${tone ?? ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="sub">{sub}</span>
    </div>
  );
}

/** Kedudukan harga sekarang antara terendah & tertinggi */
function RangeBar({ lo, hi, now, zone }: { lo: number; hi: number; now: number; zone: { from: number; to: number } }) {
  const span = hi - lo || 1;
  const frac = (p: number) => Math.max(0, Math.min(100, ((p - lo) / span) * 100));
  const at = (p: number) => `${frac(p)}%`;
  const nowAt = frac(now);
  const labelPos = nowAt < 15 ? "left" : nowAt > 85 ? "right" : "";
  return (
    <div className="range">
      <div className="range-track">
        <div className="range-zone" style={{ left: at(zone.from), width: `calc(${at(zone.to)} - ${at(zone.from)})` }} />
        <div className={`range-now ${labelPos}`} style={{ left: at(now) }}>
          <span>Now</span>
        </div>
      </div>
      <div className="range-ends small">
        <span style={{ color: DOWN }}>Low ${fmtPrice(lo)}</span>
        <span style={{ color: UP }}>High ${fmtPrice(hi)}</span>
      </div>
    </div>
  );
}
