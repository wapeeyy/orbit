"use client";

import { useEffect, useState } from "react";
import { getAlerts, markHit, onAlertsChange, type PriceAlert } from "./alerts";
import { fmtPrice } from "./Chart";

/** Checks active price alerts every 30 s while ORBIT is open; shows a toast + system notification when hit. */
export default function AlertWatcher({ onOpen }: { onOpen?: (ca: string) => void }) {
  const [toasts, setToasts] = useState<(PriceAlert & { now: number })[]>([]);

  useEffect(() => {
    let dead = false;
    const check = async () => {
      const active = getAlerts().filter((a) => !a.hit);
      if (active.length === 0) return;
      const cas = [...new Set(active.map((a) => a.ca))].slice(0, 30);
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cas.join(",")}`);
        const j = await r.json();
        const price = new Map<string, number>();
        for (const p of j.pairs ?? []) {
          const ca = p.baseToken?.address;
          if (ca && !price.has(ca) && p.priceUsd) price.set(ca, Number(p.priceUsd));
        }
        const hit = active
          .map((a) => ({ a, now: price.get(a.ca) }))
          .filter((x): x is { a: PriceAlert; now: number } => x.now != null && (x.a.dir === "above" ? x.now >= x.a.price : x.now <= x.a.price));
        if (dead || hit.length === 0) return;
        markHit(hit.map((x) => x.a.id));
        setToasts((t) => [...t, ...hit.map((x) => ({ ...x.a, now: x.now }))]);
        for (const { a, now } of hit) {
          const body = `${a.symbol} is ${a.dir} $${fmtPrice(a.price)}${a.label ? ` (${a.label})` : ""} — now $${fmtPrice(now)}`;
          try {
            if (Notification.permission === "granted") {
              const reg = await navigator.serviceWorker?.getRegistration();
              if (reg) reg.showNotification("ORBIT price alert", { body, icon: "/icon-192.png", tag: a.id });
              else new Notification("ORBIT price alert", { body, icon: "/icon-192.png" });
            }
          } catch {}
        }
        try {
          const ctx = new AudioContext();
          [880, 1320].forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = f;
            g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.25);
            o.connect(g).connect(ctx.destination);
            o.start(ctx.currentTime + i * 0.18);
            o.stop(ctx.currentTime + i * 0.18 + 0.3);
          });
        } catch {}
      } catch {}
    };
    check();
    const iv = setInterval(check, 30_000);
    const off = onAlertsChange(check);
    return () => {
      dead = true;
      clearInterval(iv);
      off();
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.slice(-3).map((t) => (
        <div key={t.id} className={`toast ${t.dir === "above" ? "up" : "down"}`}>
          <b>{t.symbol} {t.dir === "above" ? "broke above" : "dropped below"} ${fmtPrice(t.price)}</b>
          <span className="small">{t.label ? `${t.label} · ` : ""}now ${fmtPrice(t.now)}</span>
          <div className="toast-actions">
            {onOpen && <button onClick={() => { onOpen(t.ca); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>Open chart</button>}
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
