"use client";

import { useEffect, useState } from "react";

// Pro: coins the user starred, with live price / 24h / liquidity from DexScreener. Stored in this browser.
export type Watched = { ca: string; symbol: string; name: string; image?: string; added: number };
const K = "orbit.watch.v1";
const listeners = new Set<() => void>();

export function getWatch(): Watched[] {
  try {
    return JSON.parse(localStorage.getItem(K) ?? "[]");
  } catch {
    return [];
  }
}
function save(l: Watched[]) {
  try {
    localStorage.setItem(K, JSON.stringify(l.slice(0, 60)));
  } catch {}
  listeners.forEach((f) => f());
}
export const isWatched = (ca: string) => getWatch().some((w) => w.ca === ca);
export function toggleWatch(w: Omit<Watched, "added">) {
  const l = getWatch();
  save(l.some((x) => x.ca === w.ca) ? l.filter((x) => x.ca !== w.ca) : [{ ...w, added: Date.now() }, ...l]);
}
export function useWatch() {
  const [l, setL] = useState<Watched[]>([]);
  useEffect(() => {
    const sync = () => setL(getWatch());
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return l;
}

/** Star button for the coin header */
export function WatchStar({ w, pro, onSubscribe }: { w: Omit<Watched, "added">; pro: boolean; onSubscribe: () => void }) {
  const list = useWatch();
  const on = list.some((x) => x.ca === w.ca);
  return (
    <button className={`watch-star ${on ? "on" : ""}`} onClick={() => (pro ? toggleWatch(w) : onSubscribe())} title={on ? "Remove from watchlist" : "Add to watchlist"}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {on ? "Watching" : "Watch"}
    </button>
  );
}

type Row = { price: number | null; ch24: number | null; liq: number | null; mc: number | null };
const usd = (n: number | null) => (n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const price = (p: number | null) => (p == null ? "—" : p >= 1 ? `$${p.toFixed(4)}` : `$${p.toPrecision(4)}`);

export default function Watchlist({ onOpen }: { onOpen: (ca: string) => void }) {
  const list = useWatch();
  const [rows, setRows] = useState<Record<string, Row>>({});
  useEffect(() => {
    if (!list.length) return;
    let dead = false;
    const load = async () => {
      const out: Record<string, Row> = {};
      for (let i = 0; i < list.length; i += 30) {
        try {
          const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${list.slice(i, i + 30).map((w) => w.ca).join(",")}`);
          const pairs = (await r.json()) as { baseToken: { address: string }; priceUsd?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number }; marketCap?: number; fdv?: number }[];
          for (const p of pairs) {
            const cur = out[p.baseToken.address];
            if (cur && (cur.liq ?? 0) >= (p.liquidity?.usd ?? 0)) continue;
            out[p.baseToken.address] = { price: p.priceUsd ? Number(p.priceUsd) : null, ch24: p.priceChange?.h24 ?? null, liq: p.liquidity?.usd ?? null, mc: p.marketCap ?? p.fdv ?? null };
          }
        } catch {}
      }
      if (!dead) setRows(out);
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [list]);

  if (!list.length)
    return (
      <div className="card">
        <h3>Watchlist</h3>
        <p className="muted small">Open any coin and tap <b>Watch</b> to keep it here with live price, 24h change and liquidity.</p>
      </div>
    );
  return (
    <div className="card watchlist">
      <div className="section-head">
        <h3>Watchlist</h3>
        <span className="muted small">{list.length} coins · updates every 30 s</span>
      </div>
      <div className="wl-head small muted"><span>Coin</span><span>Price</span><span>24h</span><span>Liquidity</span><span>MC</span><span /></div>
      {list.map((w) => {
        const r = rows[w.ca];
        return (
          <div key={w.ca} className="wl-row" onClick={() => onOpen(w.ca)}>
            <span className="wl-coin">
              {w.image ? <img src={w.image} alt="" /> : <i />}
              <b>${w.symbol}</b>
            </span>
            <span className="mono">{price(r?.price ?? null)}</span>
            <span className={`mono ${(r?.ch24 ?? 0) >= 0 ? "up" : "down"}`}>{r?.ch24 == null ? "—" : `${r.ch24 > 0 ? "+" : ""}${r.ch24.toFixed(1)}%`}</span>
            <span className="mono">{usd(r?.liq ?? null)}</span>
            <span className="mono">{usd(r?.mc ?? null)}</span>
            <button
              className="wl-x"
              onClick={(e) => {
                e.stopPropagation();
                toggleWatch(w);
              }}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
