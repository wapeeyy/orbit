import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { kvGet, kvPipeline } from "./kv";

// Telegram bot (@OrbitOnSolBot): personal Ultra alerts, the public ORBIT channel and the private ORBIT Ultra group.
// Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_BOT_NAME (the bot's username, without @).
export const tgToken = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim().replace(/^bot/i, "").replace(/\s+/g, "");
export const tgName = () => (process.env.TELEGRAM_BOT_NAME || "").trim().replace(/^@/, "");
export const tgReady = () => !!tgToken() && !!tgName();

/** Secret Telegram sends back on every webhook call (derived, so nothing extra to configure) */
export const tgHookSecret = () =>
  createHmac("sha256", process.env.ORBIT_SECRET || process.env.HELIUS_API_KEY || "orbit").update("tg-hook").digest("hex").slice(0, 48);

/** Stable id for a subscriber, from their access code (never stored in clear) */
export const subId = (key: string) => createHash("sha256").update("tg:" + key.trim()).digest("hex").slice(0, 24);

/** Any Bot API method */
export async function tgCall<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: (e as Error).message };
  }
}

/** app: open the link as a Telegram Mini App (private chats only; groups and channels get a normal link) */
export type TgButton = { text: string; url: string; app?: boolean };
export async function tgSend(chatId: number | string, text: string, button?: TgButton) {
  const btn = button ? (button.app && Number(chatId) > 0 ? { text: button.text, web_app: { url: button.url } } : { text: button.text, url: button.url }) : null;
  const r = await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(btn ? { reply_markup: { inline_keyboard: [[btn]] } } : {}),
  });
  return r.ok;
}

export type CoinWatch = { ca: string; symbol: string };
export type Prefs = { whales: boolean; buying: boolean; wallets: boolean; picks: boolean; minWhale: number };
export const DEFAULT_PREFS: Prefs = { whales: true, buying: true, wallets: true, picks: true, minWhale: 2000 };

export type TgSub = {
  chat: number;
  exp: number; // access-code expiry (ms)
  owner?: boolean;
  invited?: number; // Ultra group id the invite was sent for
  alerts: { id: string; ca: string; symbol: string; price: number; dir: "above" | "below"; label?: string }[];
  wallets: { address: string; label: string; seen: string[] }[];
  coins?: CoinWatch[];
  prefs?: Prefs;
};

/** Where the community lives (set by the owner with /bind) */
export type Community = {
  public?: { id: number; title: string; link?: string };
  ultra?: { id: number; title: string; link?: string };
};

export async function getCommunity(): Promise<Community> {
  const raw = await kvGet("tg:community");
  return raw ? (JSON.parse(raw) as Community) : {};
}
export async function setCommunity(c: Community) {
  await kvPipeline([["SET", "tg:community", JSON.stringify(c)]]);
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const usd = (n: number) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : Math.round(n).toLocaleString("en-US"));
export const px = (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(4));
export const SITE = "https://www.orbitonsol.com";

/** Check Telegram Mini App initData (signed with the bot token); returns the Telegram user id */
export function tgVerifyInitData(initData: string, maxAgeS = 86_400): number | null {
  if (!initData || !tgToken()) return null;
  const q = new URLSearchParams(initData);
  const hash = q.get("hash");
  if (!hash) return null;
  q.delete("hash");
  const check = [...q.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(tgToken()).digest();
  const sig = createHmac("sha256", secret).update(check).digest();
  const got = Buffer.from(hash, "hex");
  if (got.length !== sig.length || !timingSafeEqual(got, sig)) return null;
  if (Date.now() / 1000 - Number(q.get("auth_date") ?? 0) > maxAgeS) return null;
  try {
    const id = (JSON.parse(q.get("user") ?? "null") as { id?: number } | null)?.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
