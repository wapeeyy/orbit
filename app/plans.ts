// ORBIT plans — shared by the Subscribe page and Pro/Ultra locks. Keep prices in sync with lib/pay.ts.
export type Tier = "free" | "pro" | "ultra";
export type Billing = "month" | "year";

export const PLANS: {
  id: Tier;
  name: string;
  tagline: string;
  price: { month: number; year: number };
  features: { text: string; soon?: boolean }[];
}[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Find coins and check the basics",
    price: { month: 0, year: 0 },
    features: [
      { text: "All pairs: trending, new, top volume, filters" },
      { text: "Top 3 ORBIT picks" },
      { text: "Scan any CA: price, liquidity, top 20 holders, top-10 warning" },
      { text: "Narrative, socials & the owner's latest posts" },
      { text: "Chart with High/Low, EMA, VWAP & RSI" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Read the chart and avoid the rugs",
    price: { month: 23, year: 230 },
    features: [
      { text: "Everything in Free" },
      { text: "All ORBIT picks, Fresh pairs (5–60 min) with risk score, watchlist" },
      { text: "Pro chart: HH/HL/LH/LL, BOS & CHoCH, S/R zones, volume profile, fib, full screen" },
      { text: "ORBIT Read: bias, key levels & what to watch — share it as an image" },
      { text: "Rug & honeypot check: can you sell, round-trip tax, LP lock, red flags" },
      { text: "Dev wallet tracker: dev buys & sells marked on the chart" },
      { text: "ORBIT Report: 0–100 safety score, dev & insider wallets" },
      { text: "Wallet trace, demo trading with 10 fake SOL, 5 price alerts" },
    ],
  },
  {
    id: "ultra",
    name: "Ultra",
    tagline: "See what the whales do — first",
    price: { month: 59, year: 590 },
    features: [
      { text: "Everything in Pro" },
      { text: "Whale trades on the chart + whale list (tap to trace)" },
      { text: "Multi-timeframe Read (5m · 1h · 4h · 1D) + the Read's track record on each coin" },
      { text: "Holder flow (1h / 24h) and launch bundle detection" },
      { text: "Smart-money watchlist: alerts when wallets you follow buy or sell" },
      { text: "Telegram alerts, even when the app is closed · unlimited price alerts" },
      { text: "Buy & sell from your own wallet (Jupiter)" },
      { text: "Private Ultra group + priority support" },
    ],
  },
];

export const planOf = (t: Tier) => PLANS.find((p) => p.id === t)!;
export const priceLabel = (t: Tier, b: Billing = "month") => `$${planOf(t).price[b]} / ${b}`;
