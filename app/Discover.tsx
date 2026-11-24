"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCandles, volumeZone, type VolumeZone } from "@/lib/analysis";
import type { Candidate, DiscoverResult } from "@/lib/discover";
import { CopyButton } from "./Copy";
import { fmtPrice } from "./Chart";
import { DEFAULTS, age, reasons, type Filters } from "@/lib/filters";
import { api, isActive, onKeyChange } from "./key";
import { PRICE_LABEL } from "./price";

const KEY = "orbit.filters.v1";
const REFRESH_MS = 60_000;
const ZKEY = "orbit.zones.v1";
const ZONE_TTL = 10 * 60_000;

const usd = (n: number | null) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

type Row = Candidate & { free?: string };
type Data = DiscoverResult & { candidates: Row[]; locked: { hidden: number; total: number } | null };

export default function Discover({ onOpen, onSubscribe }: { onOpen: (ca: string, free?: string) => void; onSubscribe: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [view, setView] = useState<"pass" | "zone" | "all">("pass");
  const [zones, setZones] = useState<Record<string, VolumeZone | null>>({});
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const [zoneBusy, setZoneBusy] = useState<{ done: number; total: number } | null>(null);
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
      // CDN Vercel simpan versi percuma — pelanggan guna URL berasingan yang tak disimpan
      const res = await api(isActive() ? "/api/discover?pro=1" : "/api/discover");
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
    const off = onKeyChange(load);
    return () => {
      clearInterval(t);
      off();
    };
  }, [load]);

  // Kira zon volume dalam browser: GeckoTerminal sekat IP Vercel, tapi benarkan browser (~30/minit setiap pengguna).
  // Hasil disimpan dalam browser 10 minit.
  useEffect(() => {
    if (!data) return;
    let dead = false;
    let saved: Record<string, { at: number; v: VolumeZone | null }> = {};
    try {
      saved = JSON.parse(localStorage.getItem(ZKEY) ?? "{}");
    } catch {}
    const fresh: Record<string, VolumeZone | null> = {};
    for (const [ca, e] of Object.entries(saved)) if (Date.now() - e.at < ZONE_TTL) fresh[ca] = e.v;
    if (Object.keys(fresh).length) setZones((z) => ({ ...fresh, ...z }));

    const todo = data.candidates
      .filter((c) => c.holders && !(c.ca in zonesRef.current) && !(c.ca in fresh))
      .slice(0, 30);
    if (todo.length === 0) return;
    (async () => {
      let gap = 2500;
      setZoneBusy({ done: 0, total: todo.length });
      for (let i = 0; i < todo.length && !dead; i++) {
        const c = todo[i];
        for (let attempt = 0; attempt < 2 && !dead; attempt++) {
          try {
            const v = volumeZone(await fetchCandles(c.pairAddress, c.ca, "minute", 15, 192));
            setZones((z) => ({ ...z, [c.ca]: v }));
            try {
              const all = JSON.parse(localStorage.getItem(ZKEY) ?? "{}");
              all[c.ca] = { at: Date.now(), v };
              localStorage.setItem(ZKEY, JSON.stringify(all));
            } catch {}
            break;
          } catch (e) {
            // 429 dari GeckoTerminal datang tanpa header CORS, jadi browser nampak "network error" — anggap had kadar
            const st = (e as { status?: number }).status;
            if (st && st !== 429) break;
            gap = Math.min(gap * 1.5, 8000);
            await new Promise((res) => setTimeout(res, 15000));
          }
        }
        if (!dead) setZoneBusy({ done: i + 1, total: todo.length });
        await new Promise((res) => setTimeout(res, gap));
      }
      if (!dead) setZoneBusy(null);
    })();
    return () => {
      dead = true;
    };
  }, [data]);

  const rows = useMemo(
    () => (data?.candidates ?? []).map((c) => ({ c: { ...c, zone: zones[c.ca] }, why: reasons(c, f) })),
    [data, f, zones],
  );
  const passed = rows.filter((r) => r.why.length === 0);
  const nearZone = passed
    .filter((r) => r.c.zone?.near)
    .sort((a, b) => Math.abs(a.c.zone!.distPct) - Math.abs(b.c.zone!.distPct));
  const shown = view === "pass" ? passed : view === "zone" ? nearZone : rows;

  return (
    <section>
      <div className="card discover-head">
        <div>
          <strong>
            {data ? `${passed.length + (data.locked?.hidden ?? 0)} coins passed` : "Finding coins…"}
          </strong>
          <span className="muted small">
            {data
              ? ` of ${data.locked?.total ?? data.candidates.length} Solana coins from DexScreener · updated ${new Date(data.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        </div>
        <div className="row-btns">
          <button className="ghost" onClick={() => setShowFilters((v) => !v)}>
            Filters {showFilters ? "▴" : "▾"}
          </button>
          <button className="ghost" onClick={load} disabled={loading}>
            {loading ? "…" : "↻"}
          </button>
        </div>

        {showFilters && !data?.locked && (
          <div className="filters">
            <Num label="Liquidity min ($)" v={f.minLiq} on={(v) => update({ minLiq: v })} />
            <Num label="Market cap min ($)" v={f.minMc} on={(v) => update({ minMc: v })} />
            <Num label="Volume 24h min ($)" v={f.minVol} on={(v) => update({ minVol: v })} />
            <Num label="Min age (hours)" v={f.minAgeH} on={(v) => update({ minAgeH: v })} />
            <Num label="Top 10 max (%)" v={f.maxTop10} on={(v) => update({ maxTop10: v })} />
            <Num label="Largest wallet max (%)" v={f.maxTop1} on={(v) => update({ maxTop1: v })} />
            <label className="check">
              <input type="checkbox" checked={f.needRevoked} onChange={(e) => update({ needRevoked: e.target.checked })} />
              Mint & freeze must be revoked
            </label>
            <button className="ghost small" onClick={() => update(DEFAULTS)}>
              Reset
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert danger">{error}</div>}

      {data && (
        <div className="views">
          <button className={view === "pass" ? "on" : ""} onClick={() => setView("pass")}>
            ✓ Passed ({passed.length})
          </button>
          <button className={view === "zone" ? "on" : ""} onClick={() => setView("zone")}>
            Near volume zone ({nearZone.length})
          </button>
          <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
            All ({rows.length})
          </button>
        </div>
      )}
      {view === "zone" && zoneBusy && (
        <p className="small zone-note" style={{ color: "#ffb84d" }}>
          Calculating volume zones… {zoneBusy.done}/{zoneBusy.total} coins (the list fills in automatically)
        </p>
      )}
      {view === "zone" && (
        <p className="muted small zone-note">
          Coins that pass the filters <b>and</b> whose current price is inside (or within ±5% of) the price range with the most
          volume over the last 2 days — where most buyers and sellers traded. Closest first.
        </p>
      )}

      <div className="list">
        {shown.map(({ c, why }) => (
          <div
            key={c.ca}
            role="button"
            tabIndex={0}
            className={`coin ${why.length ? "fail" : "pass"}`}
            onClick={() => onOpen(c.ca, (c as Row).free)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(c.ca, (c as Row).free)}
          >
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
              <span><i>Age</i>{age(c.ageHours)}</span>
              <span>
                <i>Top10</i>
                {c.holders ? `${c.holders.top10Pct.toFixed(1)}%` : "—"}
              </span>
              <span className={c.change24h == null ? "" : c.change24h >= 0 ? "up" : "down"}>
                <i>24h</i>
                {c.change24h == null ? "—" : `${c.change24h > 0 ? "+" : ""}${c.change24h.toFixed(0)}%`}
              </span>
            </div>
            {c.narratives.length > 0 && (
              <div className="tags">
                {c.narratives.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            )}
            {c.zone && <ZoneLine z={c.zone} />}
            {why.length > 0 && <div className="why">{why.join(" · ")}</div>}
            <div className="tags">
              {c.tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              <span className="tag">{c.dexId}</span>
            </div>
            <div className="coin-actions">
              <CopyButton text={c.ca} />
              <span className="card-links">
                {c.links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={l.type}>
                    {l.type === "twitter" ? "X" : l.type === "telegram" ? "TG" : "WEB"}
                  </a>
                ))}
              </span>
              <span className="muted small">Chart →</span>
            </div>
          </div>
        ))}
        {data?.locked && (
          <div className="locked">
            <div className="locked-ghosts" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="coin ghost-card">
                  <div className="coin-top"><div className="noimg" /><div className="coin-name"><b>████</b><span>██████</span></div></div>
                  <div className="coin-stats"><span>████</span><span>████</span><span>████</span></div>
                </div>
              ))}
            </div>
            <div className="locked-cta">
              <b>{data.locked.hidden} more coins passed the filters</b>
              <span className="muted small">
                The free version shows the top 3 coins. Subscribe for the full list, Near volume zone, custom filters and scanning any CA.
              </span>
              <button className="copy primary" onClick={onSubscribe}>Subscribe — {PRICE_LABEL}</button>
            </div>
          </div>
        )}
        {data && shown.length === 0 && !data.locked && (
          <div className="card muted">
            No coins pass the filters right now. Loosen the filters or wait for the next refresh (every minute).
          </div>
        )}
      </div>


    </section>
  );
}

function ZoneLine({ z }: { z: NonNullable<Candidate["zone"]> }) {
  const where =
    z.distPct === 0 ? "Price inside volume zone" : z.distPct > 0 ? `${z.distPct.toFixed(1)}% above volume zone` : `${Math.abs(z.distPct).toFixed(1)}% below volume zone`;
  return (
    <div className={`zoneline ${z.near ? "near" : ""}`}>
      {z.near ? "● " : ""}
      {where} <span className="muted">· ${fmtPrice(z.from)}–${fmtPrice(z.to)} ({z.share.toFixed(0)}% vol)</span>
    </div>
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
