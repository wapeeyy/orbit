import { NextResponse } from "next/server";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";
import { solUsd } from "@/lib/pay";
import { tgReady, tgSend, type TgSub } from "@/lib/telegram";
import { fetchSwaps, toSwap } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fmt = (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(4));
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/**
 * Runs every ~5 min (GitHub Actions): delivers Ultra Telegram alerts.
 * Public but safe: a lock makes extra calls no-ops, and it only reads public chain/price data.
 */
export async function GET() {
  if (!kvConfigured() || !tgReady()) return NextResponse.json({ skipped: "not configured" });
  const [lock] = (await kvPipeline([["SET", "cronlock", String(Date.now()), "NX", "EX", 200]])) as [string | null];
  if (lock !== "OK") return NextResponse.json({ skipped: "locked" });

  const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
  const subs: { id: string; s: TgSub }[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`tgsub:${id}`);
    if (!raw) continue;
    const s = JSON.parse(raw) as TgSub;
    if (!s.chat) continue;
    if (s.exp < Date.now()) {
      await tgSend(s.chat, "Your ORBIT Ultra has ended, so Telegram alerts are paused. Renew at orbitonsol.com to turn them back on.");
      await kvPipeline([["DEL", `tgsub:${id}`], ["SREM", "tgsubs", id]]);
      continue;
    }
    subs.push({ id, s });
  }

  // 1. price alerts — one DexScreener call per 30 coins
  const mints = [...new Set(subs.flatMap((x) => x.s.alerts.map((a) => a.ca)))];
  const price = new Map<string, number>();
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`, { cache: "no-store" });
      const best = new Map<string, number>();
      for (const p of (await r.json()) as { baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[]) {
        const liq = p.liquidity?.usd ?? 0;
        if (p.priceUsd && liq >= (best.get(p.baseToken.address) ?? -1)) {
          best.set(p.baseToken.address, liq);
          price.set(p.baseToken.address, Number(p.priceUsd));
        }
      }
    } catch {}
  }
  let sent = 0;
  for (const x of subs) {
    const keep: TgSub["alerts"] = [];
    for (const a of x.s.alerts) {
      const now = price.get(a.ca);
      const hit = now != null && (a.dir === "above" ? now >= a.price : now <= a.price);
      if (!hit) {
        keep.push(a);
        continue;
      }
      await tgSend(x.s.chat, `<b>$${a.symbol} ${a.dir === "above" ? "broke above" : "dropped below"} $${fmt(a.price)}</b>${a.label ? ` (${a.label})` : ""}\nNow $${fmt(now!)}\nhttps://www.orbitonsol.com`);
      sent++;
    }
    x.s.alerts = keep;
  }

  // 2. smart-money wallets — latest page of swaps each (capped per run)
  const sol = await solUsd().catch(() => 0);
  let budget = 40;
  for (const x of subs) {
    for (const w of x.s.wallets) {
      if (budget-- <= 0) break;
      try {
        const { txs } = await fetchSwaps(w.address, 1);
        const swaps = txs.map((t) => toSwap(t, w.address, sol)).filter((s): s is NonNullable<typeof s> => !!s);
        const first = w.seen.length === 0;
        const fresh = swaps.filter((s) => !w.seen.includes(s.signature) && Date.now() - s.ts < 2 * 3_600_000);
        w.seen = [...swaps.map((s) => s.signature), ...w.seen].slice(0, 60);
        if (first) continue;
        for (const s of fresh.slice(0, 5)) {
          await tgSend(x.s.chat, `<b>${w.label} ${s.side === "BUY" ? "bought" : "sold"}</b> ${usd(s.sol * sol)}\nToken: <code>${s.mint}</code>\nhttps://www.orbitonsol.com`);
          sent++;
        }
      } catch {}
    }
  }

  for (const x of subs) await kvPipeline([["SET", `tgsub:${x.id}`, JSON.stringify(x.s)]]);
  return NextResponse.json({ subs: subs.length, sent });
}
