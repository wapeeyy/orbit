"use client";

import { useEffect } from "react";

/** Where the visitor came from: ?src= / utm_source, else the referring site */
function source() {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("src") || q.get("utm_source");
  if (s) return s;
  let host = "";
  try {
    host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
  } catch {}
  if (!host || host.endsWith("orbitonsol.com") || host.endsWith("vercel.app")) return (window.matchMedia("(display-mode: standalone)").matches ? "app" : "direct");
  if (host === "t.co" || host.endsWith("x.com") || host.endsWith("twitter.com")) return "x";
  if (host.includes("instagram")) return "instagram";
  if (host.includes("tiktok")) return "tiktok";
  if (host.includes("facebook") || host === "l.facebook.com" || host === "fb.me") return "facebook";
  if (host.includes("t.me") || host.includes("telegram")) return "telegram";
  if (host.includes("whatsapp") || host === "wa.me") return "whatsapp";
  if (host.includes("google")) return "google";
  if (host.includes("youtube")) return "youtube";
  return host.split(".").slice(-2).join(".");
}

/** Counts this visit once per browser session (no cookies, no personal data) */
export default function Hit() {
  useEffect(() => {
    try {
      if (window.location.pathname.startsWith("/admin") || sessionStorage.getItem("orbit.hit")) return;
      sessionStorage.setItem("orbit.hit", "1");
      let d = localStorage.getItem("orbit.device.v1");
      if (!d) {
        d = crypto.randomUUID();
        localStorage.setItem("orbit.device.v1", d);
      }
      fetch("/api/hit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d, src: source() }), keepalive: true }).catch(() => {});
    } catch {}
  }, []);
  return null;
}
