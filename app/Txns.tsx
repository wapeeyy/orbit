"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Live trades for a pool (GeckoTerminal, straight from the browser), refreshed every 5 s while visible.
// ORBIT extras: whale and dev tags, a 5-minute buy/sell pulse, tap a wallet to trace it.
type Tx = { id: string; kind: "buy" | "sell"; usd: number; price: number; amount: number; maker: string; t: number; sig: string };

const SOL = "So11111111111111111111111111111111111111112";
const WHALE_USD = 2000;
const POLL_MS = 5000;

const usd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${n.toFixed(n >= 100 ? 0 : 2)}`);
const px = (p: number) => (p >= 1 ? `$${p.toFixed(4)}` : `$${p.toPrecision(4)}`);
const amt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

export default function Txns({ pool, token, dev, onTrace, compact }: { pool: string; token: string; dev?: string | null; onTrace: (w: string) => void; compact?: boolean }) {
  const [rows, setRows] = useState<Tx[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState<"all" | "buy" | "sell" | "whale">("all");
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      // straight from the browser first; the shared ORBIT cache when GeckoTerminal rate-limits this device
      let r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
      if (!r || !r.ok) r = await fetch(`/api/trades?pool=${pool}`, { cache: "no-store" });
      if (r.status === 429) return; // busy: keep the list, try next tick
      if (!r.ok) throw new Error(`Trades ${r.status}`);
      const j = (await r.json()) as { data?: { id: string; attributes: Record<string, string> }[] };
      const list: Tx[] = (j.data ?? []).map(({ id, attributes: a }) => {
        const isBuy = a.kind !== "sell";
        const tokAmt = Number(isBuy ? a.to_token_amount : a.from_token_amount) || 0;
        const price = Number(isBuy ? a.price_to_in_usd : a.price_from_in_usd) || 0;
        return { id, kind: isBuy ? "buy" : "sell", usd: Number(a.volume_in_usd) || 0, price, amount: a.to_token_address === SOL && isBuy ? 0 : tokAmt, maker: a.tx_from_address, t: Date.parse(a.block_timestamp), sig: a.tx_hash };
      });
      const first = seen.current.size === 0;
      const added = new Set(list.filter((x) => !seen.current.has(x.id)).map((x) => x.id));
      list.forEach((x) => seen.current.add(x.id));
      setFresh(first ? new Set() : added);
      setRows(list);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [pool]);

  useEffect(() => {
    seen.current = new Set();
    setRows(null);
    load();
    const iv = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(iv);
      clearInterval(clock);
    };
  }, [load]);

  const win = (rows ?? []).filter((x) => now - x.t < 5 * 60_000);
  const b5 = win.filter((x) => x.kind === "buy");
  const s5 = win.filter((x) => x.kind === "sell");
  const bv = b5.reduce((s, x) => s + x.usd, 0);
  const sv = s5.reduce((s, x) => s + x.usd, 0);
  const makers = new Set(win.map((x) => x.maker)).size;
  const shown = (rows ?? []).filter((x) => (only === "all" ? true : only === "whale" ? x.usd >= WHALE_USD : x.kind === only)).slice(0, compact ? 40 : 150);

  return (
    <section className={`card txns ${compact ? "compact" : ""}`}>
      <div className="section-head">
        <h3>Transactions</h3>
        <span className="live-dot">
          <span className="live-pip" />
          LIVE
        </span>
        <button className="ghost small" onClick={load} aria-label="Refresh trades">↻</button>
      </div>
      {rows && (
        <div className="tx-pulse">
          <div>
            <span>5 min buys</span>
            <b className="up">{b5.length} · {usd(bv)}</b>
          </div>
          <div>
            <span>5 min sells</span>
            <b className="down">{s5.length} · {usd(sv)}</b>
          </div>
          <div>
            <span>Wallets</span>
            <b>{makers}</b>
          </div>
          <i className="tx-bar">
            <em style={{ width: `${bv + sv ? (bv / (bv + sv)) * 100 : 50}%` }} />
          </i>
        </div>
      )}
      <div className="views tx-filter">
        {(["all", "buy", "sell", "whale"] as const).map((k) => (
          <button key={k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>
            {k === "all" ? "All" : k === "buy" ? "Buys" : k === "sell" ? "Sells" : `Whales $${WHALE_USD / 1000}K+`}
          </button>
        ))}
      </div>
      {err && !rows && <div className="alert danger">Trades are busy right now, retrying… ({err})</div>}
      {!rows && !err && <div className="m-loading"><span className="spinner" /> Loading trades…</div>}
      {rows && (
        <div className="tx-list">
          <div className="tx-row tx-head">
            <span>Age</span>
            <span>Type</span>
            <span className="r">USD</span>
            <span className="r">Price</span>
            <span className="r tx-amt">{token ? "Amount" : ""}</span>
            <span className="r">Maker</span>
          </div>
          {shown.map((x) => (
            <div key={x.id} className={`tx-row ${x.kind} ${fresh.has(x.id) ? "new" : ""} ${x.usd >= WHALE_USD ? "whale" : ""}`}>
              <span className="muted">{ago(x.t, now)}</span>
              <span className={x.kind === "buy" ? "up" : "down"}>{x.kind === "buy" ? "Buy" : "Sell"}</span>
              <span className={`r ${x.kind === "buy" ? "up" : "down"}`}>{usd(x.usd)}</span>
              <span className="r">{px(x.price)}</span>
              <span className="r tx-amt">{x.amount ? amt(x.amount) : "—"}</span>
              <span className="r">
                <button className="linkish" onClick={() => onTrace(x.maker)} title="Trace this wallet">
                  {short(x.maker)}
                </button>
                {dev && x.maker === dev && <em className="flag dev">DEV</em>}
                {x.usd >= WHALE_USD && <em className="flag whale">WHALE</em>}
              </span>
            </div>
          ))}
          {shown.length === 0 && <p className="muted small">No trades match this filter right now.</p>}
        </div>
      )}
      <p className="muted small tx-note">Last 300 trades from GeckoTerminal · updates every 5 s · tap a wallet to trace it.</p>
    </section>
  );
}
