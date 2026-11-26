"use client";

import { useEffect, useState } from "react";
import { api } from "./key";
import type { Bundle, Flow } from "@/lib/insiders";

// Ultra: holder flow (who added / cut in the last hour and day) + launch bundle check.
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pp = (d: number | null) => (d == null ? "—" : Math.abs(d) < 0.005 ? "0" : `${d > 0 ? "+" : ""}${d.toFixed(2)}`);
const ago = (t: number | null) => (t == null ? "" : `${Math.round((Date.now() - t) / 60000) >= 90 ? `${Math.round((Date.now() - t) / 3_600_000)}h` : `${Math.round((Date.now() - t) / 60000)}m`} ago`);

export default function Insiders({ ca, onTrace }: { ca: string; onTrace: (w: string) => void }) {
  const [d, setD] = useState<{ flow: Flow; bundle: Bundle } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api(`/api/insiders?ca=${ca}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (!dead) setD(j);
      })
      .catch((e) => !dead && setErr(e.message));
    return () => {
      dead = true;
    };
  }, [ca]);

  const f = d?.flow;
  const net1h = f?.rows.reduce((s, r) => s + (r.d1h ?? 0), 0) ?? 0;
  return (
    <section className="card insiders">
      <div className="section-head">
        <h3>Holder flow & bundles</h3>
        <span className="tier-tag ultra">Ultra</span>
      </div>
      {err && <div className="alert danger">{err}</div>}
      {!d && !err && <p className="muted">Reading top holders and the first blocks after launch…</p>}
      {d && (
        <>
          <div className="rc-grid">
            <div className="rc-cell">
              <span className="label">Bundled at launch</span>
              {d.bundle.ok ? (
                <>
                  <b className={d.bundle.bundledPct > 10 ? "down" : d.bundle.bundledPct > 3 ? "warn" : "up"}>{d.bundle.bundledPct.toFixed(1)}% of supply</b>
                  <span className="muted small">
                    {d.bundle.bundled.length} of today&apos;s top holders bought in the first 3 blocks ({d.bundle.earlyBuyers} early buyers in total).
                  </span>
                </>
              ) : (
                <span className="muted small">{d.bundle.reason}</span>
              )}
            </div>
            <div className="rc-cell">
              <span className="label">Top-20 change · 1 h</span>
              {f?.since1h ? (
                <>
                  <b className={net1h > 0.5 ? "up" : net1h < -0.5 ? "down" : ""}>{pp(net1h)} pts</b>
                  <span className="muted small">vs snapshot {ago(f.since1h)} · {f.rows.filter((r) => r.isNew1h).length} new · {f.exited1h.length} left the top 20</span>
                </>
              ) : (
                <span className="muted small">First snapshot taken now — come back in an hour for the change.</span>
              )}
            </div>
          </div>
          <div className="if-table">
            <div className="if-head small muted"><span>#</span><span>Holder</span><span>% now</span><span>1h</span><span>24h</span></div>
            {f!.rows.slice(0, 20).map((r, i) => {
              const bundled = d.bundle.ok && d.bundle.bundled.some((b) => b.owner === r.owner);
              return (
                <div key={r.owner} className="if-row">
                  <span className="muted">{i + 1}</span>
                  <button className="mono small dev-addr" onClick={() => onTrace(r.owner)}>
                    {short(r.owner)}
                    {bundled && <em className="if-flag">bundle</em>}
                    {r.isNew1h && <em className="if-flag new">new</em>}
                  </button>
                  <span className="mono">{r.pct.toFixed(2)}%</span>
                  <span className={`mono ${(r.d1h ?? 0) > 0 ? "up" : (r.d1h ?? 0) < 0 ? "down" : ""}`}>{pp(r.d1h)}</span>
                  <span className={`mono ${(r.d24h ?? 0) > 0 ? "up" : (r.d24h ?? 0) < 0 ? "down" : ""}`}>{pp(r.d24h)}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small">Changes in percentage points of supply. Snapshots are saved every 15 minutes while ORBIT users look at this coin.</p>
        </>
      )}
    </section>
  );
}
