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
      { text: "All ORBIT picks + near-volume-zone list" },
      { text: "Pro chart: HH/HL/LH/LL, BOS & CHoCH, S/R zones, volume profile, fib, full screen" },
      { text: "ORBIT Read: bias, key levels & what to watch" },
      { text: "ORBIT Report: 0–100 safety score, dev & insider wallets" },
      { text: "Wallet trace: buys, sells, PnL, win rate" },
      { text: "Demo trading with 10 fake SOL" },
      { text: "5 price alerts" },
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
      { text: "Multi-timeframe Read: 5m · 1h · 4h · 1D on one screen" },
      { text: "Unlimited price alerts" },
      { text: "Smart-money watchlist: alerts when wallets you follow buy or sell", soon: true },
      { text: "Alerts even when the app is closed (push / Telegram)", soon: true },
      { text: "Buy & sell from your own wallet (Jupiter)", soon: true },
      { text: "Private Ultra group + priority support" },
    ],
  },
];

export const planOf = (t: Tier) => PLANS.find((p) => p.id === t)!;
export const priceLabel = (t: Tier, b: Billing = "month") => `$${planOf(t).price[b]} / ${b}`;
