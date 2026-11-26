"use client";

import { useEffect, useState } from "react";
import { getAlerts, onAlertsChange } from "./alerts";
import { getFollows, onFollowChange } from "./Follow";
import { api } from "./key";
import { getWatch, onWatchChange } from "./Watchlist";

type Prefs = { whales: boolean; buying: boolean; wallets: boolean; picks: boolean; minWhale: number };

/** Copy alerts, followed wallets and the watchlist to the server (only used once Telegram is connected) */
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
            coins: getWatch().map(({ ca, symbol }) => ({ ca, symbol })),
          }),
        }).catch(() => {});
      }, 1500);
    };
    push();
    const a = onAlertsChange(push);
    const b = onFollowChange(push);
    const c = onWatchChange(push);
    return () => {
      if (t) clearTimeout(t);
      a();
      b();
      c();
    };
  }, [ultra]);
}

type State = { ready: boolean; connected?: boolean; link?: string; prefs?: Prefs; ultraGroup?: string | null; channel?: string | null };

/** Ultra: connect Telegram, choose live coin alerts, join the private Ultra group */
export default function TelegramCard() {
  const [s, setS] = useState<State | null>(null);
  const [saved, setSaved] = useState(false);
  const load = () =>
    api("/api/tg")
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS({ ready: false }));
  useEffect(() => {
    load();
  }, []);
  const setPref = (p: Partial<Prefs>) => {
    if (!s?.prefs) return;
    const prefs = { ...s.prefs, ...p };
    setS({ ...s, prefs });
    api("/api/tg", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefs }) })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div className="card tg-card">
      <div className="section-head">
        <h3>Telegram alerts</h3>
        <span className="tier-tag ultra">Ultra</span>
      </div>
      <p className="small muted">
        Personal alerts from @OrbitOnSolBot — even when ORBIT is closed, checked about every minute.{" "}
        <a href="/orbit-telegram-guide.pdf" target="_blank" rel="noreferrer">Guide (PDF) ↗</a>
      </p>
      {!s ? (
        <p className="muted small">Checking…</p>
      ) : !s.ready ? (
        <p className="muted small">Telegram alerts are being switched on. Check back soon.</p>
      ) : !s.connected ? (
        <div className="tg-row">
          <a className="tier-btn ultra tg-btn" href={s.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(load, 8000)}>
            Connect Telegram
          </a>
          <span className="muted small">Opens the ORBIT bot — tap Start.</span>
        </div>
      ) : (
        <>
          <div className="tg-row">
            <span className="up">Connected</span>
            {s.ultraGroup && (
              <a className="tier-btn ultra tg-btn" href={s.ultraGroup} target="_blank" rel="noreferrer">
                Join ORBIT Ultra group
              </a>
            )}
            <a className="buy-link" href={s.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(load, 8000)}>Reconnect</a>
          </div>
          <div className="tg-prefs">
            <span className="label">ORBIT Scalp &amp; Hold</span>
            <label className="tg-check">
              <input type="checkbox" checked={s.prefs?.picks !== false} onChange={(e) => setPref({ picks: e.target.checked })} />
              New coin added to Scalp or Hold (entry, target, stop)
            </label>
            <span className="label">Live alerts on your watchlist coins</span>
            {(
              [
                ["whales", "Whale buys & sells"],
                ["buying", "Community buying (buy wave in 5 min)"],
                ["wallets", "Many new wallets buying"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="tg-check">
                <input type="checkbox" checked={!!s.prefs?.[k]} onChange={(e) => setPref({ [k]: e.target.checked })} />
                {label}
              </label>
            ))}
            <label className="tg-check">
              Whale size from
              <select value={s.prefs?.minWhale ?? 2000} onChange={(e) => setPref({ minWhale: Number(e.target.value) })}>
                {[1000, 2000, 5000, 10000, 25000].map((v) => (
                  <option key={v} value={v}>${v.toLocaleString("en-US")}</option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Add coins with <b>Watch</b> on any coin page (up to 25). Price alerts and followed wallets are sent too.{saved ? " Saved." : ""}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Everyone: link to the public ORBIT Telegram channel */
export function CommunityCard() {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/community")
      .then((r) => r.json())
      .then((j) => setLink(j.channel))
      .catch(() => {});
  }, []);
  if (!link) return null;
  return (
    <a className="card community-card" href={link} target="_blank" rel="noreferrer">
      <span className="label">ORBIT community</span>
      <b>Join us on Telegram</b>
      <span className="muted small">Updates, new features and the daily ORBIT reads.</span>
    </a>
  );
}
