"use client";

import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, LineStyle, type UTCTimestamp } from "lightweight-charts";
import type { Analysis, Candle } from "@/lib/ta";

// "Share read": one branded PNG of the chart + the ORBIT Read, for X / WhatsApp / Telegram.
const W = 1600, H = 900;
const C = { bg: "#000000", ink: "#f2f3f5", ink2: "#a3a7b3", faint: "#5f6370", gold: "#f3d9a4", up: "#6fe3a8", down: "#ff6b78", zone: "#ffb84d" };

function stars(g: CanvasRenderingContext2D) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, rnd() * 1.3 + 0.2, 0, Math.PI * 2);
    g.fill();
  }
}

const tone = (b: string) => (b === "Bullish" ? C.up : b === "Bearish" ? C.down : C.gold);

export async function makeShareImage(opts: { chart: HTMLCanvasElement; overlay?: HTMLCanvasElement | null; ta: Analysis; sym: string; tf: string; fmt: (n: number) => string }) {
  const { chart, overlay, ta, sym, tf, fmt } = opts;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  stars(g);
  const font = (w: number, px: number, fam = "Barlow, system-ui, sans-serif") => `${w} ${px}px ${fam}`;
  const spaced = (text: string, x: number, y: number, track: number) => {
    let cx = x;
    for (const ch of text) {
      g.fillText(ch, cx, y);
      cx += g.measureText(ch).width + track;
    }
  };

  // brand
  g.fillStyle = C.ink;
  g.font = font(300, 30);
  spaced("ORBIT", 70, 82, 12);
  g.fillStyle = C.ink2;
  g.font = font(500, 13);
  spaced("SOLANA COIN INTELLIGENCE", 70, 106, 3.5);
  g.textAlign = "left";
  g.font = font(500, 15);
  const right = `ORBIT READ · ${tf.toUpperCase()} · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}`;
  g.fillStyle = C.ink2;
  spaced(right, W - 70 - g.measureText(right).width - right.length * 3, 92, 3);

  // left column: ticker, bias, meter, levels
  const r = ta.read;
  g.fillStyle = C.ink;
  g.font = font(300, 88);
  g.fillText(`$${sym}`, 70, 250);
  g.fillStyle = tone(r.bias);
  g.font = font(300, 50);
  spaced(r.bias.toUpperCase(), 72, 330, 8);
  // meter
  const mx = 72, my = 360, mw = 420;
  const grad = g.createLinearGradient(mx, 0, mx + mw, 0);
  grad.addColorStop(0, "rgba(255,107,120,0.9)");
  grad.addColorStop(0.5, "rgba(243,217,164,0.6)");
  grad.addColorStop(1, "rgba(111,227,168,0.9)");
  g.fillStyle = grad;
  g.fillRect(mx, my, mw, 6);
  g.fillStyle = "#fff";
  g.fillRect(mx + ((r.score + 100) / 200) * mw - 2, my - 6, 4, 18);
  g.fillStyle = C.faint;
  g.font = font(500, 13);
  g.fillText("BEARISH", mx, my + 32);
  g.fillText("BULLISH", mx + mw - 60, my + 32);
  g.fillStyle = C.ink;
  g.fillText(`${r.score > 0 ? "+" : ""}${r.score}`, mx + mw / 2 - 10, my + 32);

  const rows: [string, number, string][] = [
    ...r.resistance.slice().reverse().map((z, i, a) => [`R${a.length - i}`, z.mid, C.down] as [string, number, string]),
    ["Now", ta.last, C.ink],
    ...r.support.map((z, i) => [`S${i + 1}`, z.mid, C.up] as [string, number, string]),
    ["POC", ta.profile.poc, C.zone],
  ];
  if (r.invalidation != null) rows.push(["Invalid", r.invalidation, C.gold]);
  let y = 440;
  for (const [k, p, col] of rows.slice(0, 7)) {
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.beginPath();
    g.moveTo(70, y - 26);
    g.lineTo(500, y - 26);
    g.stroke();
    g.font = font(500, 19, "'JetBrains Mono', ui-monospace, monospace");
    g.fillStyle = col;
    g.fillText(k.toUpperCase(), 70, y);
    g.fillStyle = C.ink;
    g.fillText(`$${fmt(p)}`, 180, y);
    if (k !== "Now") {
      g.fillStyle = C.faint;
      const d = (p / ta.last - 1) * 100;
      const t = `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
      g.fillText(t, 500 - g.measureText(t).width, y);
    }
    y += 44;
  }

  // chart (+ overlay) on the right
  const cx = 580, cy = 150, cw = W - cx - 70;
  const ch = Math.min(560, (chart.height / chart.width) * cw);
  g.save();
  g.beginPath();
  g.roundRect(cx, cy, cw, ch, 16);
  g.clip();
  g.fillStyle = "#05060a";
  g.fillRect(cx, cy, cw, ch);
  g.drawImage(chart, cx, cy, cw, ch);
  // the overlay spans the chart's full width and only its main pane: keep its own aspect ratio
  if (overlay && overlay.width) g.drawImage(overlay, cx, cy, cw, (overlay.height / overlay.width) * cw);
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.beginPath();
  g.roundRect(cx, cy, cw, ch, 16);
  g.stroke();

  // what to watch
  let wy = cy + ch + 50;
  g.fillStyle = C.gold;
  g.font = font(500, 14);
  spaced("WHAT TO WATCH", cx, wy, 4);
  g.font = font(500, 20);
  g.fillStyle = C.ink2;
  for (const w of r.plan.slice(0, 3)) {
    wy += 34;
    g.fillText(`— ${w}`, cx, wy, cw);
  }

  // footer
  g.fillStyle = C.ink;
  g.font = font(500, 24, "'JetBrains Mono', ui-monospace, monospace");
  g.fillText("orbitonsol.com", 70, H - 42);
  g.fillStyle = C.gold;
  g.font = font(500, 14);
  spaced("PRO FREE FOR 7 DAYS", 300, H - 46, 4);
  g.fillStyle = C.faint;
  g.font = font(500, 12);
  const disc = "AUTOMATIC ANALYSIS · NOT FINANCIAL ADVICE";
  spaced(disc, W - 70 - g.measureText(disc).width - disc.length * 2.5, H - 46, 2.5);

  return new Promise<Blob>((res) => cv.toBlob((b) => res(b!), "image/png"));
}

/** Native share sheet on phones (X, WhatsApp, Telegram…), download elsewhere */
export async function shareImage(blob: Blob, name: string, text: string) {
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}

/** Draw a clean, wide copy of the chart off-screen (candles, EMAs, structure, levels) and return it as a canvas */
export async function renderShareChart(cs: Candle[], ta: Analysis, hi: number, lo: number) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-5000px;top:0;width:1100px;height:560px;";
  document.body.appendChild(host);
  const fmt = (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(4));
  const chart = createChart(host, {
    width: 1100,
    height: 560,
    layout: { background: { type: ColorType.Solid, color: "#05060a" }, textColor: "#8a90a6", fontSize: 13, attributionLogo: false },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
    rightPriceScale: { borderColor: "#1f2333" },
    timeScale: { borderColor: "#1f2333", timeVisible: true, secondsVisible: false, rightOffset: 4 },
    localization: { priceFormatter: fmt },
  });
  const price = chart.addSeries(CandlestickSeries, { upColor: "#3ee6a0", downColor: "#ff4d5e", borderVisible: false, wickUpColor: "#3ee6a0", wickDownColor: "#ff4d5e", priceFormat: { type: "custom", formatter: fmt, minMove: 1e-12 } });
  price.setData(cs.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
  price.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
  const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  vol.setData(cs.map((c) => ({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? "rgba(62,230,160,0.3)" : "rgba(255,77,94,0.3)" })));
  for (const [data, color, w] of [[ta.ema20, "#5ad1ff", 1], [ta.ema50, "#3f6fd8", 2]] as [number[], string, number][]) {
    const l = chart.addSeries(LineSeries, { color, lineWidth: w as 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    l.setData(cs.map((c, i) => ({ time: c.t as UTCTimestamp, value: data[i] })));
  }
  const line = (p: number, color: string, title: string, style = LineStyle.Dashed) => price.createPriceLine({ price: p, color, lineStyle: style, lineWidth: 1, axisLabelVisible: true, title });
  line(hi, "#3ee6a0", "High");
  line(lo, "#ff4d5e", "Low");
  line(ta.profile.poc, "#ffb84d", "POC", LineStyle.Solid);
  ta.read.resistance.forEach((z, i) => line(z.mid, "rgba(255,107,120,0.9)", `R${i + 1}`, LineStyle.Dotted));
  ta.read.support.forEach((z, i) => line(z.mid, "rgba(111,227,168,0.9)", `S${i + 1}`, LineStyle.Dotted));
  createSeriesMarkers(
    price,
    ta.swings
      .filter((s) => s.label !== "H" && s.label !== "L")
      .slice(-12)
      .map((s) => ({ time: s.t as UTCTimestamp, position: s.kind === "high" ? ("aboveBar" as const) : ("belowBar" as const), color: s.label === "HH" || s.label === "HL" ? "#3ee6a0" : "#ff4d5e", shape: "circle" as const, size: 0.4, text: s.label })),
  );
  chart.timeScale().fitContent();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
  const shot = chart.takeScreenshot();
  chart.remove();
  host.remove();
  return shot;
}
