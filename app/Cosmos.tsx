"use client";

import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fixed starfield behind the whole app: sparse stars that twinkle slowly */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const rand = seeded(11);
    const reduce = reduceMotion();
    let stars: { x: number; y: number; r: number; a: number; p: number; s: number }[] = [];
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const n = Math.round((w * h) / 4800);
      stars = Array.from({ length: n }, () => ({
        x: rand() * w,
        y: rand() * h,
        r: rand() < 0.93 ? 0.45 + rand() * 0.55 : 0.9 + rand() * 0.8,
        a: 0.2 + rand() * 0.6,
        p: rand() * TAU,
        s: 0.3 + rand() * 1.1,
      }));
      draw(performance.now());
    };
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      for (const s of stars) {
        ctx.globalAlpha = s.a * (reduce ? 1 : 0.6 + 0.4 * Math.sin(t * 0.001 * s.s + s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => {
      if (t - last > 50) {
        draw(t); // ~20 fps is plenty for twinkling
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener("resize", resize);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}

type P = { r: number; th: number; size: number; a: number; warm: number };

function makeGalaxy(n: number) {
  const rand = seeded(7);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const r = Math.pow(rand(), 0.55);
    const spread = 0.28 * (1 - r * 0.35);
    pts.push({
      r: r * (0.98 + gauss() * 0.03),
      th: arm * Math.PI + r * 5.4 + gauss() * spread,
      size: 0.35 + rand() * (r < 0.25 ? 1.3 : 0.9),
      a: 0.25 + rand() * 0.65,
      warm: Math.max(0, 1 - r * 1.6),
    });
  }
  for (let i = 0; i < n * 0.25; i++) pts.push({ r: Math.sqrt(rand()), th: rand() * TAU, size: 0.3 + rand() * 0.5, a: 0.08 + rand() * 0.18, warm: 0 });
  return pts;
}

/** Draw one frame of the ORBIT mark: spiral galaxy, Solana-coloured core, orbit ring + satellite */
export function drawMark(ctx: CanvasRenderingContext2D, size: number, t: number, pts: P[], animate = true) {
  const cx = size / 2, cy = size / 2, R = size * 0.36, tilt = 0.62, rot = -0.4;
  ctx.clearRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
  glow.addColorStop(0, "rgba(140,120,255,0.16)");
  glow.addColorStop(0.35, "rgba(20,241,149,0.04)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 1.1, R * 1.1 * tilt, rot, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  const time = animate ? t * 0.00006 : 0;
  const cr = Math.cos(rot), sr = Math.sin(rot), k = size / 500;
  for (const p of pts) {
    const ang = p.th + time / (0.25 + p.r); // inner stars turn faster
    const x0 = Math.cos(ang) * p.r * R, y0 = Math.sin(ang) * p.r * R * tilt;
    const x = cx + x0 * cr - y0 * sr, y = cy + x0 * sr + y0 * cr;
    ctx.fillStyle =
      p.warm > 0
        ? `rgba(${(225 - 40 * p.warm) | 0},${(225 - 30 * p.warm) | 0},255,${p.a})`
        : `rgba(${(205 + p.r * 40) | 0},222,255,${p.a})`;
    const s = p.size * k;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalCompositeOperation = "source-over";

  // Solana core
  const pulse = animate ? 1 + 0.04 * Math.sin(t * 0.0015) : 1;
  const cr0 = R * 0.12;
  const halo = ctx.createRadialGradient(cx, cy, cr0, cx, cy, cr0 * 2.6 * pulse);
  halo.addColorStop(0, "rgba(120,160,255,0.35)");
  halo.addColorStop(1, "rgba(120,160,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, cr0 * 2.6 * pulse, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(cx - cr0, cy + cr0, cx + cr0, cy - cr0);
  g.addColorStop(0, "#9945ff");
  g.addColorStop(1, "#14f195");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, cr0, 0, TAU);
  ctx.fill();
  const sh = ctx.createRadialGradient(cx - cr0 * 0.35, cy - cr0 * 0.35, 0, cx, cy, cr0);
  sh.addColorStop(0, "rgba(255,255,255,0.35)");
  sh.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(cx, cy, cr0, 0, TAU);
  ctx.fill();

  // orbit ring + satellite
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const oa = R * 1.22, ob = R * 1.22 * tilt * 0.82;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(1, size / 500);
  ctx.beginPath();
  ctx.ellipse(0, 0, oa, ob, 0, 0, TAU);
  ctx.stroke();
  const sa = animate ? (t * 0.00025) % TAU : 0.7;
  const sx = Math.cos(sa) * oa, sy = Math.sin(sa) * ob;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 0.03);
  sg.addColorStop(0, "rgba(255,255,255,0.9)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sx, sy, size * 0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(1.5, size * 0.0065), 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Animated ORBIT galaxy logo */
export function Galaxy({ size = 260, stars = 2400, className }: { size?: number; stars?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    const pts = makeGalaxy(stars);
    const reduce = reduceMotion();
    let raf = 0, visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const loop = (t: number) => {
      if (visible) drawMark(ctx, px, t, pts);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) drawMark(ctx, px, 0, pts, false);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size, stars]);
  return <canvas ref={ref} className={className} style={{ width: size, height: size, maxWidth: "100%" }} aria-label="ORBIT" role="img" />;
}

/** Thin line icons (replace emoji) */
export function Icon({ name, size = 20 }: { name: "discover" | "scan" | "wallet" | "demo" | "pro"; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true };
  switch (name) {
    case "discover":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="2.2" />
          <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-25 12 12)" />
        </svg>
      );
    case "scan":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...p}>
          <path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z" />
          <path d="M4 7l11-3v3" />
          <circle cx="16" cy="13" r="1.2" />
        </svg>
      );
    case "demo":
      return (
        <svg {...p}>
          <path d="M3 17l5-6 4 4 8-9" />
          <path d="M15 6h5v5" />
        </svg>
      );
    case "pro":
      return (
        <svg {...p}>
          <path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.3 9.2l6.1-.6z" />
        </svg>
      );
  }
}
