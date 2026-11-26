"use client";

import { useEffect } from "react";
import { getKey, keyTier, setKey } from "./key";

type TgWebApp = { initData: string; ready: () => void; expand: () => void; setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void };
// coin from the "Open in ORBIT" link, read when this module loads (the page removes ?ca= from the URL right after)
const startCa = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("ca");

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

/**
 * ORBIT inside Telegram (Mini App, opened by "Open in ORBIT" in the bot).
 * Full height, black header, and Ultra signs in by itself for the connected Telegram account.
 */
export default function TgApp() {
  useEffect(() => {
    let inTg = false;
    try {
      inTg = location.hash.includes("tgWebAppData") || sessionStorage.getItem("orbit.tg") === "1";
      if (inTg) sessionStorage.setItem("orbit.tg", "1");
    } catch {}
    if (!inTg) return;
    document.body.classList.add("in-tg");
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = async () => {
      const app = window.Telegram?.WebApp;
      if (!app) return;
      app.ready();
      app.expand();
      app.setHeaderColor?.("#000000");
      app.setBackgroundColor?.("#000000");
      if (!app.initData || keyTier(getKey()) === "ultra") return;
      try {
        const r = await fetch("/api/tg/app", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: app.initData }) });
        const j = (await r.json()) as { key?: string | null };
        if (j.key) {
          setKey(j.key);
          // reopen the same coin, now unlocked
          if (startCa) location.replace(`/?ca=${encodeURIComponent(startCa)}&src=tg-app`);
          else location.reload();
        }
      } catch {}
    };
    document.head.appendChild(s);
  }, []);
  return null;
}
