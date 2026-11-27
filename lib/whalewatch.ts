import { kvConfigured, kvGet, kvPipeline, setOnce } from "./kv";
import { allPairs, bigTrades, type PairRow } from "./marketwatch";
import { DEFAULT_PREFS, SITE, esc, tgReady, tgSendCoin, type TgSub } from "./telegram";
import { cachedVerify, verifyPending, type Verify } from "./verify";

// Whales on all ORBIT pairs, as fast as the free data allows.
// Every ~10 s: DexScreener 24h volume of the top 40 coins (2 calls). DexScreener refreshes about every 30 s,
// so a jump in a coin's volume as big as a whale trade shows up within ~30 s; only then the coin's trades are
// read (GeckoTerminal) to find the whale, its side and wallet, and the alert goes out with the CA after it.

type Sub = { id: string; s: TgSub };
const usd = (n: number) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : Math.round(n).toLocaleString("en-US"));
const open = (ca: string) => ({ text: "Open in ORBIT", url: `${SITE}/?ca=${ca}&src=tg`, app: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ultra subscribers with "Whales on all ORBIT pairs" on */
export async function allWhaleSubs(): Promise<Sub[]> {
  if (!kvConfigured()) return [];
  const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
  const out: Sub[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`tgsub:${id}`);
    if (!raw) continue;
    const s = JSON.parse(raw) as TgSub;
    s.prefs = { ...DEFAULT_PREFS, ...(s.prefs ?? {}) };
    if (s.chat && s.exp > Date.now() && s.prefs.allWhales) out.push({ id, s });
  }
  return out;
}

/** Read one coin's trades and alert every whale trade since the last look. Returns alerts sent (null = data busy). */
export async function alertPool(t: PairRow, subs: Sub[], v: Verify | undefined): Promise<number | null> {
  const minUsd = Math.min(...subs.map((x) => x.s.prefs!.minWhale));
  const last = Number((await kvGet(`awlast:${t.pool}`)) ?? 0);
  const trades = await bigTrades(t.pool, t.ca, minUsd).catch(() => null);
  if (!trades) return null; // busy (429): keep the old mark so nothing is missed
  const newest = trades.length ? trades[trades.length - 1].t * 1000 : 0; // trade times are in seconds
  await kvPipeline([["SET", `awlast:${t.pool}`, String(Math.max(newest, last || Date.now())), "EX", 7 * 86400]]);
  if (!last) return 0; // first look at this coin: start from now
  let sent = 0;
  for (const w of trades.filter((x) => x.t * 1000 > last && Date.now() - x.t * 1000 < 20 * 60_000).slice(-4)) {
    const text = `<b>Whale ${w.kind === "buy" ? "bought" : "sold"} $${esc(t.symbol)}</b>  ${usd(w.usd)}\nWallet <code>${w.wallet.slice(0, 4)}…${w.wallet.slice(-4)}</code>${t.mc ? ` · MC ${usd(t.mc)}` : ""} · Liq ${usd(t.liq)}\n${v?.ok ? `ORBIT Verified · ${v.organicPct}% organic volume` : "Not ORBIT Verified"}`;
    for (const x of subs) {
      const p = x.s.prefs!;
      if (w.usd < p.minWhale) continue;
      if (p.verifiedOnly && !v?.ok) continue;
      if (!(await setOnce(`aw:${x.id}:${w.wallet}:${w.t}`, "1", 3600).catch(() => false))) continue;
      if (await tgSendCoin(x.s.chat, text, t.ca, open(t.ca))) sent++;
    }
  }
  return sent;
}

type DsPair = { baseToken: { address: string }; pairAddress: string; volume?: { h24?: number } };

/** 24h volume per pool, straight from DexScreener (30 coins per call) */
async function volumes(cas: string[]) {
  const out = new Map<string, number>();
  for (let i = 0; i < cas.length; i += 30) {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${cas.slice(i, i + 30).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      for (const p of (await r.json()) as DsPair[]) if (p.volume?.h24 != null) out.set(p.pairAddress, p.volume.h24);
    } catch {}
  }
  return out;
}

/** Watch the top 40 coins for about `budgetMs`, polling every 10 s; alert whales as soon as their volume shows up */
export async function whaleWatch(budgetMs = 48_000) {
  if (!kvConfigured() || !tgReady()) return { skipped: "not configured" };
  const [lock] = (await kvPipeline([["SET", "wwlock", "1", "NX", "EX", 58]])) as [string | null];
  if (lock !== "OK") return { skipped: "locked" };
  const start = Date.now();
  let sent = 0;
  let checks = 0;
  try {
    const subs = await allWhaleSubs();
    if (!subs.length) return { skipped: "nobody has it on" };
    const list = await allPairs(40);
    const byPool = new Map(list.map((t) => [t.pool, t]));
    const minUsd = Math.min(...subs.map((x) => x.s.prefs!.minWhale));
    const ver = await cachedVerify(list.map((t) => t.ca));
    const unverified = list.filter((t) => !ver[t.ca]).map((t) => ({ ca: t.ca, pool: t.pool }));
    const prevRaw = await kvGet("ww:vol");
    const prev = new Map<string, number>(prevRaw ? Object.entries(JSON.parse(prevRaw)) : []);
    while (Date.now() - start < budgetMs) {
      const tick = Date.now();
      const vols = await volumes(list.map((t) => t.ca));
      // coins whose volume jumped by at least one whale-sized trade since the last poll
      const jumped = [...vols.entries()]
        .filter(([pool, v]) => byPool.has(pool) && prev.has(pool) && v - prev.get(pool)! >= minUsd * 0.8)
        .sort((a, b) => b[1] - prev.get(b[0])! - (a[1] - prev.get(a[0])!))
        .slice(0, 4);
      for (const [pool, v] of vols) prev.set(pool, v);
      for (const [pool] of jumped) {
        const n = await alertPool(byPool.get(pool)!, subs, ver[byPool.get(pool)!.ca]);
        checks++;
        if (n) sent += n;
      }
      await kvPipeline([["SET", "ww:vol", JSON.stringify(Object.fromEntries(prev)), "EX", 600]]);
      const left = 10_000 - (Date.now() - tick);
      if (Date.now() - start + Math.max(0, left) >= budgetMs) break;
      if (left > 0) await wait(left);
    }
    // use spare time to ORBIT-verify coins that are not checked yet (so "Only ORBIT Verified" has data)
    if (unverified.length && Date.now() - start < budgetMs + 8000) await verifyPending(unverified, 1, 8000).catch(() => 0);
  } finally {
    await kvPipeline([["DEL", "wwlock"]]);
  }
  return { sent, checks, ms: Date.now() - start };
}
