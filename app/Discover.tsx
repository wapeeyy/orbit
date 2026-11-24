"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Candidate, DiscoverResult } from "@/lib/discover";

type Filters = {
  minLiq: number;
  minMc: number;
  minVol: number;
  minAgeH: number;
  maxTop10: number;
  maxTop1: number;
  needRevoked: boolean;
};

const DEFAULTS: Filters = {
  minLiq: 10_000,
  minMc: 20_000,
  minVol: 10_000,
  minAgeH: 1,
  maxTop10: 30,
  maxTop1: 5,
  needRevoked: true,
};
const KEY = "orbit.filters.v1";
const REFRESH_MS = 60_000;

const usd = (n: number | null) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const age = (h: number | null) =>
  h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}j` : `${Math.round(h / 24)}h`;

function reasons(c: Candidate, f: Filters): string[] {
  const r: string[] = [];
  if (c.liquidityUsd < f.minLiq) r.push(`Liquidity ${usd(c.liquidityUsd)}`);
  if ((c.marketCap ?? 0) < f.minMc) r.push(`MC ${usd(c.marketCap)}`);
  if (c.volume24h < f.minVol) r.push(`Volume ${usd(c.volume24h)}`);
  if (c.ageHours != null && c.ageHours < f.minAgeH) r.push(`Baru ${age(c.ageHours)}`);
  if (!c.holders) {
    r.push(c.holdersError ? "Holder gagal disemak" : "Holder tak disemak");
    return r;
  }
  if (c.holders.top10Pct > f.maxTop10) r.push(`Top 10 ${c.holders.top10Pct.toFixed(1)}%`);
  if (c.holders.top1Pct > f.maxTop1) r.push(`Whale ${c.holders.top1Pct.toFixed(1)}%`);
  if (f.needRevoked && !c.holders.mintRevoked) r.push("Mint aktif");
  if (f.needRevoked && !c.holders.freezeRevoked) r.push("Freeze aktif");
  return r;
}

export default function Discover({ onOpen }: { onOpen: (ca: string) => void }) {
  const [data, setData] = useState<DiscoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [showAll, setShowAll] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setF({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {}
  }, []);
  const update = (patch: Partial<Filters>) =>
    setF((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discover");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(
    () => (data?.candidates ?? []).map((c) => ({ c, why: reasons(c, f) })),
    [data, f],
  );
  const passed = rows.filter((r) => r.why.length === 0);
  const shown = showAll ? rows : passed;

  return (
    <section>
      <div className="card discover-head">
        <div>
          <strong>
            {data ? `${passed.length} coin lulus` : "Mencari coin…"}
          </strong>
          <span className="muted small">
            {data
              ? ` daripada ${data.candidates.length} coin Solana dari DexScreener · dikemas kini ${new Date(data.updatedAt).toLocaleTimeString("ms-MY", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        </div>
        <div className="row-btns">
          <button className="ghost" onClick={() => setShowFilters((v) => !v)}>
            Penapis {showFilters ? "▴" : "▾"}
          </button>
          <button className="ghost" onClick={load} disabled={loading}>
            {loading ? "…" : "↻"}
          </button>
        </div>

        {showFilters && (
          <div className="filters">
            <Num label="Liquidity min ($)" v={f.minLiq} on={(v) => update({ minLiq: v })} />
            <Num label="Market cap min ($)" v={f.minMc} on={(v) => update({ minMc: v })} />
            <Num label="Volume 24j min ($)" v={f.minVol} on={(v) => update({ minVol: v })} />
            <Num label="Umur min (jam)" v={f.minAgeH} on={(v) => update({ minAgeH: v })} />
            <Num label="Top 10 maks (%)" v={f.maxTop10} on={(v) => update({ maxTop10: v })} />
            <Num label="Wallet terbesar maks (%)" v={f.maxTop1} on={(v) => update({ maxTop1: v })} />
            <label className="check">
              <input type="checkbox" checked={f.needRevoked} onChange={(e) => update({ needRevoked: e.target.checked })} />
              Mint & freeze mesti revoked
            </label>
            <button className="ghost small" onClick={() => update(DEFAULTS)}>
              Set semula
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert danger">{error}</div>}

      <div className="list">
        {shown.map(({ c, why }) => (
          <button key={c.ca} className={`coin ${why.length ? "fail" : "pass"}`} onClick={() => onOpen(c.ca)}>
            <div className="coin-top">
              {c.image ? <img src={c.image} alt="" /> : <div className="noimg">{c.symbol.slice(0, 2)}</div>}
              <div className="coin-name">
                <b>{c.symbol}</b>
                <span className="muted small">{c.name}</span>
              </div>
              <span className={`verdict ${why.length ? "bad" : "ok"}`}>{why.length ? "✕" : "✓ Okey"}</span>
            </div>
            <div className="coin-stats">
              <span><i>MC</i>{usd(c.marketCap)}</span>
              <span><i>Liq</i>{usd(c.liquidityUsd)}</span>
              <span><i>Vol</i>{usd(c.volume24h)}</span>
              <span><i>Umur</i>{age(c.ageHours)}</span>
              <span>
                <i>Top10</i>
                {c.holders ? `${c.holders.top10Pct.toFixed(1)}%` : "—"}
              </span>
              <span className={c.change24h == null ? "" : c.change24h >= 0 ? "up" : "down"}>
                <i>24j</i>
                {c.change24h == null ? "—" : `${c.change24h > 0 ? "+" : ""}${c.change24h.toFixed(0)}%`}
              </span>
            </div>
            {why.length > 0 && <div className="why">{why.join(" · ")}</div>}
            <div className="tags">
              {c.tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              <span className="tag">{c.dexId}</span>
            </div>
          </button>
        ))}
        {data && shown.length === 0 && (
          <div className="card muted">
            Tiada coin lulus penapis sekarang. Longgarkan penapis atau tunggu refresh seterusnya (setiap minit).
          </div>
        )}
      </div>

      {data && (
        <button className="ghost wide" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Tunjuk yang lulus sahaja" : `Tunjuk semua (${rows.length}) termasuk yang gagal`}
        </button>
      )}
    </section>
  );
}

function Num({ label, v, on }: { label: string; v: number; on: (v: number) => void }) {
  return (
    <label className="num">
      <span>{label}</span>
      <input type="number" inputMode="decimal" value={v} onChange={(e) => on(Number(e.target.value) || 0)} />
    </label>
  );
}
