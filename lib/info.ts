import { narratives } from "./analysis";
import { rpc } from "./holders";

export type Activity = {
  platform: "telegram" | "x";
  handle: string;
  url: string;
  lastPostAt: string | null; // ISO
  lastText: string | null;
  note?: string; // sebab tak dapat semak
};

export type TokenInfo = {
  description: string | null;
  narratives: string[];
  websites: string[];
  twitter: string | null;
  telegram: string | null;
  others: { label: string; url: string }[];
  activity: Activity[];
  launchpad: string | null;
  dev: string | null;
  holderCount: number | null;
};

const UA = { "user-agent": "Mozilla/5.0 (compatible; ORBIT/1.0)" };
const IPFS_GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://4everland.io/ipfs/", "https://ipfs.filebase.io/ipfs/"];

async function getJson<T>(url: string, ms = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getText(url: string, ms = 8000): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

/** Fail metadata (nama, penerangan, sosial). Gateway ipfs.io dah tak layan, jadi cuba gateway lain. */
async function fetchMetadata(uri: string): Promise<Record<string, unknown> | null> {
  const m = uri.match(/\/ipfs\/(.+)$/) ?? uri.match(/^ipfs:\/\/(.+)$/) ?? uri.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+\/?(.*)$/i);
  if (m) {
    const path = m[2] ? `${m[1]}/${m[2]}` : m[1];
    for (const g of IPFS_GATEWAYS) {
      const j = await getJson<Record<string, unknown>>(g + path, 6000);
      if (j) return j;
    }
    return null;
  }
  return getJson<Record<string, unknown>>(uri);
}

async function metadataUri(ca: string): Promise<{ uri: string | null; description: string | null }> {
  // Token-2022 (pump.fun baru): metadata dalam mint itu sendiri
  try {
    const r = await rpc<{ value: { data: { parsed?: { info?: { extensions?: { extension: string; state: { uri?: string } }[] } } } } | null }>(
      "getAccountInfo",
      [ca, { encoding: "jsonParsed" }],
    );
    const ext = r.value?.data?.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata");
    if (ext?.state?.uri) return { uri: ext.state.uri, description: null };
  } catch {}
  // Token SPL biasa: Helius DAS
  try {
    const a = await rpc<{ content?: { json_uri?: string; metadata?: { description?: string } } }>("getAsset", { id: ca });
    return { uri: a.content?.json_uri || null, description: a.content?.metadata?.description || null };
  } catch {}
  return { uri: null, description: null };
}

const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

async function telegramActivity(url: string): Promise<Activity | null> {
  const m = url.match(/t(?:elegram)?\.me\/(?:s\/)?([A-Za-z0-9_+]+)/);
  if (!m) return null;
  const handle = m[1];
  const base: Activity = { platform: "telegram", handle, url, lastPostAt: null, lastText: null };
  if (handle.startsWith("+") || handle === "joinchat") return { ...base, note: "Group peribadi — post tak boleh dibaca dari luar" };
  const r = await getText(`https://t.me/s/${handle}`);
  if (!r || r.status !== 200) return { ...base, note: "Tak dapat buka Telegram" };
  const blocks = r.text.split('class="tgme_widget_message_wrap').slice(1);
  if (blocks.length === 0) return { ...base, note: "Ini group chat (bukan channel) — tiada post awam untuk disemak" };
  const last = blocks[blocks.length - 1];
  const time = last.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null;
  const text = last.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
  return { ...base, lastPostAt: time, lastText: text ? clip(strip(text)) : "(media / tanpa teks)" };
}

function findTweets(node: unknown, out: { at: string; text: string }[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => findTweets(n, out));
  const o = node as Record<string, unknown>;
  if (typeof o.created_at === "string" && (typeof o.full_text === "string" || typeof o.text === "string")) {
    out.push({ at: o.created_at, text: String(o.full_text ?? o.text) });
  }
  for (const v of Object.values(o)) findTweets(v, out);
}

async function xActivity(url: string): Promise<Activity | null> {
  const m = url.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
  if (!m) return null;
  const handle = m[1];
  const base: Activity = { platform: "x", handle, url, lastPostAt: null, lastText: null };
  if (["i", "intent", "home", "search", "hashtag"].includes(handle.toLowerCase()))
    return { ...base, handle: "community", note: "Link X Community — tak boleh disemak automatik" };
  const r = await getText(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`);
  const json = r?.text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!r || r.status !== 200 || !json) return { ...base, note: "X hadkan akses — buka profil untuk semak" };
  const tweets: { at: string; text: string }[] = [];
  try {
    findTweets(JSON.parse(json), tweets);
  } catch {}
  if (tweets.length === 0) return { ...base, note: "Tiada post awam dijumpai" };
  tweets.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { ...base, lastPostAt: new Date(tweets[0].at).toISOString(), lastText: clip(strip(tweets[0].text)) };
}

type JupToken = { id: string; twitter?: string; telegram?: string; website?: string; launchpad?: string; dev?: string; holderCount?: number };
type DexInfo = { info?: { websites?: { url: string; label?: string }[]; socials?: { url: string; type: string }[] } };

const cache = new Map<string, { at: number; v: TokenInfo }>();
const TTL = 10 * 60_000;

export async function getInfo(ca: string): Promise<TokenInfo> {
  const hit = cache.get(ca);
  if (hit && Date.now() - hit.at < TTL) return hit.v;

  const [dex, jup, meta0] = await Promise.all([
    getJson<DexInfo[]>(`https://api.dexscreener.com/tokens/v1/solana/${ca}`),
    getJson<JupToken[]>(`https://lite-api.jup.ag/tokens/v2/search?query=${ca}`),
    metadataUri(ca),
  ]);
  const meta = meta0.uri ? await fetchMetadata(meta0.uri) : null;
  const j = jup?.find((t) => t.id === ca);
  const info = dex?.[0]?.info;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const ext = (meta?.extensions ?? {}) as Record<string, unknown>;

  const websites = new Set<string>();
  [str(meta?.website), str(ext.website), j?.website, ...(info?.websites?.map((w) => w.url) ?? [])].forEach(
    (u) => u && /^https?:\/\//.test(u) && websites.add(u),
  );

  const socials = info?.socials ?? [];
  const pick = (type: string, ...more: (string | null | undefined)[]) =>
    [...socials.filter((s) => s.type === type).map((s) => s.url), ...more].find((u) => u && /^https?:\/\//.test(u)) ?? null;
  const twitter = pick("twitter", j?.twitter, str(meta?.twitter), str(ext.twitter));
  const telegram = pick("telegram", j?.telegram, str(meta?.telegram), str(ext.telegram));
  const others = socials
    .filter((s) => s.type !== "twitter" && s.type !== "telegram")
    .map((s) => ({ label: s.type, url: s.url }));

  const description = str(meta?.description) ?? meta0.description;
  const name = str(meta?.name);
  const symbol = str(meta?.symbol);

  const activity = (
    await Promise.all([telegram ? telegramActivity(telegram) : null, twitter ? xActivity(twitter) : null])
  ).filter((a): a is Activity => a !== null);

  const v: TokenInfo = {
    description: description ? clip(description, 600) : null,
    narratives: narratives(name, symbol, description),
    websites: [...websites].slice(0, 3),
    twitter,
    telegram,
    others,
    activity,
    launchpad: j?.launchpad ?? null,
    dev: j?.dev ?? null,
    holderCount: j?.holderCount ?? null,
  };
  cache.set(ca, { at: Date.now(), v });
  return v;
}
