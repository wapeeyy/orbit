import { createHash, createHmac } from "node:crypto";
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

export async function tgSend(chatId: number | string, text: string, button?: { text: string; url: string }) {
  const r = await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  });
  return r.ok;
}

export type CoinWatch = { ca: string; symbol: string };
export type Prefs = { whales: boolean; buying: boolean; wallets: boolean; minWhale: number };
export const DEFAULT_PREFS: Prefs = { whales: true, buying: true, wallets: true, minWhale: 2000 };

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
