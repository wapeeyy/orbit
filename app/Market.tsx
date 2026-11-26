"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// DexScreener-style list of Solana pairs, loaded straight from GeckoTerminal in the browser
// (GeckoTerminal blocks Vercel's shared IPs; each visitor gets their own ~30 requests/minute).

type Win = "m5" | "h1" | "h6" | "h24";
type Row = {
  pool: string;
  ca: string;
  symbol: string;
  name: string;
  pair: string;
  image: string | null;
  dex: string;
  dexName: string;
  created: number;
  price: number;
  mc: number | null;
  liq: number;
  vol: Record<Win, number>;
  chg: Record<Win, number>;
  tx: Record<Win, { buys: number; sells: number }>;
};

const LISTS = {
  trending: { label: "Trending", path: "trending_pools" },
  new: { label: "New pairs", path: "new_pools" },
  volume: { label: "Top volume", path: "pools?sort=h24_volume_usd_desc" },
  txns: { label: "Most txns", path: "pools?sort=h24_tx_count_desc" },
} as const;
type ListId = keyof typeof LISTS;

const SORTS = {
  default: "Rank",
  age: "Pair age",
  mc: "Market cap",
  liq: "Liquidity",
  vol: "Volume 24h",
  tx: "Txns 24h",
  m5: "Change 5m",
  h1: "Change 1h",
  h6: "Change 6h",
  h24: "Change 24h",
} as const;
type SortId = keyof typeof SORTS;

const DEXES: { id: string; label: string }[] = [
  { id: "pump-fun", label: "Pump.fun" },
  { id: "pumpswap", label: "PumpSwap" },
  { id: "raydium", label: "Raydium" },
  { id: "meteora", label: "Meteora" },
  { id: "orca", label: "Orca" },
  { id: "other", label: "Other" },
];
const dexGroup = (id: string) => (id.startsWith("raydium") ? "raydium" : id.startsWith("meteora") ? "meteora" : DEXES.some((d) => d.id === id) ? id : "other");

type F = Record<"minLiq" | "maxLiq" | "minMc" | "maxMc" | "minAge" | "maxAge" | "minTx" | "minVol" | "minChg" | "maxChg" | "minChg1h", string> & {
  dexes: string[];
  quote: "all" | "SOL" | "USDC";
};
const EMPTY: F = { minLiq: "", maxLiq: "", minMc: "", maxMc: "", minAge: "", maxAge: "", minTx: "", minVol: "", minChg: "", maxChg: "", minChg1h: "", dexes: [], quote: "all" };
const FKEY = "orbit.market.filters.v1";
const MAX_PAGES = 10;

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const usd = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: n < 1000 ? 0 : 1 }).format(n);
const price = (p: number) => {
  if (!p) return "—";
  if (p >= 1) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const z = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  return "$" + p.toFixed(Math.min(z + 4, 14));
};
const pct = (n: number) => (isFinite(n) ? `${n > 0 ? "+" : ""}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%` : "—");
const age = (ms: number) => {
  const m = (Date.now() - ms) / 60_000;
  if (m < 60) return `${Math.max(0, Math.floor(m))}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 1440 * 60) return `${Math.floor(m / 1440)}d`;
  if (m < 1440 * 730) return `${Math.floor(m / 43200)}mo`;
  return `${Math.floor(m / 525600)}y`;
};
const isCa = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());

type Gt = {
  data: {
    attributes: Record<string, unknown> & {
      address: string;
      name: string;
      pool_created_at: string;
      base_token_price_usd: string;
      fdv_usd: string | null;
      market_cap_usd: string | null;
      reserve_in_usd: string;
      price_change_percentage: Record<string, string>;
      volume_usd: Record<string, string>;
      transactions: Record<string, { buys: number; sells: number }>;
    };
    relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
  }[];
  included?: { id: string; type: string; attributes: { name: string; symbol?: string; image_url?: string | null; address?: string } }[];
};

/** GeckoTerminal straight from the browser; if it is busy or blocked, ORBIT's shared 45-second cache */
async function fetchGt(list: ListId, page: number): Promise<Gt> {
  const path = LISTS[list].path;
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/${path}${path.includes("?") ? "&" : "?"}page=${page}&include=base_token,dex`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()) as Gt;
  } catch {
    // 429s arrive without CORS headers and look like network errors
  }
  const res = await fetch(`/api/pairs?list=${list}&page=${page}`);
  if (res.status === 429) throw Object.assign(new Error("rate"), { rate: true });
  if (!res.ok) throw new Error("unavailable");
  return (await res.json()) as Gt;
}

async function fetchPage(list: ListId, page: number): Promise<Row[]> {
  const j = await fetchGt(list, page);
  const inc = new Map((j.included ?? []).map((x) => [x.id, x]));
  const n = (s: string | null | undefined) => (s == null ? 0 : Number(s));
  return j.data.map((d) => {
    const a = d.attributes;
    const tok = inc.get(d.relationships.base_token.data.id);
    const dexId = d.relationships.dex.data.id;
    const win = (o: Record<string, string>) => ({ m5: n(o.m5), h1: n(o.h1), h6: n(o.h6), h24: n(o.h24) });
    const t = a.transactions;
    const tx = (k: string) => ({ buys: t[k]?.buys ?? 0, sells: t[k]?.sells ?? 0 });
    return {
      pool: a.address,
      ca: tok?.attributes.address ?? d.relationships.base_token.data.id.replace(/^solana_/, ""),
      symbol: tok?.attributes.symbol ?? a.name.split(" / ")[0],
      name: tok?.attributes.name ?? "",
      pair: a.name,
      image: tok?.attributes.image_url && !tok.attributes.image_url.includes("missing") ? tok.attributes.image_url : null,
      dex: dexId,
      dexName: inc.get(dexId)?.attributes.name ?? dexId,
      created: Date.parse(a.pool_created_at),
      price: n(a.base_token_price_usd),
      mc: a.market_cap_usd ? n(a.market_cap_usd) : a.fdv_usd ? n(a.fdv_usd) : null,
      liq: n(a.reserve_in_usd),
      vol: win(a.volume_usd),
      chg: win(a.price_change_percentage),
      tx: { m5: tx("m5"), h1: tx("h1"), h6: tx("h6"), h24: tx("h24") },
    };
  });
}

export default function Market({ onOpen, cta }: { onOpen: (ca: string) => void; cta?: React.ReactNode }) {
  const [list, setList] = useState<ListId>("trending");
  const [rows, setRows] = useState<Row[]>([]);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [updated, setUpdated] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [f, setF] = useState<F>(EMPTY);
  const [showF, setShowF] = useState(false);
  const [sort, setSort] = useState<SortId>("default");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    try {
      const s = localStorage.getItem(FKEY);
      if (s) setF({ ...EMPTY, ...JSON.parse(s) });
    } catch {}
  }, []);
  const upd = (patch: Partial<F>) =>
    setF((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(FKEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const get = useCallback(async (l: ListId, page: number) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchPage(l, page);
      } catch (e) {
        if (!(e as { rate?: boolean }).rate || attempt) throw e;
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
    return [];
  }, []);

  // Load the first 3 pages (60 pairs) whenever the list changes
  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      setNote(null);
      setFailed(false);
      setRows([]);
      setPages(0);
      setFresh(new Set());
      const all: Row[] = [];
      for (let p = 1; p <= 3 && !dead; p++) {
        try {
          const r = await get(list, p);
          for (const x of r) if (!all.some((y) => y.pool === x.pool)) all.push(x);
          if (!dead) {
            setRows([...all]);
            setPages(p);
            setUpdated(Date.now());
            setNote(null);
          }
        } catch {
          if (!dead && all.length === 0) setFailed(true);
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (!dead) setLoading(false);
    })();
    return () => {
      dead = true;
    };
  }, [list, get, reload]);

  // Live refresh of page 1: every 30 s for new pairs, every 60 s otherwise
  useEffect(() => {
    const ms = list === "new" ? 30_000 : 60_000;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetchPage(listRef.current, 1);
        if (listRef.current !== list) return;
        setRows((cur) => {
          const known = new Set(cur.map((x) => x.pool));
          const added = r.filter((x) => !known.has(x.pool));
          const byPool = new Map(r.map((x) => [x.pool, x]));
          const merged = cur.map((x) => byPool.get(x.pool) ?? x);
          if (added.length) {
            setFresh(new Set(added.map((x) => x.pool)));
            setTimeout(() => setFresh(new Set()), 12_000);
          }
          return list === "new" ? [...added, ...merged] : merged;
        });
        setUpdated(Date.now());
      } catch {}
    }, ms);
    return () => clearInterval(t);
  }, [list]);

  const loadMore = async () => {
    if (loading || pages >= MAX_PAGES) return;
    setLoading(true);
    try {
      const r = await get(list, pages + 1);
      setRows((cur) => [...cur, ...r.filter((x) => !cur.some((y) => y.pool === x.pool))]);
      setPages((p) => p + 1);
      setNote(null);
    } catch (e) {
      setNote((e as Error).message === "rate" ? "Couldn't load more pairs right now. Please try again." : "Couldn't load more pairs right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const lim = {
      minLiq: num(f.minLiq), maxLiq: num(f.maxLiq), minMc: num(f.minMc), maxMc: num(f.maxMc),
      minAge: num(f.minAge), maxAge: num(f.maxAge), minTx: num(f.minTx), minVol: num(f.minVol),
      minChg: num(f.minChg), maxChg: num(f.maxChg), minChg1h: num(f.minChg1h),
    };
    let out = rows.filter((r) => {
      if (ql && !isCa(ql) && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      if (lim.minLiq != null && r.liq < lim.minLiq) return false;
      if (lim.maxLiq != null && r.liq > lim.maxLiq) return false;
      if (lim.minMc != null && (r.mc ?? 0) < lim.minMc) return false;
      if (lim.maxMc != null && (r.mc ?? 0) > lim.maxMc) return false;
      const ageH = (Date.now() - r.created) / 3_600_000;
      if (lim.minAge != null && ageH < lim.minAge) return false;
      if (lim.maxAge != null && ageH > lim.maxAge) return false;
      if (lim.minTx != null && r.tx.h24.buys + r.tx.h24.sells < lim.minTx) return false;
      if (lim.minVol != null && r.vol.h24 < lim.minVol) return false;
      if (lim.minChg != null && r.chg.h24 < lim.minChg) return false;
      if (lim.maxChg != null && r.chg.h24 > lim.maxChg) return false;
      if (lim.minChg1h != null && r.chg.h1 < lim.minChg1h) return false;
      if (f.dexes.length && !f.dexes.includes(dexGroup(r.dex))) return false;
      if (f.quote !== "all" && !r.pair.toUpperCase().endsWith(" / " + f.quote)) return false;
      return true;
    });
    if (sort !== "default") {
      const key = (r: Row): number =>
        sort === "age" ? -r.created : sort === "mc" ? r.mc ?? 0 : sort === "liq" ? r.liq : sort === "vol" ? r.vol.h24 : sort === "tx" ? r.tx.h24.buys + r.tx.h24.sells : r.chg[sort];
      out = [...out].sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
    }
    return out;
  }, [rows, f, sort, desc, q]);

  const activeFilters = Object.entries(f).filter(([k, v]) => (k === "dexes" ? (v as string[]).length : k === "quote" ? v !== "all" : v !== "")).length;
  const headSort = (s: SortId) => {
    if (sort === s) setDesc((d) => !d);
    else {
      setSort(s);
      setDesc(s !== "age");
    }
  };

  return (
    <section className="market">
      <div className="views m-lists" role="tablist" aria-label="Pair lists">
        {(Object.keys(LISTS) as ListId[]).map((id) => (
          <button key={id} role="tab" aria-selected={list === id} className={list === id ? "on" : ""} onClick={() => setList(id)}>
            {id === "new" && <span className="live-dot" aria-hidden="true" />}
            {LISTS[id].label}
          </button>
        ))}
      </div>

      <div className="m-tools">
        <div className="search m-search">
          <input id="market-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol, name or paste a CA" spellCheck={false} autoComplete="off" />
          {isCa(q) && (
            <button type="button" onClick={() => onOpen(q.trim())}>
              Scan
            </button>
          )}
        </div>
        <div className="m-bar">
          <button type="button" className={`ghost ${activeFilters ? "is-on" : ""}`} onClick={() => setShowF((v) => !v)} aria-expanded={showF}>
            Filters{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <label className="m-sort">
            <span className="sr-only">Sort by</span>
            <select id="market-sort" value={sort} onChange={(e) => headSort(e.target.value as SortId)}>
              {(Object.keys(SORTS) as SortId[]).map((s) => (
                <option key={s} value={s}>
                  {SORTS[s]}
                </option>
              ))}
            </select>
          </label>
          {sort !== "default" && (
            <button type="button" className="ghost" onClick={() => setDesc((d) => !d)} aria-label="Reverse sort">
              {desc ? "↓" : "↑"}
            </button>
          )}
        </div>
      </div>

      {showF && (
        <div className="card m-filters">
          <Range label="Liquidity ($)" a={f.minLiq} b={f.maxLiq} onA={(v) => upd({ minLiq: v })} onB={(v) => upd({ maxLiq: v })} id="liq" />
          <Range label="Market cap ($)" a={f.minMc} b={f.maxMc} onA={(v) => upd({ minMc: v })} onB={(v) => upd({ maxMc: v })} id="mc" />
          <Range label="Pair age (hours)" a={f.minAge} b={f.maxAge} onA={(v) => upd({ minAge: v })} onB={(v) => upd({ maxAge: v })} id="age" />
          <Range label="24h change (%)" a={f.minChg} b={f.maxChg} onA={(v) => upd({ minChg: v })} onB={(v) => upd({ maxChg: v })} id="chg" />
          <Single label="24h volume min ($)" v={f.minVol} on={(v) => upd({ minVol: v })} id="vol" />
          <Single label="24h txns min" v={f.minTx} on={(v) => upd({ minTx: v })} id="tx" />
          <Single label="1h change min (%)" v={f.minChg1h} on={(v) => upd({ minChg1h: v })} id="chg1h" />
          <div className="m-f-group">
            <span className="label">Quote</span>
            <div className="chips">
              {(["all", "SOL", "USDC"] as const).map((x) => (
                <button key={x} type="button" className={`ghost ${f.quote === x ? "is-on" : ""}`} onClick={() => upd({ quote: x })}>
                  {x === "all" ? "Any" : x}
                </button>
              ))}
            </div>
          </div>
          <div className="m-f-group m-f-wide">
            <span className="label">DEX</span>
            <div className="chips">
              {DEXES.map((d) => {
                const on = f.dexes.includes(d.id);
                return (
                  <button key={d.id} type="button" className={`ghost ${on ? "is-on" : ""}`} onClick={() => upd({ dexes: on ? f.dexes.filter((x) => x !== d.id) : [...f.dexes, d.id] })}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="m-f-actions">
            <button type="button" className="ghost" onClick={() => upd(EMPTY)}>
              Reset filters
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
      <div className="m-status">
        <span className="eyebrow">
          {list === "new" && <span className="live-dot" aria-hidden="true" />}
          {shown.length} of {rows.length} pairs{updated ? ` · updated ${new Date(updated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        </span>
        {note && <span className="small m-note">{note}</span>}
      </div>
      )}

      <div className="m-table" role="table" aria-label="Solana pairs">
        <div className="m-row m-head" role="row">
          <span role="columnheader">Token</span>
          <HeadCell s="default" label="Price" sort={sort} desc={desc} onSort={headSort} sortKey={null} />
          <HeadCell s="age" label="Age" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="tx" label="Txns" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="vol" label="Volume" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="m5" label="5m" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="h1" label="1h" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="h6" label="6h" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="h24" label="24h" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="liq" label="Liquidity" sort={sort} desc={desc} onSort={headSort} />
          <HeadCell s="mc" label="MCap" sort={sort} desc={desc} onSort={headSort} />
        </div>
        {shown.map((r, i) => (
          <div
            key={r.pool}
            role="row"
            tabIndex={0}
            className={`m-row ${fresh.has(r.pool) ? "is-fresh" : ""}`}
            onClick={() => onOpen(r.ca)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(r.ca)}
          >
            <span className="m-tok" role="cell">
              <i className="m-rank">{i + 1}</i>
              {r.image ? <img src={r.image} alt="" loading="lazy" /> : <span className="m-av">{r.symbol.slice(0, 2)}</span>}
              <span className="m-name">
                <b>{r.symbol}</b>
                <small>
                  {r.pair.split(" / ")[1] ?? ""} · {r.dexName}
                  {fresh.has(r.pool) && <em className="m-new">NEW</em>}
                </small>
              </span>
            </span>
            <span className="m-price" role="cell">{price(r.price)}</span>
            <span className="m-age" role="cell"><i>Age</i>{age(r.created)}</span>
            <span role="cell" className="m-tx"><i>Txns</i>{(r.tx.h24.buys + r.tx.h24.sells).toLocaleString("en-US")}</span>
            <span role="cell" className="m-vol"><i>Vol</i>{usd(r.vol.h24)}</span>
            <Chg v={r.chg.m5} w="5m" cls="m-c5" />
            <Chg v={r.chg.h1} w="1h" cls="m-c1" />
            <Chg v={r.chg.h6} w="6h" cls="m-c6" />
            <Chg v={r.chg.h24} w="24h" cls="m-c24" />
            <span role="cell" className="m-liq"><i>Liq</i>{usd(r.liq)}</span>
            <span role="cell" className="m-mc"><i>MC</i>{usd(r.mc)}</span>
          </div>
        ))}
        {!loading && rows.length > 0 && shown.length === 0 && <p className="muted m-empty">No pairs match these filters. Loosen them or load more pairs.</p>}
        {loading && rows.length === 0 && !failed && (
          <div className="m-skeleton" aria-busy="true" aria-label="Loading Solana pairs">
            <div className="m-loading">
              <span className="spinner" aria-hidden="true" />
              Loading Solana pairs…
            </div>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="m-skel-row">
                <i className="sk sk-av" />
                <span>
                  <i className="sk sk-l" />
                  <i className="sk sk-s" />
                </span>
                <i className="sk sk-p" />
              </div>
            ))}
          </div>
        )}
        {failed && rows.length === 0 && (
          <div className="m-error">
            <b>Unable to load pairs right now.</b>
            <span className="muted small">Please try again.</span>
            <button type="button" className="tier-btn pro m-retry" onClick={() => setReload((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
      </div>

      {pages > 0 && pages < MAX_PAGES && (
        <button type="button" className="ghost wide" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : `Load more pairs (${pages * 20} loaded)`}
        </button>
      )}
      {cta}
      <p className="muted small m-src">
        Pair data: GeckoTerminal · {LISTS[list].label} shows up to {MAX_PAGES * 20} pairs. Tap a pair for the full ORBIT report.
      </p>
    </section>
  );
}

function Chg({ v, w, cls }: { v: number; w: string; cls: string }) {
  return (
    <span role="cell" className={`m-chg ${cls} ${v > 0 ? "up-t" : v < 0 ? "down-t" : ""}`}>
      <i>{w}</i>
      {pct(v)}
    </span>
  );
}

function HeadCell({ s, label, sort, desc, onSort, sortKey }: { s: SortId; label: string; sort: SortId; desc: boolean; onSort: (s: SortId) => void; sortKey?: null }) {
  if (sortKey === null) return <span role="columnheader">{label}</span>;
  return (
    <button type="button" role="columnheader" className={sort === s ? "on" : ""} onClick={() => onSort(s)}>
      {label}
      {sort === s ? (desc ? " ↓" : " ↑") : ""}
    </button>
  );
}

function Range({ label, a, b, onA, onB, id }: { label: string; a: string; b: string; onA: (v: string) => void; onB: (v: string) => void; id: string }) {
  return (
    <div className="m-f-group">
      <span className="label">{label}</span>
      <div className="m-range">
        <input id={`f-${id}-min`} inputMode="decimal" placeholder="Min" value={a} onChange={(e) => onA(e.target.value.replace(/[^0-9.\-]/g, ""))} />
        <input id={`f-${id}-max`} inputMode="decimal" placeholder="Max" value={b} onChange={(e) => onB(e.target.value.replace(/[^0-9.\-]/g, ""))} />
      </div>
    </div>
  );
}

function Single({ label, v, on, id }: { label: string; v: string; on: (v: string) => void; id: string }) {
  return (
    <div className="m-f-group">
      <span className="label">{label}</span>
      <div className="m-range">
        <input id={`f-${id}`} inputMode="decimal" placeholder="Any" value={v} onChange={(e) => on(e.target.value.replace(/[^0-9.\-]/g, ""))} />
      </div>
    </div>
  );
}
