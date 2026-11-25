import { kvConfigured, kvPipeline } from "./kv";

// Sign-ups & payments log for the owner's admin page (newest first, last 5000 kept)
export type OrbitEvent =
  | { type: "trial"; at: number; wallet: string; country: string }
  | { type: "payment"; at: number; plan: string; tier: "pro" | "ultra"; usd: number; days: number; payer: string; tx: string; country: string }
  | { type: "gift"; at: number; label: string; tier: "pro" | "ultra"; days: number };

export const countryOf = (req: Request) => req.headers.get("x-vercel-ip-country") ?? "??";

export async function logEvent(e: OrbitEvent) {
  if (!kvConfigured()) return;
  try {
    await kvPipeline([
      ["LPUSH", "events", JSON.stringify(e)],
      ["LTRIM", "events", 0, 4999],
      ["INCR", `count:${e.type}`],
      ...(e.type === "payment" ? [["INCRBYFLOAT", "revenue:usd", e.usd.toFixed(2)]] : []),
    ]);
  } catch {
    // logging must never break a sign-up or a payment
  }
}

export async function readEvents(n = 1000) {
  const [list, trials, payments, revenue] = (await kvPipeline([
    ["LRANGE", "events", 0, n - 1],
    ["GET", "count:trial"],
    ["GET", "count:payment"],
    ["GET", "revenue:usd"],
  ])) as [string[] | null, string | null, string | null, string | null];
  return {
    events: (list ?? []).map((s) => JSON.parse(s) as OrbitEvent),
    totals: { trials: Number(trials ?? 0), payments: Number(payments ?? 0), revenue: Number(revenue ?? 0) },
  };
}

const hashToObj = (h: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (Array.isArray(h)) for (let i = 0; i < h.length; i += 2) out[String(h[i])] = Number(h[i + 1]);
  else if (h && typeof h === "object") for (const [k, v] of Object.entries(h)) out[k] = Number(v);
  return out;
};

/** Visitors per day for the last `days` days (from /api/hit) */
export async function readTraffic(days = 30) {
  const list = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const cmds: (string | number)[][] = [];
  for (const d of list) cmds.push(["PFCOUNT", `uv:${d}`], ["GET", `pv:${d}`], ["HGETALL", `cc:${d}`], ["HGETALL", `src:${d}`]);
  cmds.push(["PFCOUNT", ...list.slice(0, 7).map((d) => `uv:${d}`)], ["PFCOUNT", ...list.map((d) => `uv:${d}`)]);
  const r = await kvPipeline(cmds);
  const perDay = list.map((day, i) => ({
    day,
    visitors: Number(r[i * 4] ?? 0),
    views: Number(r[i * 4 + 1] ?? 0),
    countries: hashToObj(r[i * 4 + 2]),
    sources: hashToObj(r[i * 4 + 3]),
  }));
  return { perDay, unique7: Number(r[days * 4] ?? 0), unique30: Number(r[days * 4 + 1] ?? 0) };
}
