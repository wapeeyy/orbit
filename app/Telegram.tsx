"use client";

import { useEffect, useState } from "react";
import { getAlerts, onAlertsChange } from "./alerts";
import { getFollows, onFollowChange } from "./Follow";
import { api } from "./key";

/** Copy alerts + followed wallets to the server (only does anything once Telegram is connected) */
export function useTelegramSync(ultra: boolean) {
  useEffect(() => {
    if (!ultra) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        api("/api/tg", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            alerts: getAlerts().filter((a) => !a.hit).map(({ id, ca, symbol, price, dir, label }) => ({ id, ca, symbol, price, dir, label })),
            wallets: getFollows().map(({ address, label }) => ({ address, label })),
          }),
        }).catch(() => {});
      }, 1500);
    };
    push();
    const a = onAlertsChange(push);
    const b = onFollowChange(push);
    return () => {
      if (t) clearTimeout(t);
      a();
      b();
    };
  }, [ultra]);
}

/** Ultra: connect a Telegram chat for alerts that arrive even when ORBIT is closed */
export default function TelegramCard() {
  const [s, setS] = useState<{ ready: boolean; connected?: boolean; link?: string } | null>(null);
  const load = () =>
    api("/api/tg")
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS({ ready: false }));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="card tg-card">
      <div className="section-head">
        <h3>Telegram alerts</h3>
        <span className="tier-tag ultra">Ultra</span>
      </div>
      <p className="small muted">
        Price alerts and smart-money trades sent to Telegram — even when ORBIT is closed. Checked about every 5 minutes.{" "}
        <a href="/orbit-telegram-guide.pdf" target="_blank" rel="noreferrer">Guide (PDF) ↗</a>
      </p>
      {!s ? (
        <p className="muted small">Checking…</p>
      ) : !s.ready ? (
        <p className="muted small">Telegram alerts are being switched on. Check back soon.</p>
      ) : s.connected ? (
        <div className="tg-row">
          <span className="up">Connected</span>
          <a className="buy-link" href={s.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(load, 8000)}>Reconnect</a>
        </div>
      ) : (
        <div className="tg-row">
          <a className="tier-btn ultra tg-btn" href={s.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(load, 8000)}>
            Connect Telegram
          </a>
          <span className="muted small">Opens the ORBIT bot — tap Start.</span>
        </div>
      )}
    </div>
  );
}
