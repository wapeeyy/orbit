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
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchCandles } from "@/lib/analysis";
import { analyse as taAnalyse, type Analysis, type Zone } from "@/lib/ta";
import { fetchWhales, type WhaleTrade } from "@/lib/whales";
import { makeShareImage, renderShareChart, shareImage } from "./share";
import { api } from "./key";
import { backtest, type Backtest } from "@/lib/backtest";
import { addAlert, getAlerts, onAlertsChange, removeAlert, type PriceAlert } from "./alerts";

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

type Layer = "structure" | "levels" | "profile" | "fib" | "whales" | "dev" | "ema" | "vwap" | "rsi";
const LAYERS: { id: Layer; label: string; color: string; pro?: boolean; ultra?: boolean }[] = [
  { id: "structure", label: "Structure", color: "#f3d9a4", pro: true },
  { id: "levels", label: "S/R zones", color: "#7aa2ff", pro: true },
  { id: "profile", label: "Volume profile", color: ZONE, pro: true },
  { id: "whales", label: "Whales", color: "#4dd0ff", pro: true, ultra: true },
  { id: "dev", label: "Dev wallet", color: "#ff8a3d", pro: true },
  { id: "fib", label: "Fib", color: "#c792ea", pro: true },
  { id: "ema", label: "EMA 20/50", color: "#5ad1ff" },
  { id: "vwap", label: "VWAP", color: "#ffffff" },
  { id: "rsi", label: "RSI", color: "#b388ff" },
];
const DEFAULT_LAYERS: Layer[] = ["structure", "levels", "profile", "whales", "dev", "ema", "rsi"];
const kusd = (n: number) => "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export default function Chart({
  pool,
  token,
  symbol = "",
  pro = false,
  ultra = false,
  dev,
  onSubscribe,
  onTrace,
  fixture,
  whalesFixture,
  layers: initialLayers,
}: {
  pool: string;
  token: string;
  symbol?: string;
  pro?: boolean;
  ultra?: boolean;
  dev?: string | null;
  onSubscribe?: () => void;
  onTrace?: (wallet: string) => void;
  fixture?: Record<string, Candle[]>;
  whalesFixture?: WhaleTrade[];
  layers?: Layer[];
}) {
  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(initialLayers ?? DEFAULT_LAYERS));
  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const wrap = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const [whales, setWhales] = useState<WhaleTrade[] | null>(null);
  const [devSwaps, setDevSwaps] = useState<DevSwap[] | null>(null);
  useEffect(() => {
    if (!pro || !dev || fixture) return;
    let dead = false;
    api(`/api/swaps?address=${dev}&mint=${token}`)
      .then((r) => r.json())
      .then((j) => !dead && setDevSwaps(j.swaps ?? []))
      .catch(() => !dead && setDevSwaps([]));
    return () => {
      dead = true;
    };
  }, [pro, dev, token, fixture]);
  const [vh, setVh] = useState(800);

  useEffect(() => {
    if (!ultra) return;
    if (whalesFixture) return setWhales(whalesFixture);
    let dead = false;
    fetchWhales(pool, token).then((w) => !dead && setWhales(w)).catch(() => !dead && setWhales([]));
    return () => {
      dead = true;
    };
  }, [pool, token, ultra, whalesFixture]);

  // full-screen chart: real fullscreen + landscape where the browser allows it, CSS overlay otherwise (iPhone)
  async function enterFull() {
    setFull(true);
    try {
      await wrap.current?.requestFullscreen?.();
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
    } catch {}
  }
  async function exitFull() {
    setFull(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      screen.orientation?.unlock?.();
    } catch {}
  }
  useEffect(() => {
    if (!full) return;
    const r = () => setVh(window.innerHeight);
    r();
    window.addEventListener("resize", r);
    const fs = () => !document.fullscreenElement && setFull(false);
    document.addEventListener("fullscreenchange", fs);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", r);
      document.removeEventListener("fullscreenchange", fs);
      document.body.style.overflow = "";
    };
  }, [full]);

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
  const bt = useMemo(() => (ultra && candles ? backtest(candles) : null), [ultra, candles]);
  const allowed = (l: Layer) => {
    const d = LAYERS.find((x) => x.id === l);
    return d?.ultra ? ultra : d?.pro ? pro : true;
  };
  async function share() {
    if (!chartRef.current || !ta) return;
    setShareMsg("Preparing image…");
    try {
      const shot = await renderShareChart(candles!, ta, a!.hi.h, a!.lo.l);
      const blob = await makeShareImage({ chart: shot, overlay: null, ta, sym: symbol || "COIN", tf, fmt: fmtPrice });
      const r = await shareImage(blob, `ORBIT-${symbol || "read"}-${tf}.png`, `$${symbol} ${tf} read by ORBIT · orbitonsol.com`);
      setShareMsg(r === "downloaded" ? "Image saved — post it anywhere." : null);
    } catch {
      setShareMsg("Couldn't make the image.");
    }
    setTimeout(() => setShareMsg(null), 4000);
  }
  const on = (l: Layer) => layers.has(l) && allowed(l);
  const toggle = (l: Layer) => {
    if (!allowed(l)) return onSubscribe?.();
    setLayers((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l); else n.add(l);
      return n;
    });
  };

  useEffect(() => {
    if (!box.current || !candles || candles.length === 0 || !a) return;
    const el = box.current;
    const showRsi = on("rsi") && !!ta;
    const chart = createChart(el, {
      height: full ? Math.max(260, vh - (showRsi ? 120 : 110)) : showRsi ? 430 : 360,
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

    chartRef.current = chart;
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
    if (on("whales") && whales) {
      // one marker per candle & side (summed), only the biggest few so the chart stays readable
      const step = candles.length > 1 ? candles[1].t - candles[0].t : 60;
      const first = candles[0].t, lastT = candles[candles.length - 1].t + step;
      const agg = new Map<string, { t: number; kind: "buy" | "sell"; usd: number; n: number }>();
      for (const w of whales) {
        if (w.t < first || w.t >= lastT) continue;
        const t = first + Math.floor((w.t - first) / step) * step;
        const k = `${t}-${w.kind}`;
        const g = agg.get(k) ?? { t, kind: w.kind, usd: 0, n: 0 };
        g.usd += w.usd; g.n++;
        agg.set(k, g);
      }
      const top = [...agg.values()].sort((x, y) => y.usd - x.usd).slice(0, el.clientWidth < 600 ? 4 : 7);
      for (const g of top)
        markers.push({ time: g.t as UTCTimestamp, position: g.kind === "buy" ? "belowBar" : "aboveBar", color: g.kind === "buy" ? "#4dd0ff" : "#ff7ab6", shape: "circle", size: 0.5, text: `${g.kind === "buy" ? "WHALE BUY" : "WHALE SELL"} ${kusd(g.usd)}${g.n > 1 ? ` ×${g.n}` : ""}` });
    }
    if (on("dev") && devSwaps?.length) {
      const step = candles.length > 1 ? candles[1].t - candles[0].t : 60;
      const first = candles[0].t, lastT = candles[candles.length - 1].t + step;
      for (const d of devSwaps) {
        const ts = Math.floor(d.ts / 1000);
        if (ts < first || ts >= lastT) continue;
        const t = first + Math.floor((ts - first) / step) * step;
        markers.push({ time: t as UTCTimestamp, position: d.side === "BUY" ? "belowBar" : "aboveBar", color: d.side === "BUY" ? "#ffb84d" : "#ff3b30", shape: d.side === "BUY" ? "arrowUp" : "arrowDown", text: `DEV ${d.side} ${kusd(d.usd)}` });
      }
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
      const W = chart.options().width || el.clientWidth, H = chart.paneSize(0).height;
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
    drawRef.current = draw;
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
      chartRef.current = null;
      ro.disconnect();
      chart.remove();
      cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, a, ta, tf, layers, pro, whales, devSwaps, full, vh]);

  const span = TFS.find((x) => x.id === tf)!.span;

  return (
    <section ref={wrap} className={`card chart-card ${full ? "full" : ""}`}>
      <div className="section-head">
        <h3>Chart</h3>
        <button className="full-btn" onClick={() => (full ? exitFull() : enterFull())} title={full ? "Exit full screen" : "Full screen"}>
          {full ? "✕ Close" : "⤢ Full screen"}
        </button>
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
          <button key={l.id} className={`${on(l.id) ? "on" : ""} ${!allowed(l.id) ? "locked" : ""}`} onClick={() => toggle(l.id)} style={{ ["--c" as string]: l.color }}>
            <i />{l.label}{!allowed(l.id) && <em className="lock-tag">{l.ultra && pro ? "Ultra" : "Pro"}</em>}
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

      {full && <p className="muted small full-hint">Tip: turn your phone sideways for a wider chart.</p>}
      {pro && dev && devSwaps && <DevPanel swaps={devSwaps} dev={dev} onTrace={onTrace} />}
      {ta && pro && <OrbitRead ta={ta} tf={tf} onShare={share} shareMsg={shareMsg} />}
      {ultra && bt && bt.samples >= 5 && <BacktestCard bt={bt} tf={tf} />}
      {pro && (ultra ? <MultiRead pool={pool} token={token} fixture={fixture} /> : <UltraTeaser onSubscribe={onSubscribe} />)}
      {ta && pro && <AlertBox ta={ta} ca={token} symbol={symbol} max={ultra ? Infinity : 5} />}
      {ultra && on("whales") && whales && whales.length > 0 && <WhaleList whales={whales} onTrace={onTrace} />}
      {ta && !pro && (
        <div className="read locked-read" onClick={onSubscribe}>
          <span className="label">ORBIT read · {tf}</span>
          <div className="read-bias blur">{ta.read.bias}</div>
          <p className="small"><b>ORBIT Pro</b>: market structure (HH/HL/LH/LL, BOS, CHoCH), support &amp; resistance, volume profile, fib, whale trades on the chart, a daily read with key levels — and price alerts.</p>
          <button className="copy primary">Unlock with Pro</button>
        </div>
      )}

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
function OrbitRead({ ta, tf, onShare, shareMsg }: { ta: Analysis; tf: string; onShare?: () => void; shareMsg?: string | null }) {
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
        {onShare && (
          <button className="share-btn" onClick={onShare}>
            Share read
          </button>
        )}
      </div>
      {shareMsg && <p className="muted small" style={{ margin: "8px 0 0" }}>{shareMsg}</p>}
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

/** Set price alerts on the key levels (or any price) */
function AlertBox({ ta, ca, symbol, max }: { ta: Analysis; ca: string; symbol: string; max: number }) {
  const [list, setList] = useState<PriceAlert[]>([]);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    const sync = () => setList(getAlerts().filter((a) => a.ca === ca));
    sync();
    return onAlertsChange(sync);
  }, [ca]);
  const r = ta.read;
  const quick = [
    ...r.resistance.map((z, i) => ({ label: `R${i + 1}`, price: z.mid })),
    ...r.support.map((z, i) => ({ label: `S${i + 1}`, price: z.mid })),
    { label: "POC", price: ta.profile.poc },
    ...(r.invalidation != null ? [{ label: "Invalid", price: r.invalidation }] : []),
  ];
  const add = (price: number, label?: string) =>
    getAlerts().filter((a) => !a.hit).length >= max
      ? alert(`Pro includes ${max} active alerts. Remove one, or upgrade to Ultra for unlimited alerts.`)
      : addAlert({ ca, symbol: symbol || ca.slice(0, 4), price, label, dir: price >= ta.last ? "above" : "below" });
  return (
    <div className="alerts">
      <span className="label">Price alerts</span>
      <div className="alert-quick">
        {quick.map((q) => (
          <button key={q.label} onClick={() => add(q.price, q.label)}>
            + {q.label} <em>${fmtPrice(q.price)}</em>
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = Number(custom.replace(/[$,\s]/g, ""));
            if (p > 0) add(p);
            setCustom("");
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom price" inputMode="decimal" />
          <button type="submit">Add</button>
        </form>
      </div>
      {list.length > 0 && (
        <ul className="alert-list">
          {list.map((a) => (
            <li key={a.id} className={a.hit ? "hit" : ""}>
              <span>{a.dir === "above" ? "▲" : "▼"} ${fmtPrice(a.price)} {a.label && <em>{a.label}</em>}</span>
              <span className="small">{a.hit ? "Triggered" : `${pct((a.price / ta.last - 1) * 100)} away`}</span>
              <button onClick={() => removeAlert(a.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Alerts are checked every 30 s while ORBIT is open on this device (sound + notification).</p>
    </div>
  );
}

/** Biggest trades on this pool, newest first */
function WhaleList({ whales, onTrace }: { whales: WhaleTrade[]; onTrace?: (w: string) => void }) {
  const buys = whales.filter((w) => w.kind === "buy").reduce((s, w) => s + w.usd, 0);
  const sells = whales.filter((w) => w.kind === "sell").reduce((s, w) => s + w.usd, 0);
  return (
    <div className="whales">
      <div className="whales-head">
        <span className="label">Whale trades · last 24h</span>
        <span className="small"><b className="up">Buy {kusd(buys)}</b> · <b className="down">Sell {kusd(sells)}</b></span>
      </div>
      <ul>
        {[...whales].reverse().slice(0, 8).map((w) => (
          <li key={w.tx}>
            <b className={w.kind === "buy" ? "up" : "down"}>{w.kind.toUpperCase()}</b>
            <span>{kusd(w.usd)}</span>
            <span className="muted small">{when(w.t)}</span>
            {onTrace ? (
              <button onClick={() => onTrace(w.wallet)} title="Trace this wallet">{w.wallet.slice(0, 4)}…{w.wallet.slice(-4)} →</button>
            ) : (
              <span className="mono small">{w.wallet.slice(0, 4)}…{w.wallet.slice(-4)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MTF: { id: string; label: string }[] = [
  { id: "5m", label: "5m" },
  { id: "1h", label: "1h" },
  { id: "4h", label: "4h" },
  { id: "1d", label: "1D" },
];

/** Ultra: the ORBIT read for every timeframe at once */
function MultiRead({ pool, token, fixture }: { pool: string; token: string; fixture?: Record<string, Candle[]> }) {
  const [rows, setRows] = useState<Record<string, Analysis | null | false | undefined>>({});
  useEffect(() => {
    let dead = false;
    (async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (const t of MTF) {
        const [frame, agg, limit] = GT[t.id];
        let cs: Candle[] | null = null;
        // GeckoTerminal rate-limits bursts: retry with a growing pause instead of giving up
        for (let attempt = 0; attempt < 4 && !cs && !dead; attempt++) {
          try {
            cs = fixture ? fixture[t.id] ?? [] : await fetchCandles(pool, token, frame, agg, limit);
          } catch {
            await wait(1500 * (attempt + 1));
          }
        }
        if (dead) return;
        setRows((r) => ({ ...r, [t.id]: cs && cs.length > 30 ? taAnalyse(cs) : cs ? null : false }));
        await wait(400);
      }
    })();
    return () => {
      dead = true;
    };
  }, [pool, token, fixture]);
  const done = MTF.map((t) => rows[t.id]).filter(Boolean) as Analysis[];
  const avg = done.length ? Math.round(done.reduce((s, a) => s + a.read.score, 0) / done.length) : 0;
  const agree = done.length > 1 && done.every((a) => a.read.bias === done[0].read.bias);
  return (
    <div className="mtf">
      <div className="mtf-head">
        <span className="label">Multi-timeframe read · Ultra</span>
        {done.length > 0 && (
          <span className={`small ${avg >= 25 ? "up" : avg <= -25 ? "down" : ""}`}>
            {agree ? `All timeframes ${done[0].read.bias.toLowerCase()}` : "Timeframes disagree"} · avg {avg > 0 ? "+" : ""}
            {avg}
          </span>
        )}
      </div>
      <div className="mtf-grid">
        <span className="mtf-h">TF</span>
        <span className="mtf-h">Bias</span>
        <span className="mtf-h">Score</span>
        <span className="mtf-h">RSI</span>
        <span className="mtf-h">S1</span>
        <span className="mtf-h">R1</span>
        {MTF.map((t) => {
          const a = rows[t.id];
          if (a === undefined) return <span key={t.id} className="mtf-row muted small">{t.label} · loading…</span>;
          if (a === null) return <span key={t.id} className="mtf-row muted small">{t.label} · coin too new for this timeframe</span>;
          if (a === false) return <span key={t.id} className="mtf-row muted small">{t.label} · couldn&apos;t load, refresh to retry</span>;
          const r = a.read;
          const tone = r.bias === "Bullish" ? "up" : r.bias === "Bearish" ? "down" : "flat";
          return (
            <div key={t.id} className="mtf-cells">
              <b>{t.label}</b>
              <span className={`mtf-bias ${tone}`}>{r.bias}</span>
              <span className="mtf-score">
                <i style={{ left: `${(r.score + 100) / 2}%` }} />
              </span>
              <span>{r.rsi != null ? r.rsi.toFixed(0) : "—"}</span>
              <span className="up">{r.support[0] ? `$${fmtPrice(r.support[0].mid)}` : "—"}</span>
              <span className="down">{r.resistance[0] ? `$${fmtPrice(r.resistance[0].mid)}` : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UltraTeaser({ onSubscribe }: { onSubscribe?: () => void }) {
  return (
    <div className="mtf locked-read" onClick={onSubscribe}>
      <span className="label">Multi-timeframe read · Ultra</span>
      <p className="small">
        <b>ORBIT Ultra</b>: 5m · 1h · 4h · 1D read on one screen, whale trades on the chart, unlimited alerts.
      </p>
    </div>
  );
}

type DevSwap = { ts: number; side: "BUY" | "SELL"; amount: number; sol: number; usd: number; signature: string };

/** Pro: what the creator wallet has done with this coin */
function DevPanel({ swaps, dev, onTrace }: { swaps: DevSwap[]; dev: string; onTrace?: (w: string) => void }) {
  const day = Date.now() - 86_400_000;
  const sold24 = swaps.filter((s) => s.side === "SELL" && s.ts > day).reduce((t, s) => t + s.usd, 0);
  const soldAll = swaps.filter((s) => s.side === "SELL").reduce((t, s) => t + s.usd, 0);
  const alarm = sold24 > 0;
  return (
    <div className={`devpanel ${alarm ? "alarm" : ""}`}>
      <div className="whales-head">
        <span className="label">Dev wallet</span>
        <button className="mono small dev-addr" onClick={() => onTrace?.(dev)}>{dev.slice(0, 4)}…{dev.slice(-4)} →</button>
      </div>
      {swaps.length === 0 ? (
        <p className="small muted">No buys or sells of this coin by the dev in their recent transactions.</p>
      ) : (
        <>
          <p className={`small ${alarm ? "down" : ""}`}>
            {alarm ? `The dev sold ${kusd(sold24)} of this coin in the last 24 hours.` : `No dev sells in the last 24 hours.`}
            {soldAll > sold24 ? ` ${kusd(soldAll)} sold in total in recent history.` : ""}
          </p>
          <ul>
            {swaps.slice(0, 5).map((s) => (
              <li key={s.signature}>
                <b className={s.side === "BUY" ? "up" : "down"}>{s.side}</b>
                <span>{kusd(s.usd)}</span>
                <span className="muted small">{when(Math.floor(s.ts / 1000))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Ultra: how the ORBIT Read did on this coin's own history */
function BacktestCard({ bt, tf }: { bt: Backtest; tf: string }) {
  const row = (label: string, x: Backtest["bull"], good: "up" | "down") =>
    x.n === 0 ? null : (
      <div className="bt-row">
        <span className={good}>{label}</span>
        <div className="bt-bar"><i className={good} style={{ width: `${x.hit}%` }} /></div>
        <b>{x.hit}%</b>
        <span className="muted small">{x.n} reads · avg {x.avg > 0 ? "+" : ""}{x.avg.toFixed(1)}%</span>
      </div>
    );
  return (
    <div className="mtf bt">
      <span className="label">Read track record · Ultra</span>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        The ORBIT Read replayed on this coin&apos;s {tf} history: how often price moved the way the read said over the next {bt.horizon} candles.
      </p>
      {row("Bullish reads", bt.bull, "up")}
      {row("Bearish reads", bt.bear, "down")}
      <p className="muted small" style={{ margin: "8px 0 0" }}>Past behaviour on one coin, not a promise.</p>
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
