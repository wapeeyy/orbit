import { createHash, createHmac } from "node:crypto";

// Telegram bot for Ultra alerts that arrive even when ORBIT is closed.
// Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_BOT_NAME (the bot's username, without @).
export const tgToken = () => process.env.TELEGRAM_BOT_TOKEN || "";
export const tgName = () => (process.env.TELEGRAM_BOT_NAME || "").replace(/^@/, "");
export const tgReady = () => !!tgToken() && !!tgName();

/** Secret Telegram sends back on every webhook call (derived, so nothing extra to configure) */
export const tgHookSecret = () =>
  createHmac("sha256", process.env.ORBIT_SECRET || process.env.HELIUS_API_KEY || "orbit").update("tg-hook").digest("hex").slice(0, 48);

/** Stable id for a subscriber, from their access code (never stored in clear) */
export const subId = (key: string) => createHash("sha256").update("tg:" + key.trim()).digest("hex").slice(0, 24);

export async function tgSend(chatId: number | string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${tgToken()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.ok;
}

export type TgSub = {
  chat: number;
  exp: number; // access-code expiry (ms)
  alerts: { id: string; ca: string; symbol: string; price: number; dir: "above" | "below"; label?: string }[];
  wallets: { address: string; label: string; seen: string[] }[];
};
