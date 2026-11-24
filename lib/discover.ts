import type { DexPair } from "./dex";
import { getHolders } from "./holders";
import { fetchCandles, narratives, volumeZone, type VolumeZone } from "./analysis";

// Senarai coin Solana yang DexScreener tengah tonjolkan
const SOURCES: { path: string; tag: string }[] = [
  { path: "token-profiles/latest/v1", tag: "Profil baru" },
  { path: "token-boosts/latest/v1", tag: "Boost baru" },
  { path: "token-boosts/top/v1", tag: "Boost top" },
  { path: "community-takeovers/latest/v1", tag: "CTO" },
];

// Penapis awal (longgar) sebelum semak holder — jimat kredit Helius
const PRE_MIN_LIQ = 5_000;
const PRE_MIN_MC = 10_000;
const MAX_HOLDER_CHECKS = 30;
const CONCURRENCY = 1; // plan percuma Helius cepat kena 429
const TIME_BUDGET_MS = 45_000; // pulangkan hasil sebelum had masa fungsi Vercel
const HOLDER_TTL_MS = 10 * 60_000;
const ZONE_BUDGET_MS = 38_000;
const MAX_ZONE_CHECKS = 25; // GeckoTerminal percuma: 30 permintaan/minit
const ZONE_TTL_MS = 10 * 60_000;
const zoneCache = new Map<string, { at: number; v: VolumeZone | null }>();
const holderCache = new Map<string, { at: number; v: NonNullable<Candidate["holders"]> }>();

export type Candidate = {
  ca: string;
  name: string;
  symbol: string;
  image?: string;
  url: string;
  dexId: string;
  tags: string[];
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number;
  volume24h: number;
  change24h: number | null;
  ageHours: number | null;
  buys24h: number;
  sells24h: number;
  holders: {
    top10Pct: number;
    top1Pct: number;
    wallets: number;
    mintRevoked: boolean;
    freezeRevoked: boolean;
  } | null;
  holdersError?: string;
  description: string | null;
  narratives: string[];
  links: { type: string; url: string }[];
  zone: VolumeZone | null;
};

export type DiscoverResult = { updatedAt: number; scanned: number; candidates: Candidate[] };

type ListItem = { chainId: string; tokenAddress: string; description?: string };
type PairWithTxns = DexPair & {
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
  pairCreatedAt?: number;
  txns?: { h24?: { buys: number; sells: number } };
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

let cache: { at: number; data: DiscoverResult } | null = null;
const CACHE_MS = 60_000;

export async function discover(): Promise<DiscoverResult> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  // 1. Kumpul CA Solana dari semua senarai
  const tags = new Map<string, Set<string>>();
  const descs = new Map<string, string>();
  const lists = await Promise.allSettled(
    SOURCES.map((s) => getJson<ListItem[]>(`https://api.dexscreener.com/${s.path}`)),
  );
  lists.forEach((r, i) => {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
    for (const x of r.value) {
      if (x.chainId !== "solana" || !x.tokenAddress) continue;
      if (!tags.has(x.tokenAddress)) tags.set(x.tokenAddress, new Set());
      tags.get(x.tokenAddress)!.add(SOURCES[i].tag);
      if (x.description && !descs.has(x.tokenAddress)) descs.set(x.tokenAddress, x.description);
    }
  });
  const cas = [...tags.keys()];

  // 2. Data pasaran, 30 token setiap panggilan
  const chunks: string[][] = [];
  for (let i = 0; i < cas.length; i += 30) chunks.push(cas.slice(i, i + 30));
  const pairLists = await Promise.all(
    chunks.map((c) => getJson<PairWithTxns[]>(`https://api.dexscreener.com/tokens/v1/solana/${c.join(",")}`).catch(() => [])),
  );
  const best = new Map<string, PairWithTxns>();
  for (const p of pairLists.flat()) {
    const ca = p.baseToken?.address;
    if (!ca || !tags.has(ca)) continue;
    const cur = best.get(ca);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(ca, p);
  }

  const now = Date.now();
  let candidates: Candidate[] = [...best.entries()].map(([ca, p]) => ({
    ca,
    name: p.baseToken.name,
    symbol: p.baseToken.symbol,
    image: p.info?.imageUrl,
    url: p.url,
    dexId: p.dexId,
    tags: [...tags.get(ca)!],
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    marketCap: p.marketCap ?? p.fdv ?? null,
    liquidityUsd: p.liquidity?.usd ?? 0,
    volume24h: p.volume?.h24 ?? 0,
    change24h: p.priceChange?.h24 ?? null,
    ageHours: p.pairCreatedAt ? (now - p.pairCreatedAt) / 3_600_000 : null,
    buys24h: p.txns?.h24?.buys ?? 0,
    sells24h: p.txns?.h24?.sells ?? 0,
    holders: null,
    description: descs.get(ca) ?? null,
    narratives: narratives(p.baseToken.name, p.baseToken.symbol, descs.get(ca)),
    links: [
      ...(p.info?.websites ?? []).slice(0, 1).map((w) => ({ type: "website", url: w.url })),
      ...(p.info?.socials ?? []).filter((x) => x.type === "twitter" || x.type === "telegram"),
    ],
    zone: null,
  }));

  // 3. Semak holder untuk yang lepas penapis awal (ikut volume tertinggi)
  const toCheck = candidates
    .filter((c) => c.liquidityUsd >= PRE_MIN_LIQ && (c.marketCap ?? 0) >= PRE_MIN_MC)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, MAX_HOLDER_CHECKS);

  const started = Date.now();
  // GeckoTerminal percuma ~30/minit: satu-satu, jarak 2.1 s, cuba semula sekali bila 429
  const zoneJob = (async () => {
    for (const c of toCheck.slice(0, MAX_ZONE_CHECKS)) {
      const hit = zoneCache.get(c.ca);
      if (hit && Date.now() - hit.at < ZONE_TTL_MS) {
        c.zone = hit.v;
        continue;
      }
      if (Date.now() - started > ZONE_BUDGET_MS) break;
      const pair = best.get(c.ca)!.pairAddress;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          c.zone = volumeZone(await fetchCandles(pair, c.ca, "minute", 15, 192));
          zoneCache.set(c.ca, { at: Date.now(), v: c.zone });
          break;
        } catch (e) {
          if ((e as { status?: number }).status !== 429) break;
          await sleep(4000);
        }
      }
      await sleep(2100);
    }
  })();
  const holderJob = pool(toCheck, CONCURRENCY, async (c) => {
    const hit = holderCache.get(c.ca);
    if (hit && Date.now() - hit.at < HOLDER_TTL_MS) {
      c.holders = hit.v;
      return;
    }
    if (Date.now() - started > TIME_BUDGET_MS) {
      c.holdersError = "Belum sempat disemak — cuba refresh";
      return;
    }
    try {
      const pairAddr = best.get(c.ca)!.pairAddress;
      const h = await getHolders(c.ca, { [pairAddr]: c.dexId });
      c.holders = {
        top10Pct: h.top10Pct,
        top1Pct: h.top1Pct,
        wallets: h.holders.length,
        mintRevoked: h.mintAuthority === null,
        freezeRevoked: h.freezeAuthority === null,
      };
      holderCache.set(c.ca, { at: Date.now(), v: c.holders });
    } catch (e) {
      c.holdersError = (e as Error).message;
    }
  });
  await Promise.all([zoneJob, holderJob]);

  candidates = candidates.sort((a, b) => b.volume24h - a.volume24h);
  const data = { updatedAt: now, scanned: cas.length, candidates };
  cache = { at: now, data };
  return data;
}
