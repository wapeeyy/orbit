import { NextResponse } from "next/server";
import { isValidMint } from "@/lib/holders";

export const dynamic = "force-dynamic";

// tf -> [timeframe GeckoTerminal, aggregate, bilangan candle]
const TF: Record<string, [string, number, number]> = {
  "5m": ["minute", 5, 288], // 24 jam
  "15m": ["minute", 15, 192], // 2 hari
  "1h": ["hour", 1, 168], // 7 hari
  "4h": ["hour", 4, 180], // 30 hari
  "1d": ["day", 1, 365], // 1 tahun
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const pool = q.get("pool") ?? "";
  const token = q.get("token") ?? "";
  const tf = TF[q.get("tf") ?? "15m"] ? (q.get("tf") ?? "15m") : "15m";
  if (!isValidMint(pool) || !isValidMint(token)) {
    return NextResponse.json({ error: "Invalid pool/token address" }, { status: 400 });
  }
  const [frame, agg, limit] = TF[tf];
  const url =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${frame}` +
    `?aggregate=${agg}&limit=${limit}&currency=usd&token=${token}`;

  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    const msg = res.status === 429 ? "Too many chart requests — try again shortly" : `GeckoTerminal ${res.status}`;
    return NextResponse.json({ error: msg }, { status: res.status === 404 ? 404 : 502 });
  }
  const json = await res.json();
  const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
  const candles = list
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);

  return NextResponse.json(
    { tf, candles },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
