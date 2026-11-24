"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchCandles } from "@/lib/analysis";

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

export default function Chart({ pool, token }: { pool: string; token: string }) {
  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    setCandles(null);
    setError(null);
    // Terus dari browser (GeckoTerminal sekat IP Vercel); kalau gagal, cuba melalui server
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
  }, [pool, token, tf]);

  const a = useMemo(() => (candles ? analyse(candles) : null), [candles]);

  useEffect(() => {
    if (!box.current || !candles || candles.length === 0 || !a) return;
    const el = box.current;
    const chart = createChart(el, {
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a90a6",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#1f2333" },
      timeScale: { borderColor: "#1f2333", timeVisible: tf !== "1d", secondsVisible: false },
      localization: {
        priceFormatter: fmtPrice,
        timeFormatter: (t: number) => when(t),
      },
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

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    price.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
    vol.setData(
      candles.map((c) => ({
        time: c.t as UTCTimestamp,
        value: c.v,
        color: c.t === a.big.t ? ZONE : c.c >= c.o ? "rgba(62,230,160,0.35)" : "rgba(255,77,94,0.35)",
      })),
    );

    // Garisan tertinggi / terendah / zon volume
    price.createPriceLine({ price: a.hi.h, color: UP, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "High" });
    price.createPriceLine({ price: a.lo.l, color: DOWN, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Low" });
    price.createPriceLine({ price: a.zone.to, color: ZONE, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
    price.createPriceLine({ price: a.zone.from, color: ZONE, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "Volume zone" });

    const markers = [
      { time: a.hi.t as UTCTimestamp, position: "aboveBar" as const, color: UP, shape: "arrowDown" as const, text: "HIGH" },
      { time: a.lo.t as UTCTimestamp, position: "belowBar" as const, color: DOWN, shape: "arrowUp" as const, text: "LOW" },
    ];
    if (a.big.t !== a.hi.t && a.big.t !== a.lo.t)
      markers.push({ time: a.big.t as UTCTimestamp, position: "aboveBar" as const, color: ZONE, shape: "arrowDown" as const, text: "VOL" });
    createSeriesMarkers(price, markers.sort((x, y) => x.time - y.time));

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, a, tf]);

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

      {error && <div className="alert danger">Chart: {error}</div>}
      {!error && !candles && <div className="chart-loading muted">Loading chart…</div>}
      {candles && candles.length === 0 && <div className="chart-loading muted">No candle data for this pool.</div>}
      <div ref={box} className="chart-box" hidden={!candles || candles.length === 0} />

      {a && (
        <>
          <p className="muted small legend">
            <span style={{ color: UP }}>━ High</span> <span style={{ color: DOWN }}>━ Low</span>{" "}
            <span style={{ color: ZONE }}>┅ Highest-volume zone</span> <span style={{ color: ZONE }}>▮ Biggest volume candle</span>
          </p>
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
            <Insight
              label={`Volume (${span})`}
              value={usd(a.total)}
              sub={`${a.ups} up candles · ${a.downs} down`}
            />
          </div>
          <RangeBar lo={a.lo.l} hi={a.hi.h} now={a.last} zone={a.zone} />
        </>
      )}
      <p className="muted small">Candle data: GeckoTerminal</p>
    </section>
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
