import { kvConfigured, kvPipeline } from "./kv";

// Sign-ups & payments log for the owner's admin page (newest first, last 5000 kept)
export type OrbitEvent =
  | { type: "trial"; at: number; wallet: string; country: string }
  | { type: "payment"; at: number; plan: string; tier: "pro" | "ultra"; usd: number; days: number; payer: string; tx: string; country: string };

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
