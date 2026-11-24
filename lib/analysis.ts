export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type VolumeZone = {
  from: number;
  to: number;
  share: number; // % volume dalam zon
  price: number; // harga semasa (close terakhir)
  distPct: number; // 0 = dalam zon; + = atas zon; - = bawah zon
  near: boolean;
};

export const NEAR_ZONE_PCT = 5;

/** Profil volume: agih volume setiap candle ke zon harga yang dilaluinya, pulangkan zon terpadat. */
export function volumeZone(cs: Candle[], bins = 24): VolumeZone | null {
  if (cs.length < 3) return null;
  let lo = Infinity, hi = -Infinity, total = 0;
  for (const c of cs) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
    total += c.v;
  }
  const range = hi - lo || hi || 1;
  const step = range / bins;
  const vol = new Array(bins).fill(0);
  for (const c of cs) {
    const a = Math.max(0, Math.min(bins - 1, Math.floor((c.l - lo) / step)));
    const b = Math.max(0, Math.min(bins - 1, Math.floor((c.h - lo) / step)));
    for (let i = a; i <= b; i++) vol[i] += c.v / (b - a + 1);
  }
  const top = vol.indexOf(Math.max(...vol));
  const from = lo + top * step;
  const to = lo + (top + 1) * step;
  const price = cs[cs.length - 1].c;
  const distPct = price > to ? (price / to - 1) * 100 : price < from ? (price / from - 1) * 100 : 0;
  return {
    from,
    to,
    share: total ? (vol[top] / total) * 100 : 0,
    price,
    distPct,
    near: Math.abs(distPct) <= NEAR_ZONE_PCT,
  };
}

export async function fetchCandles(pool: string, token: string, frame: string, agg: number, limit: number) {
  const url =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${frame}` +
    `?aggregate=${agg}&limit=${limit}&currency=usd&token=${token}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`GeckoTerminal ${res.status}`), { status: res.status });
  const json = await res.json();
  const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
  return list.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }) as Candle).sort((a, b) => a.t - b.t);
}

// ---- Naratif: teka tema coin dari nama, simbol & penerangan ----
const NARRATIVES: { tag: string; kw: string[] }[] = [
  { tag: "AI", kw: ["ai", "agent", "gpt", "nvidia", "neural", "robot", "bot", "llm", "openai", "grok", "claude", "agi", "jensen"] },
  { tag: "Politics", kw: ["trump", "maga", "biden", "president", "election", "kamala", "putin", "vote", "senate", "congress"] },
  { tag: "Celebrity", kw: ["elon", "musk", "kanye", "drake", "celebrity", "saylor", "vitalik", "cz", "toly", "influencer"] },
  { tag: "Classic meme", kw: ["pepe", "wojak", "chad", "gigachad", "doge", "bonk", "wif", "copium", "cope", "kek", "apu"] },
  { tag: "Animal", kw: ["dog", "inu", "shib", "cat", "kitty", "meow", "frog", "hamster", "monkey", "ape", "penguin", "fish", "bird", "duck", "bear", "bull", "goat", "pig", "cow", "rat", "mouse", "fox", "wolf", "tiger", "lion", "panda", "otter", "seal", "hippo"] },
  { tag: "Seasonal", kw: ["xmas", "christmas", "santa", "halloween", "thanksgiving", "new year", "easter", "valentine", "snow", "elf"] },
  { tag: "Internet culture", kw: ["tiktok", "viral", "trend", "brainrot", "skibidi", "rizz", "sigma", "mog", "looksmax", "wasted", "bruh", "npc", "ratio", "stank", "fart"] },
  { tag: "Finance", kw: ["cash", "money", "usd", "dollar", "bank", "defi", "yield", "stable", "pay", "wsb", "wallstreet", "stock", "millionaire", "gold"] },
  { tag: "Gaming", kw: ["game", "gaming", "pixel", "arcade", "quest", "rpg"] },
  { tag: "Space", kw: ["rocket", "mars", "spacex", "outer space", "nasa", "galaxy", "astro", "alien"] },
];

export function narratives(...texts: (string | undefined | null)[]): string[] {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  const hits: string[] = [];
  for (const n of NARRATIVES) {
    const hit = n.kw.some((k) =>
      k.length < 4 ? new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(t) : t.includes(k),
    );
    if (hit) hits.push(n.tag);
    if (hits.length === 3) break;
  }
  return hits;
}
