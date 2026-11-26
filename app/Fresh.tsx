"use client";

import { useEffect, useState } from "react";

// Pro: brand-new Solana pairs (5–60 min old) with a quick risk read: RugCheck score, liquidity, early buyer/seller flow.
type Pool = {
  pool: string;
  ca: string;
  symbol: string;
  image?: string;
  ageMin: number;
  liq: number;
  fdv: number;
  buys: number;
  sells: number;
  buyers: number;
  ch: number;
  risk?: number | null; // RugCheck normalised score, higher = riskier
  flags?: string[];
};

const usd = (n: number) => "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadPools(): Promise<Pool[]> {
  const out: Pool[] = [];
  for (const page of [1, 2, 3]) {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=${page}&include=base_token`);
    if (!r.ok) break;
    const j = await r.json();
    const toks = new Map<string, { address: string; symbol: string; image_url?: string }>((j.included ?? []).map((t: { id: string; attributes: { address: string; symbol: string; image_url?: string } }) => [t.id, t.attributes]));
    for (const p of j.data ?? []) {
      const a = p.attributes;
      const t = toks.get(p.relationships?.base_token?.data?.id);
      if (!t) continue;
      const ageMin = (Date.now() - Date.parse(a.pool_created_at)) / 60000;
      const tx = a.transactions?.h1 ?? {};
      out.push({
        pool: a.address,
        ca: t.address,
        symbol: t.symbol,
        image: t.image_url && t.image_url !== "missing.png" ? t.image_url : undefined,
        ageMin,
        liq: Number(a.reserve_in_usd) || 0,
        fdv: Number(a.fdv_usd) || 0,
        buys: tx.buys ?? 0,
        sells: tx.sells ?? 0,
        buyers: tx.buyers ?? 0,
        ch: Number(a.price_change_percentage?.h1) || 0,
      });
    }
    await wait(400);
  }
  return out.filter((p) => p.ageMin >= 5 && p.ageMin <= 60 && p.liq >= 3000).sort((a, b) => a.ageMin - b.ageMin);
}

export default function Fresh({ onOpen }: { onOpen: (ca: string) => void }) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    setErr(null);
    loadPools()
      .then(async (list) => {
        if (dead) return;
        setPools(list);
        // risk scores one by one (RugCheck is rate-limited)
        for (const p of list.slice(0, 25)) {
          try {
            const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${p.ca}/report/summary`);
            const j = r.ok ? await r.json() : null;
            const flags = (j?.risks ?? []).filter((x: { level: string }) => x.level === "danger").map((x: { name: string }) => x.name);
            if (dead) return;
            setPools((cur) => cur?.map((x) => (x.ca === p.ca ? { ...x, risk: j?.score_normalised ?? null, flags } : x)) ?? cur);
          } catch {}
          await wait(350);
        }
      })
      .catch((e) => !dead && setErr(e.message));
    const iv = setTimeout(() => setTick((t) => t + 1), 120_000);
    return () => {
      dead = true;
      clearTimeout(iv);
    };
  }, [tick]);

  return (
    <div className="card fresh">
      <div className="section-head">
        <h3>Fresh pairs · 5–60 min old</h3>
        <button className="ghost small" onClick={() => setTick((t) => t + 1)}>Refresh</button>
      </div>
      <p className="muted small">New Solana pools with at least $3k liquidity. Risk = RugCheck score (higher = riskier) plus the first hour of buyers and sellers. Most new pairs fail — use the full scan before anything else.</p>
      {err && <div className="alert danger">{err}</div>}
      {!pools && !err && <p className="muted">Loading new pairs…</p>}
      {pools && pools.length === 0 && <p className="muted">No pairs between 5 and 60 minutes old with $3k+ liquidity right now.</p>}
      {pools && pools.length > 0 && (
        <div className="fr-table">
          <div className="fr-head small muted"><span>Pair</span><span>Age</span><span>Liq</span><span>1h B/S</span><span>1h</span><span>Risk</span></div>
          {pools.map((p) => {
            const tone = p.risk == null ? "" : p.risk >= 60 ? "down" : p.risk >= 30 ? "warn" : "up";
            return (
              <div key={p.pool} className="fr-row" onClick={() => onOpen(p.ca)}>
                <span className="wl-coin">
                  {p.image ? <img src={p.image} alt="" /> : <i />}
                  <b>${p.symbol}</b>
                </span>
                <span className="mono">{Math.round(p.ageMin)}m</span>
                <span className="mono">{usd(p.liq)}</span>
                <span className="mono">
                  <span className="up">{p.buys}</span>/<span className="down">{p.sells}</span>
                </span>
                <span className={`mono ${p.ch >= 0 ? "up" : "down"}`}>{`${p.ch > 0 ? "+" : ""}${p.ch.toFixed(0)}%`}</span>
                <span className={`fr-risk ${tone}`} title={p.flags?.join(" · ")}>
                  {p.risk === undefined ? "…" : p.risk == null ? "—" : p.risk}
                  {p.flags && p.flags.length > 0 && <em>{p.flags.length} red</em>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
