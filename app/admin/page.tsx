"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../key";

type Ev =
  | { type: "trial"; at: number; wallet: string; country: string }
  | { type: "payment"; at: number; plan: string; tier: "pro" | "ultra"; usd: number; days: number; payer: string; tx: string; country: string };
type Day = { day: string; visitors: number; views: number; countries: Record<string, number>; sources: Record<string, number> };
type Data = {
  events: Ev[];
  totals: { trials: number; payments: number; revenue: number };
  traffic?: { perDay: Day[]; unique7: number; unique30: number };
};

const sum = (days: Day[], k: "countries" | "sources") => {
  const m = new Map<string, number>();
  days.forEach((d) => Object.entries(d[k]).forEach(([x, n]) => m.set(x, (m.get(x) ?? 0) + n)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const DAY = 86_400_000;
const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");

/** Owner dashboard: who started a trial, who paid, revenue. Needs the owner access code in this browser. */
export default function Admin() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "trial" | "payment">("all");

  const load = () =>
    api("/api/admin")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setD(j);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const stats = useMemo(() => {
    if (!d) return null;
    const now = Date.now();
    const inLast = (ms: number, t: Ev["type"]) => d.events.filter((e) => e.type === t && now - e.at < ms).length;
    const pays = d.events.filter((e): e is Extract<Ev, { type: "payment" }> => e.type === "payment");
    const active = pays.filter((p) => p.at + p.days * DAY > now);
    const countries = new Map<string, number>();
    d.events.forEach((e) => countries.set(e.country, (countries.get(e.country) ?? 0) + 1));
    const trialWallets = new Set(d.events.filter((e) => e.type === "trial").map((e) => (e as { wallet: string }).wallet));
    const converted = new Set(pays.filter((p) => trialWallets.has(p.payer)).map((p) => p.payer)).size;
    return {
      trialsToday: inLast(DAY, "trial"),
      trials7: inLast(7 * DAY, "trial"),
      pays30: inLast(30 * DAY, "payment"),
      rev30: pays.filter((p) => now - p.at < 30 * DAY).reduce((s, p) => s + p.usd, 0),
      activePro: active.filter((p) => p.tier === "pro").length,
      activeUltra: active.filter((p) => p.tier === "ultra").length,
      conv: trialWallets.size ? Math.round((converted / trialWallets.size) * 100) : 0,
      countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [d]);

  const rows = d?.events.filter((e) => filter === "all" || e.type === filter) ?? [];

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>ORBIT admin</h1>
        <button className="ghost" onClick={load}>Refresh</button>
      </header>
      {err && (
        <div className="alert danger">
          {err === "Owner only" ? "Open your owner activation link in this browser first, then reload this page." : err}
        </div>
      )}
      {d && stats && (
        <>
          {d.traffic && <Traffic t={d.traffic} />}
          <h2 className="admin-h2">Sign-ups & payments</h2>
          <div className="admin-grid">
            <Stat k="Trials today" v={stats.trialsToday} />
            <Stat k="Trials · 7 days" v={stats.trials7} />
            <Stat k="Trials · all time" v={d.totals.trials} />
            <Stat k="Trial → paid" v={`${stats.conv}%`} />
            <Stat k="Payments · 30 days" v={stats.pays30} />
            <Stat k="Revenue · 30 days" v={`$${stats.rev30.toFixed(2)}`} tone="up" />
            <Stat k="Revenue · all time" v={`$${d.totals.revenue.toFixed(2)}`} tone="up" />
            <Stat k="Active paid" v={`${stats.activePro} Pro · ${stats.activeUltra} Ultra`} />
          </div>
          {stats.countries.length > 0 && (
            <div className="admin-countries">
              {stats.countries.map(([cc, n]) => (
                <span key={cc} className="chip">{flag(cc)} {cc} · {n}</span>
              ))}
            </div>
          )}
          <div className="views" style={{ margin: "16px 0 10px" }}>
            {(["all", "trial", "payment"] as const).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "trial" ? "Trials" : "Payments"}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="muted">Nothing yet — new trials and payments appear here as they happen.</p>
          ) : (
            <div className="admin-table">
              {rows.map((e, i) => (
                <div key={i} className={`admin-row ${e.type}`}>
                  <span className="muted small">{when(e.at)}</span>
                  <b>{e.type === "trial" ? "TRIAL" : `${e.tier.toUpperCase()} $${e.usd}`}</b>
                  <span className="small">{e.type === "payment" ? `${e.plan} · ${e.days}d` : "7-day Pro"}</span>
                  <a className="mono small" href={`https://solscan.io/${e.type === "payment" ? `tx/${e.tx}` : `account/${e.wallet}`}`} target="_blank" rel="noreferrer">
                    {short(e.type === "payment" ? e.payer : e.wallet)} ↗
                  </a>
                  <span>{flag(e.country)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 16 }}>
            Records start from when this page went live; earlier payments are in your wallet history. Tip: share links with ?src=name (e.g.
            orbitonsol.com/?src=kol-ali) to see which ad or influencer brings visitors.
          </p>
        </>
      )}
    </main>
  );
}

function Traffic({ t }: { t: NonNullable<Data["traffic"]> }) {
  const days = t.perDay;
  const today = days[0];
  const last14 = [...days.slice(0, 14)].reverse();
  const max = Math.max(1, ...last14.map((d) => d.visitors));
  const views30 = days.reduce((s, d) => s + d.views, 0);
  const src = sum(days.slice(0, 30), "sources").slice(0, 8);
  const cc = sum(days.slice(0, 30), "countries").slice(0, 10);
  const total = src.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <>
      <h2 className="admin-h2">Visitors</h2>
      <div className="admin-grid">
        <Stat k="Visitors today" v={today?.visitors ?? 0} />
        <Stat k="Visitors · 7 days" v={t.unique7} />
        <Stat k="Visitors · 30 days" v={t.unique30} />
        <Stat k="Visits · 30 days" v={views30} />
      </div>
      <div className="admin-bars" title="Unique visitors per day, last 14 days">
        {last14.map((d) => (
          <div key={d.day} className="admin-bar">
            <i style={{ height: `${(d.visitors / max) * 100}%` }} />
            <span>{d.visitors}</span>
            <em>{d.day.slice(8)}</em>
          </div>
        ))}
      </div>
      <div className="admin-split">
        <div>
          <span className="label">Where they come from · 30 days</span>
          {src.length === 0 && <p className="muted small">No visits yet.</p>}
          {src.map(([k, n]) => (
            <div key={k} className="admin-src">
              <span>{k}</span>
              <i style={{ width: `${(n / total) * 100}%` }} />
              <b>{n}</b>
            </div>
          ))}
        </div>
        <div>
          <span className="label">Countries · 30 days</span>
          <div className="admin-countries">
            {cc.map(([k, n]) => (
              <span key={k} className="chip">{flag(k)} {k} · {n}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ k, v, tone }: { k: string; v: string | number; tone?: string }) {
  return (
    <div className={`insight ${tone ?? ""}`}>
      <span className="label">{k}</span>
      <span className="value">{v}</span>
    </div>
  );
}
