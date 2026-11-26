import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";
import { subId, tgName, tgReady, type TgSub } from "@/lib/telegram";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };

/** Ultra: Telegram link status + a one-time link to connect (t.me/<bot>?start=<code>) */
export async function GET(req: Request) {
  const key = keyFrom(req);
  if (key?.tier !== "ultra") return NextResponse.json({ error: "Ultra only" }, { status: 402 });
  if (!tgReady() || !kvConfigured()) return NextResponse.json({ ready: false }, { headers: nocache });
  const id = subId(req.headers.get("x-orbit-key")!);
  const sub = await kvGet(`tgsub:${id}`);
  const code = randomBytes(9).toString("base64url");
  await kvPipeline([["SET", `tglink:${code}`, JSON.stringify({ id, exp: key.exp }), "EX", 1800]]);
  return NextResponse.json({ ready: true, connected: !!sub && !!(JSON.parse(sub) as TgSub).chat, link: `https://t.me/${tgName()}?start=${code}` }, { headers: nocache });
}

/** Ultra: copy this browser's price alerts and followed wallets to the server so Telegram can deliver them */
export async function POST(req: Request) {
  const key = keyFrom(req);
  if (key?.tier !== "ultra") return NextResponse.json({ error: "Ultra only" }, { status: 402 });
  if (!kvConfigured()) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const id = subId(req.headers.get("x-orbit-key")!);
  const raw = await kvGet(`tgsub:${id}`);
  if (!raw) return NextResponse.json({ connected: false }, { headers: nocache });
  const sub = JSON.parse(raw) as TgSub;
  let b: { alerts?: TgSub["alerts"]; wallets?: { address: string; label: string }[] };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  sub.exp = key.exp;
  sub.alerts = (b.alerts ?? [])
    .filter((a) => isValidMint(a.ca) && a.price > 0 && (a.dir === "above" || a.dir === "below"))
    .slice(0, 50)
    .map((a) => ({ id: String(a.id).slice(0, 16), ca: a.ca, symbol: String(a.symbol).slice(0, 16), price: Number(a.price), dir: a.dir, label: a.label ? String(a.label).slice(0, 12) : undefined }));
  const seen = new Map(sub.wallets.map((w) => [w.address, w.seen]));
  sub.wallets = (b.wallets ?? [])
    .filter((w) => isValidMint(w.address))
    .slice(0, 15)
    .map((w) => ({ address: w.address, label: String(w.label).slice(0, 24), seen: seen.get(w.address) ?? [] }));
  await kvPipeline([
    ["SET", `tgsub:${id}`, JSON.stringify(sub)],
    ["SADD", "tgsubs", id],
  ]);
  return NextResponse.json({ connected: true, alerts: sub.alerts.length, wallets: sub.wallets.length }, { headers: nocache });
}
