import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";
import { DEFAULT_PREFS, getCommunity, subId, tgName, tgReady, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };

/** Ultra: Telegram link status, a one-time connect link, and the Ultra group link once connected */
export async function GET(req: Request) {
  const key = keyFrom(req);
  if (key?.tier !== "ultra") return NextResponse.json({ error: "Ultra only" }, { status: 402 });
  if (!tgReady() || !kvConfigured()) return NextResponse.json({ ready: false }, { headers: nocache });
  const id = subId(req.headers.get("x-orbit-key")!);
  await kvPipeline([["SET", `tgkey:${id}`, req.headers.get("x-orbit-key")!.trim(), "PX", Math.max(60_000, key.exp - Date.now())]]);
  const raw = await kvGet(`tgsub:${id}`);
  const sub = raw ? (JSON.parse(raw) as TgSub) : null;
  const code = randomBytes(9).toString("base64url");
  await kvPipeline([["SET", `tglink:${code}`, JSON.stringify({ id, exp: key.exp, owner: key.id === "owner" }), "EX", 1800]]);
  const c = await getCommunity();
  return NextResponse.json(
    {
      ready: true,
      connected: !!sub?.chat,
      link: `https://t.me/${tgName()}?start=${code}`,
      prefs: { ...DEFAULT_PREFS, ...(sub?.prefs ?? {}) },
      ultraGroup: sub?.chat ? c.ultra?.link ?? null : null,
      channel: c.public?.link ?? null,
    },
    { headers: nocache },
  );
}

/** Ultra: copy this browser's alerts, followed wallets, watchlist and alert settings to the server */
export async function POST(req: Request) {
  const key = keyFrom(req);
  if (key?.tier !== "ultra") return NextResponse.json({ error: "Ultra only" }, { status: 402 });
  if (!kvConfigured()) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const id = subId(req.headers.get("x-orbit-key")!);
  await kvPipeline([["SET", `tgkey:${id}`, req.headers.get("x-orbit-key")!.trim(), "PX", Math.max(60_000, key.exp - Date.now())]]);
  const raw = await kvGet(`tgsub:${id}`);
  if (!raw) return NextResponse.json({ connected: false }, { headers: nocache });
  const sub = JSON.parse(raw) as TgSub;
  let b: { alerts?: TgSub["alerts"]; wallets?: { address: string; label: string }[]; coins?: { ca: string; symbol: string }[]; prefs?: Partial<TgSub["prefs"]> };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  sub.exp = key.exp;
  if (b.alerts)
    sub.alerts = b.alerts
      .filter((a) => isValidMint(a.ca) && a.price > 0 && (a.dir === "above" || a.dir === "below"))
      .slice(0, 50)
      .map((a) => ({ id: String(a.id).slice(0, 16), ca: a.ca, symbol: String(a.symbol).slice(0, 16), price: Number(a.price), dir: a.dir, label: a.label ? String(a.label).slice(0, 12) : undefined }));
  if (b.wallets) {
    const seen = new Map(sub.wallets.map((w) => [w.address, w.seen]));
    sub.wallets = b.wallets
      .filter((w) => isValidMint(w.address))
      .slice(0, 15)
      .map((w) => ({ address: w.address, label: String(w.label).slice(0, 24), seen: seen.get(w.address) ?? [] }));
  }
  if (b.coins) sub.coins = b.coins.filter((c) => isValidMint(c.ca)).slice(0, 25).map((c) => ({ ca: c.ca, symbol: String(c.symbol).slice(0, 16) }));
  if (b.prefs) {
    const p = { ...DEFAULT_PREFS, ...(sub.prefs ?? {}), ...b.prefs };
    sub.prefs = { whales: !!p.whales, buying: !!p.buying, wallets: !!p.wallets, picks: !!p.picks, minWhale: [1000, 2000, 5000, 10000, 25000].includes(Number(p.minWhale)) ? Number(p.minWhale) : 2000 };
  }
  await kvPipeline([
    ["SET", `tgsub:${id}`, JSON.stringify(sub)],
    ["SADD", "tgsubs", id],
  ]);
  return NextResponse.json({ connected: true, alerts: sub.alerts.length, wallets: sub.wallets.length, coins: sub.coins?.length ?? 0 }, { headers: nocache });
}
