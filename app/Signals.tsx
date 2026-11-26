"use client";

import { useEffect, useState } from "react";
import { api } from "./key";
import type { Closed, Pick, PicksState } from "@/lib/picks";

// Ultra: ORBIT Scalp & Hold. Coins that passed every check, each with an entry zone, target, stop and a public track record.
type Data = { scalp: PicksState | null; hold: PicksState | null; record: Record<"scalp" | "hold", { closed: Closed[]; open: number }> };

const px = (p: number) => (p >= 1 ? `$${p.toFixed(4)}` : `$${p.toPrecision(4)}`);
const usd = (n: number | null) => (n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const pc = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(n > -10 && n < 10 ? 1 : 0)}%`;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export default function Signals({ onOpen, demo }: { onOpen: (ca: string) => void; demo?: Data }) {
  const [kind, setKind] = useState<"scalp" | "hold">("scalp");
  const [d, setD] = useState<Data | null>(demo ?? null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    const load = () =>
      api("/api/picks")
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          setD(j);
        })
        .catch((e) => setErr(e.message));
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [demo]);

  const st = d?.[kind] ?? null;
  const rec = d?.record[kind];
  const closed = rec?.closed ?? [];
  const wins = closed.filter((c) => c.result === "target").length;
  const avg = closed.length ? closed.reduce((s, c) => s + c.pct, 0) / closed.length : 0;

  return (
    <section className="signals">
      <div className="card sig-intro">
        <span className="label">ORBIT Scalp &amp; Hold · Ultra</span>
        <p className="small">
          ORBIT scans trending and high-volume Solana coins, then lists only the ones that pass <b>every</b> check: chart bias, buyers vs sellers,
          a real sell test, RugCheck red flags, holder spread, mint/freeze revoked, and at least 1.5 : 1 reward vs risk.
        </p>
        <div className="views sig-tabs">
          <button className={kind === "scalp" ? "on" : ""} onClick={() => setKind("scalp")}>Scalp · hours</button>
          <button className={kind === "hold" ? "on" : ""} onClick={() => setKind("hold")}>Hold · up to 30 days</button>
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}
      {!d && !err && <div className="m-loading"><span className="spinner" /> Loading ORBIT picks…</div>}

      {rec && (
        <div className="sig-record">
          <div><span>Track record</span><b>{closed.length ? `${wins}/${closed.length} hit target` : "No closed picks yet"}</b></div>
          <div><span>Average result</span><b className={avg >= 0 ? "up" : "down"}>{closed.length ? pc(avg) : "—"}</b></div>
          <div><span>Open now</span><b>{rec.open}</b></div>
        </div>
      )}

      {st && (
        <p className="muted small sig-meta">
          Updated {ago(st.at)} · {st.scanned} coins scanned · {st.passed} passed every check
        </p>
      )}
      {st && st.picks.length === 0 && (
        <div className="card sig-empty">
          <b>Nothing passed every check right now.</b>
          <span className="muted small">That is the filter working: ORBIT would rather list nothing than a weak coin. The list refreshes every {kind === "scalp" ? "5 minutes" : "6 hours"}.</span>
        </div>
      )}

      {st?.picks.map((p) => <PickCard key={p.ca} p={p} onOpen={onOpen} />)}

      {closed.length > 0 && (
        <div className="card sig-closed">
          <span className="label">Recently closed</span>
          {closed.slice(0, 8).map((c) => (
            <div key={c.ca + c.closedAt} className="sig-crow">
              <b>${c.symbol}</b>
              <span className={`sig-res ${c.result}`}>{c.result === "target" ? "Target hit" : c.result === "stop" ? "Stopped" : "Expired"}</span>
              <span className={c.pct >= 0 ? "up" : "down"}>{pc(c.pct)}</span>
              <span className="muted small">{ago(c.closedAt)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="muted small sig-disc">
        Filtered candidates, not guaranteed profit or financial advice. Memecoins can drop fast: size small, respect the stop, take profit at the target.
      </p>
    </section>
  );
}

function PickCard({ p, onOpen }: { p: Pick; onOpen: (ca: string) => void }) {
  const since = (p.price / p.pickedPrice - 1) * 100;
  return (
    <div className={`card sig-card ${p.kind}`}>
      <div className="sig-head" onClick={() => onOpen(p.ca)}>
        <span className="wl-coin">
          {p.image ? <img src={p.image} alt="" /> : <i />}
          <b>${p.symbol}</b>
        </span>
        <span className="sig-score">
          <b>{p.score}</b>
          <small>ORBIT score</small>
        </span>
      </div>
      <div className="sig-plan">
        <div><span>Entry zone</span><b>{px(p.entry[0])} – {px(p.entry[1])}</b></div>
        <div><span>Target</span><b className="up">{px(p.target)} <small>{pc((p.target / p.price - 1) * 100)}</small></b></div>
        <div><span>Stop</span><b className="down">{px(p.stop)} <small>{pc((p.stop / p.price - 1) * 100)}</small></b></div>
        <div><span>Reward : risk</span><b>{p.rr.toFixed(1)} : 1</b></div>
      </div>
      <div className="sig-facts small muted">
        <span>{p.bias}</span>
        <span>Liq {usd(p.liq)}</span>
        <span>MC {usd(p.mc)}</span>
        <span>{p.ageDays < 1 ? `${Math.round(p.ageDays * 24)}h old` : `${Math.round(p.ageDays)}d old`}</span>
        <span>{p.horizon}</span>
        <span>Picked {ago(p.pickedAt)} · <b className={since >= 0 ? "up" : "down"}>{pc(since)}</b> since</span>
      </div>
      <div className="sig-checks">
        {p.checks.map((c) => (
          <span key={c.k} className={c.ok ? "ok" : "bad"} title={c.v}>
            <i aria-hidden="true">{c.ok ? "✓" : "✕"}</i>
            {c.k}
            <em>{c.v}</em>
          </span>
        ))}
      </div>
      <button className="ghost wide" onClick={() => onOpen(p.ca)}>Open full ORBIT report</button>
    </div>
  );
}
