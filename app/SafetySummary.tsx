"use client";

import { useEffect, useState } from "react";
import { api } from "./key";
import { rugData } from "./RugCheck";
import { TrialButton } from "./Upgrade";

// Quick, scannable safety answers at the top of every coin page. Pro answers are locked for free users.
type Row = { k: string; v: string; tone: "ok" | "warn" | "bad" | "wait" | "lock"; note?: string };

const usd = (n: number) => "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export default function SafetySummary({
  ca,
  pro,
  top10Pct,
  dev,
  onTrial,
}: {
  ca: string;
  pro: boolean;
  top10Pct: number | null;
  dev: string | null;
  onTrial: () => void;
}) {
  const [sell, setSell] = useState<Row | null>(null);
  const [lp, setLp] = useState<Row | null>(null);
  const [devRow, setDevRow] = useState<Row | null>(null);

  useEffect(() => {
    if (!pro) return;
    let dead = false;
    rugData(ca).then(({ trip, sum }) => {
      if (dead) return;
      setSell(
        !trip.ok
          ? { k: "Can you sell?", v: "No", tone: "bad", note: "No sell route found" }
          : { k: "Can you sell?", v: "Yes", tone: trip.lossPct > 15 ? "warn" : "ok", note: `${trip.lossPct.toFixed(1)}% lost on a test round-trip` },
      );
      const p = sum?.lpLockedPct;
      setLp(p == null ? { k: "LP locked?", v: "Unknown", tone: "warn" } : { k: "LP locked?", v: p >= 90 ? "Yes" : p >= 50 ? "Partly" : "No", tone: p >= 90 ? "ok" : p >= 50 ? "warn" : "bad", note: `${p.toFixed(0)}% locked or burned` });
    });
    if (dev)
      api(`/api/swaps?address=${dev}&mint=${ca}`)
        .then((r) => r.json())
        .then((j: { swaps?: { side: string; usd: number; ts: number }[]; error?: string }) => {
          if (dead) return;
          if (!j.swaps) return setDevRow({ k: "Dev wallet", v: "Unknown", tone: "warn", note: "Couldn't read the dev's trades" });
          const day = Date.now() - 86_400_000;
          const sold = (j.swaps ?? []).filter((s) => s.side === "SELL" && s.ts > day).reduce((t, s) => t + s.usd, 0);
          setDevRow(sold > 0 ? { k: "Dev wallet", v: "Selling", tone: "bad", note: `Sold ${usd(sold)} in 24h` } : { k: "Dev wallet", v: "Quiet", tone: "ok", note: "No dev sells in 24h" });
        })
        .catch(() => !dead && setDevRow({ k: "Dev wallet", v: "Unknown", tone: "warn" }));
    else setDevRow({ k: "Dev wallet", v: "Unknown", tone: "warn", note: "Creator wallet not found" });
    return () => {
      dead = true;
    };
  }, [ca, pro, dev]);

  const lock = (k: string): Row => ({ k, v: "Pro", tone: "lock" });
  const wait = (k: string): Row => ({ k, v: "Checking…", tone: "wait" });
  const rows: Row[] = [
    pro ? sell ?? wait("Can you sell?") : lock("Can you sell?"),
    pro ? lp ?? wait("LP locked?") : lock("LP locked?"),
    top10Pct == null
      ? wait("Top 10 holders")
      : top10Pct < 0
      ? { k: "Top 10 holders", v: "Unavailable", tone: "warn", note: "Holder data didn't load" }
      : { k: "Top 10 holders", v: `${top10Pct.toFixed(1)}%`, tone: top10Pct > 30 ? "bad" : top10Pct > 20 ? "warn" : "ok", note: top10Pct > 30 ? "Concentrated — over 30%" : "Spread out" },
    pro ? devRow ?? wait("Dev wallet") : lock("Dev wallet"),
  ];
  return (
    <section className="card safety">
      <span className="label">Quick safety check</span>
      <div className="safety-grid">
        {rows.map((r) => (
          <div key={r.k} className={`safety-cell ${r.tone}`}>
            <span className="k">{r.k}</span>
            <b>{r.v}</b>
            {r.note && <span className="n">{r.note}</span>}
          </div>
        ))}
      </div>
      {!pro && (
        <div className="safety-cta">
          <span className="muted small">See if you can sell, whether liquidity is locked and what the dev is doing.</span>
          <TrialButton onClick={onTrial} size="sm" long={false} />
        </div>
      )}
    </section>
  );
}
