import { NextResponse } from "next/server";
import { kvConfigured, kvGet, kvPipeline, setOnce } from "@/lib/kv";
import { bigTrades, buyingSurge, dexInfo, poolActivity, trending, walletRush } from "@/lib/marketwatch";
import { solUsd } from "@/lib/pay";
import { analyse } from "@/lib/ta";
import { fetchCandles } from "@/lib/analysis";
import { DEFAULT_PREFS, SITE, esc, getCommunity, px, tgCall, tgReady, tgSend, usd, type TgSub } from "@/lib/telegram";
import { fetchSwaps, toSwap } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN = 60_000;
const once = (key: string, ttlSec: number) => setOnce(key, "1", ttlSec).catch(() => false);
const open = (ca: string) => ({ text: "Open in ORBIT", url: `${SITE}/?ca=${ca}&src=tg` });

/**
 * Runs about every minute (GitHub Actions loop). Public but safe: a lock makes extra calls no-ops
 * and it only reads public market data. Delivers:
 *  - personal Ultra alerts: price levels, followed wallets, whale trades / community buying / wallet rush on watched coins
 *  - ORBIT Ultra group feed: the same signals on trending coins
 *  - the daily ORBIT reads post in the public channel
 *  - removes expired Ultra members from the group
 */
export async function GET() {
  if (!kvConfigured() || !tgReady()) return NextResponse.json({ skipped: "not configured" });
  const [lock, n] = (await kvPipeline([["SET", "cronlock", String(Date.now()), "NX", "EX", 45], ["INCR", "cron:n"]])) as [string | null, number];
  if (lock !== "OK") return NextResponse.json({ skipped: "locked" });
  const log: string[] = [];
  const community = await getCommunity();

  // ---- load subscribers ----
  const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
  const subs: { id: string; s: TgSub }[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`tgsub:${id}`);
    if (!raw) continue;
    const s = JSON.parse(raw) as TgSub;
    if (!s.chat) continue;
    if (s.exp < Date.now()) {
      await tgSend(s.chat, "Your ORBIT Ultra has ended, so alerts are paused and you have left the ORBIT Ultra group. Renew at orbitonsol.com to turn everything back on.", { text: "Renew Ultra", url: `${SITE}/?tab=sub&src=tg` });
      if (community.ultra) {
        await tgCall("banChatMember", { chat_id: community.ultra.id, user_id: s.chat, until_date: Math.floor(Date.now() / 1000) + 60 });
        await tgCall("unbanChatMember", { chat_id: community.ultra.id, user_id: s.chat, only_if_banned: true });
      }
      await kvPipeline([["DEL", `tgsub:${id}`], ["SREM", "tgsubs", id]]);
      continue;
    }
    s.prefs = { ...DEFAULT_PREFS, ...(s.prefs ?? {}) };
    subs.push({ id, s });
  }
  let sent = 0;

  // ---- prices + main pool for every coin anyone cares about ----
  const coinSet = new Set<string>([...subs.flatMap((x) => x.s.alerts.map((a) => a.ca)), ...subs.flatMap((x) => (x.s.coins ?? []).map((c) => c.ca))]);
  const info = await dexInfo([...coinSet].slice(0, 90));

  // 1. price alerts
  for (const x of subs) {
    const keep: TgSub["alerts"] = [];
    for (const a of x.s.alerts) {
      const now = info.get(a.ca)?.price;
      if (now == null || !(a.dir === "above" ? now >= a.price : now <= a.price)) {
        keep.push(a);
        continue;
      }
      if (await tgSend(x.s.chat, `<b>$${esc(a.symbol)} ${a.dir === "above" ? "broke above" : "dropped below"} $${px(a.price)}</b>${a.label ? ` (${esc(a.label)})` : ""}\nNow $${px(now)}\n<code>${a.ca}</code>`, open(a.ca))) sent++;
    }
    x.s.alerts = keep;
  }

  // 2. watched coins: community buying / wallet rush / whale trades
  const watchers = new Map<string, { x: (typeof subs)[number]; symbol: string }[]>();
  for (const x of subs) for (const c of x.s.coins ?? []) watchers.set(c.ca, [...(watchers.get(c.ca) ?? []), { x, symbol: c.symbol }]);
  const watched = [...watchers.keys()].filter((ca) => info.get(ca)?.pool).slice(0, 30);
  try {
    // buying waves from DexScreener every run; unique-buyer counts (GeckoTerminal) every 2nd run
    const act = n % 2 === 0 ? await poolActivity(watched.map((ca) => info.get(ca)!.pool)) : new Map();
    for (const ca of watched) {
      const d = info.get(ca)!;
      const a = act.get(d.pool);
      const sym = esc(d.symbol);
      const surge = buyingSurge(d);
      if (surge && (await once(`cool:coin:${ca}:buying`, 30 * 60)))
        for (const w of watchers.get(ca)!) if (w.x.s.prefs!.buying) {
          await tgSend(w.x.s.chat, `<b>Community buying $${sym}</b>\n${surge.buys} buys vs ${surge.sells} sells in 5 min (${surge.ratio.toFixed(1)}x the hour's pace)\nVolume ${usd(surge.vol)} · price ${surge.ch >= 0 ? "+" : ""}${surge.ch.toFixed(1)}%\n<code>${ca}</code>`, open(ca));
          sent++;
        }
      const rush = a ? walletRush(a) : null;
      if (rush && (await once(`cool:coin:${ca}:wallets`, 30 * 60)))
        for (const w of watchers.get(ca)!) if (w.x.s.prefs!.wallets) {
          await tgSend(w.x.s.chat, `<b>Wallets rushing into $${sym}</b>\n${rush.buyers} different wallets bought in 5 min (normal pace ${rush.pace.toFixed(1)})\nPrice ${rush.ch >= 0 ? "+" : ""}${rush.ch.toFixed(1)}%\n<code>${ca}</code>`, open(ca));
          sent++;
        }
    }
  } catch (e) {
    log.push(`activity: ${(e as Error).message}`);
  }
  // whales: a few coins per run, in rotation
  const whaleCoins = watched.filter((ca) => watchers.get(ca)!.some((w) => w.x.s.prefs!.whales));
  for (let i = 0; i < Math.min(4, whaleCoins.length); i++) {
    const ca = whaleCoins[(n * 4 + i) % whaleCoins.length];
    const min = Math.min(...watchers.get(ca)!.map((w) => w.x.s.prefs!.minWhale));
    try {
      const last = Number((await kvGet(`wlast:${ca}`)) ?? 0);
      const trades = await bigTrades(info.get(ca)!.pool, ca, min);
      const newest = trades.length ? trades[trades.length - 1].t : 0;
      if (newest) await kvPipeline([["SET", `wlast:${ca}`, String(Math.max(newest, last)), "EX", 7 * 86400]]);
      if (!last) continue; // first look: only remember where we are
      for (const t of trades.filter((t) => t.t > last).slice(-4))
        for (const w of watchers.get(ca)!) if (w.x.s.prefs!.whales && t.usd >= w.x.s.prefs!.minWhale) {
          await tgSend(w.x.s.chat, `<b>Whale ${t.kind === "buy" ? "bought" : "sold"} $${esc(info.get(ca)!.symbol)}</b> ${usd(t.usd)}\nWallet <code>${t.wallet}</code>\n<code>${ca}</code>`, open(ca));
          sent++;
        }
    } catch (e) {
      log.push(`whales ${ca.slice(0, 4)}: ${(e as Error).message}`);
    }
  }

  // 3. followed wallets: every 3rd run, capped
  if (n % 3 === 0) {
    const sol = await solUsd().catch(() => 0);
    let budget = 20;
    for (const x of subs)
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
            await tgSend(x.s.chat, `<b>${esc(w.label)} ${s.side === "BUY" ? "bought" : "sold"}</b> ${usd(s.sol * sol)}\nToken <code>${s.mint}</code>`, open(s.mint));
            sent++;
          }
        } catch {}
      }
  }
  for (const x of subs) await kvPipeline([["SET", `tgsub:${x.id}`, JSON.stringify(x.s)]]);

  // 4. ORBIT Ultra group: live signals on trending coins
  let posts = 0;
  if (community.ultra) {
    try {
      // trending list cached for 5 minutes; activity for it every 2nd run
      const cached = await kvGet("tg:trending");
      const top: Awaited<ReturnType<typeof trending>> = cached ? JSON.parse(cached) : await trending(10);
      if (!cached) await kvPipeline([["SET", "tg:trending", JSON.stringify(top), "EX", 300]]);
      const tinfo = await dexInfo(top.map((t) => t.ca));
      const act = n % 2 === 1 ? await poolActivity(top.map((t) => t.pool)) : new Map();
      for (const t of top) {
        if (posts >= 4) break;
        const a = act.get(t.pool);
        const d = tinfo.get(t.ca);
        const surge = d ? buyingSurge(d) : null;
        if (surge && (await once(`cool:grp:${t.ca}:buying`, 45 * 60))) {
          await tgSend(community.ultra.id, `<b>Community buying $${esc(t.symbol)}</b> (trending)\n${surge.buys} buys vs ${surge.sells} sells in 5 min · ${surge.ratio.toFixed(1)}x normal\nVolume ${usd(surge.vol)} · price ${surge.ch >= 0 ? "+" : ""}${surge.ch.toFixed(1)}%\n<code>${t.ca}</code>`, open(t.ca));
          posts++;
        }
        const rush = a ? walletRush(a) : null;
        if (rush && (await once(`cool:grp:${t.ca}:wallets`, 45 * 60))) {
          await tgSend(community.ultra.id, `<b>Wallets rushing into $${esc(t.symbol)}</b>\n${rush.buyers} wallets bought in 5 min (normal ${rush.pace.toFixed(1)})\n<code>${t.ca}</code>`, open(t.ca));
          posts++;
        }
      }
      for (let i = 0; i < 2 && top.length; i++) {
        const t = top[(n * 2 + i) % top.length];
        const last = Number((await kvGet(`gwlast:${t.pool}`)) ?? 0);
        const trades = await bigTrades(t.pool, t.ca, 5000);
        const newest = trades.length ? trades[trades.length - 1].t : 0;
        if (newest) await kvPipeline([["SET", `gwlast:${t.pool}`, String(Math.max(newest, last)), "EX", 7 * 86400]]);
        if (!last) continue;
        for (const w of trades.filter((x) => x.t > last).slice(-2)) {
          if (posts >= 6) break;
          await tgSend(community.ultra.id, `<b>Whale ${w.kind === "buy" ? "bought" : "sold"} $${esc(t.symbol)}</b> ${usd(w.usd)}\nWallet <code>${w.wallet}</code>\n<code>${t.ca}</code>`, open(t.ca));
          posts++;
        }
      }
    } catch (e) {
      log.push(`group: ${(e as Error).message}`);
    }
  }

  // 5. public channel: daily ORBIT reads at 13:00 UTC (9 pm Malaysia)
  const now = new Date();
  if (community.public && now.getUTCHours() === 13 && (await once(`daily:${now.toISOString().slice(0, 10)}`, 26 * 3600))) {
    try {
      const top = await trending(5);
      const lines: string[] = [];
      for (const t of top) {
        try {
          const cs = await fetchCandles(t.pool, t.ca, "hour", 1, 168);
          const r = cs.length > 30 ? analyse(cs).read : null;
          lines.push(`<b>$${esc(t.symbol)}</b>  ${r ? `${r.bias} ${r.score > 0 ? "+" : ""}${r.score}` : "too new to read"}${r?.support[0] ? ` · S1 $${px(r.support[0].mid)}` : ""}${r?.resistance[0] ? ` · R1 $${px(r.resistance[0].mid)}` : ""}`);
        } catch {
          lines.push(`<b>$${esc(t.symbol)}</b>`);
        }
      }
      await tgSend(community.public.id, `<b>Daily ORBIT reads</b> · Solana trending, 1h\n\n${lines.join("\n")}\n\nFull chart, levels and rug check on ORBIT. Pro is free for 7 days.\n<i>Automatic analysis, not financial advice.</i>`, { text: "Open ORBIT", url: `${SITE}/?src=tg-daily` });
      posts++;
    } catch (e) {
      log.push(`daily: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ run: n, subs: subs.length, sent, posts, log });
}
