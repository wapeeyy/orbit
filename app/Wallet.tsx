"use client";

import { useEffect, useState } from "react";
import type { WalletReport } from "@/lib/wallet";
import { CopyButton } from "./Copy";
import { api } from "./key";
import { usePro } from "./ProLock";
import { PRICE_LABEL } from "./price";

const usd = (n: number | null | undefined) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const sol = (n: number, d = 2) => `${n.toLocaleString("en-US", { maximumFractionDigits: d })} SOL`;
const signed = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d })} SOL`;
const ago = (t: number) => {
  const m = (Date.now() - t) / 60_000;
  return m < 1 ? "now" : m < 60 ? `${Math.floor(m)}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};
const dur = (min: number | null) =>
  min == null ? "—" : min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} hours` : `${(min / 1440).toFixed(1)} days`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const SRC: Record<string, string> = { PUMP_FUN: "Pump.fun", PUMP_AMM: "PumpSwap", JUPITER: "Jupiter", RAYDIUM: "Raydium", ORCA: "Orca", METEORA: "Meteora" };

export default function Wallet({
  request,
  onOpen,
  onSubscribe,
}: {
  request: { address: string; n: number } | null;
  onOpen: (ca: string) => void;
  onSubscribe: () => void;
}) {
  const [addr, setAddr] = useState("");
  const [data, setData] = useState<WalletReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const pro = usePro();

  async function trace(a = addr) {
    const q = a.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setLocked(false);
    setData(null);
    try {
      const r = await api(`/api/wallet?address=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (r.status === 402) return setLocked(true);
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (request) {
      setAddr(request.address);
      trace(request.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const d = data;
  const st = d?.stats;
  const mostSold = d ? [...d.tokens].filter((t) => t.soldSol > 0).sort((a, b) => b.soldSol - a.soldSol).slice(0, 5) : [];
  const closed = d ? d.tokens.filter((t) => t.realizedSol != null) : [];
  const best = [...closed].sort((a, b) => b.realizedSol! - a.realizedSol!).filter((t) => t.realizedSol! > 0).slice(0, 3);
  const worst = [...closed].sort((a, b) => a.realizedSol! - b.realizedSol!).filter((t) => t.realizedSol! < 0).slice(0, 3);

  const report = d
    ? [
        `ORBIT wallet trace — ${d.address}`,
        d.labels.length ? `Labels: ${d.labels.join(" · ")}` : "",
        `Value: ${usd(d.totalUsd)} (${sol(d.solBalance)} + ${d.holdings.length} tokens)`,
        st ? `${st.trades} swaps · ${st.tokensTraded} tokens · ${st.tradesPerDay ? st.tradesPerDay.toFixed(1) : "—"} swaps/day` : "",
        st ? `Realized PnL: ${signed(st.realizedSol)} · win rate ${st.winRate != null ? st.winRate.toFixed(0) + "%" : "—"} (${st.wins}W/${st.losses}L)` : "",
        mostSold.length ? `Most sold: ${mostSold.map((t) => `${t.symbol} ${sol(t.soldSol)}`).join(", ")}` : "",
        best.length ? `Best trades: ${best.map((t) => `${t.symbol} ${signed(t.realizedSol!)}`).join(", ")}` : "",
        "Not financial advice — DYOR.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <section>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          trace();
        }}
      >
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste a Solana wallet address" spellCheck={false} />
        <button disabled={loading || addr.trim().length < 32}>{loading ? "Tracing…" : "Trace"}</button>
      </form>
      <p className="muted small" style={{ margin: "-8px 0 14px" }}>
        Tip: in a coin report, tap any top-holder wallet to trace it directly.
      </p>

      {loading && <div className="card muted">Reading the latest 300 transactions & holdings… (10–20 seconds)</div>}
      {error && <div className="alert danger">{error}</div>}
      {(locked || !pro) && (
        <div className="card locked-cta">
          <b>Wallet tracing is for ORBIT Pro subscribers</b>
          <span className="muted small">See which coins a wallet buys & sells, its PnL, win rate and current holdings.</span>
          <button className="copy primary" onClick={onSubscribe}>Get ORBIT Pro — {PRICE_LABEL}</button>
        </div>
      )}

      {d && st && (
        <>
          <div className="card">
            <div className="wallet-head">
              <div>
                <span className="label">Wallet</span>
                <code className="ca">{d.address}</code>
              </div>
              <div className="buy" style={{ marginTop: 0 }}>
                <CopyButton text={d.address} label="Copy" />
                <a className="buy-link" href={`https://gmgn.ai/sol/address/${d.address}`} target="_blank" rel="noreferrer">GMGN ↗</a>
                <a className="buy-link" href={`https://solscan.io/account/${d.address}`} target="_blank" rel="noreferrer">Solscan ↗</a>
              </div>
            </div>
            {d.labels.length > 0 && (
              <div className="tags" style={{ margin: "12px 0 4px" }}>
                {d.labels.map((l) => (
                  <span key={l} className="chip">{l}</span>
                ))}
              </div>
            )}
            <div className="insights" style={{ marginTop: 12 }}>
              <Tile label="Wallet value" value={usd(d.totalUsd)} sub={`${sol(d.solBalance)} + ${d.holdings.length} tokens`} />
              <Tile
                label="Realized PnL"
                value={signed(st.realizedSol)}
                sub={d.solUsd ? `≈ ${usd(st.realizedSol * d.solUsd)}` : ""}
                tone={st.realizedSol >= 0 ? "up" : "down"}
              />
              <Tile label="Win rate" value={st.winRate != null ? `${st.winRate.toFixed(0)}%` : "—"} sub={`${st.wins} wins · ${st.losses} losses`} />
              <Tile label="Swaps" value={String(st.trades)} sub={`${st.tokensTraded} tokens · ${st.tradesPerDay ? st.tradesPerDay.toFixed(1) : "—"}/day`} />
              <Tile label="Avg buy" value={st.avgBuySol != null ? sol(st.avgBuySol, 3) : "—"} sub={`Volume ${sol(st.volumeSol, 1)}`} />
              <Tile label="Avg hold time" value={dur(st.avgHoldMin)} sub="first buy → last sell" />
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              Based on {st.trades} swaps {st.complete ? "(full history)" : "(most recent)"}
              {st.periodDays ? ` over ${st.periodDays < 1 ? `${Math.round(st.periodDays * 24)} hours` : `${st.periodDays.toFixed(0)} days`}` : ""}.
            </p>
            <CopyButton text={report} label="Copy wallet report" className="primary" />
          </div>

          {(mostSold.length > 0 || best.length > 0 || worst.length > 0) && (
            <div className="card">
              <div className="rank-grid">
                {mostSold.length > 0 && (
                  <Rank title="Most sold" rows={mostSold.map((t) => ({ mint: t.mint, sym: t.symbol, val: sol(t.soldSol) }))} onOpen={onOpen} />
                )}
                {best.length > 0 && (
                  <Rank title="Best trades" rows={best.map((t) => ({ mint: t.mint, sym: t.symbol, val: signed(t.realizedSol!), up: true }))} onOpen={onOpen} />
                )}
                {worst.length > 0 && (
                  <Rank title="Worst trades" rows={worst.map((t) => ({ mint: t.mint, sym: t.symbol, val: signed(t.realizedSol!), up: false }))} onOpen={onOpen} />
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: "0 0 10px" }}>Coins traded</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="r">Bought</th>
                    <th className="r">Sold</th>
                    <th className="r">PnL</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.tokens.map((t) => (
                    <tr key={t.mint} className="click" onClick={() => onOpen(t.mint)}>
                      <td><b>{t.symbol}</b></td>
                      <td className="r">{sol(t.boughtSol)}</td>
                      <td className="r">{sol(t.soldSol)}</td>
                      <td className={`r ${t.realizedSol == null ? "muted" : t.realizedSol >= 0 ? "up-t" : "down-t"}`}>
                        {t.realizedSol == null ? (t.sells ? "?" : "—") : signed(t.realizedSol)}
                      </td>
                      <td className="small"><span className={`sdot ${t.status}`} aria-hidden="true" />{t.status === "pegang" ? "Holding" : t.status === "separuh" ? "Partial" : "Exited"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">? = bought before the period we read, cost unknown. Tap a row for the coin report.</p>
          </div>

          {d.holdings.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 10px" }}>Current holdings</h3>
              <div className="hist">
                {d.holdings.slice(0, 15).map((h) => (
                  <div key={h.mint} className="hist-row click" onClick={() => onOpen(h.mint)}>
                    <b>{h.symbol}</b>
                    <span className="muted small">{h.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    <span className="hist-t">{usd(h.usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: "0 0 10px" }}>Recent activity</h3>
            <div className="hist">
              {d.swaps.slice(0, 30).map((s) => {
                const t = d.tokens.find((x) => x.mint === s.mint);
                return (
                  <a key={s.signature} className="hist-row" href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">
                    <span className={`side ${s.side === "BUY" ? "buy" : "sell"}`}>{s.side}</span>
                    <b>{t?.symbol ?? short(s.mint)}</b>
                    <span className="small">{sol(s.sol, 3)}</span>
                    <span className="muted small">{SRC[s.source] ?? (/^(SYSTEM_PROGRAM|UNKNOWN)$/.test(s.source) ? "Swap" : s.source)}</span>
                    <span className="muted small hist-t">{ago(s.ts)}</span>
                  </a>
                );
              })}
              {d.swaps.length === 0 && <p className="muted">No swaps found.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className={`insight ${tone ?? ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

function Rank({ title, rows, onOpen }: { title: string; rows: { mint: string; sym: string; val: string; up?: boolean }[]; onOpen: (ca: string) => void }) {
  return (
    <div>
      <span className="label">{title}</span>
      {rows.map((r, i) => (
        <div key={r.mint} className="rank-row click" onClick={() => onOpen(r.mint)}>
          <span className="muted">{i + 1}</span>
          <b>{r.sym}</b>
          <span className={r.up === undefined ? "" : r.up ? "up-t" : "down-t"}>{r.val}</span>
        </div>
      ))}
    </div>
  );
}
