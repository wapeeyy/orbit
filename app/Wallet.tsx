"use client";

import { useEffect, useState } from "react";
import type { WalletReport } from "@/lib/wallet";
import { CopyButton } from "./Copy";
import { api } from "./key";

const usd = (n: number | null | undefined) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const sol = (n: number, d = 2) => `${n > 0 ? "" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: d })} SOL`;
const signed = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d })} SOL`;
const ago = (t: number) => {
  const m = (Date.now() - t) / 60_000;
  return m < 1 ? "baru" : m < 60 ? `${Math.floor(m)}m` : m < 1440 ? `${Math.floor(m / 60)}j` : `${Math.floor(m / 1440)}h`;
};
const dur = (min: number | null) =>
  min == null ? "—" : min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} jam` : `${(min / 1440).toFixed(1)} hari`;
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
        `🪐 Trace wallet ORBIT — ${d.address}`,
        d.labels.length ? `Label: ${d.labels.join(" · ")}` : "",
        `Nilai: ${usd(d.totalUsd)} (${sol(d.solBalance)} + ${d.holdings.length} token)`,
        st ? `${st.trades} swap · ${st.tokensTraded} token · ${st.tradesPerDay ? st.tradesPerDay.toFixed(1) : "—"} swap/hari` : "",
        st ? `Untung/rugi direalisasi: ${signed(st.realizedSol)} · win rate ${st.winRate != null ? st.winRate.toFixed(0) + "%" : "—"} (${st.wins}W/${st.losses}L)` : "",
        mostSold.length ? `Paling banyak dijual: ${mostSold.map((t) => `${t.symbol} ${sol(t.soldSol)}`).join(", ")}` : "",
        best.length ? `Paling untung: ${best.map((t) => `${t.symbol} ${signed(t.realizedSol!)}`).join(", ")}` : "",
        "Bukan nasihat kewangan — DYOR.",
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
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste alamat wallet Solana" spellCheck={false} />
        <button disabled={loading || addr.trim().length < 32}>{loading ? "Tracing…" : "Trace"}</button>
      </form>
      <p className="muted small" style={{ margin: "-8px 0 14px" }}>
        Tip: dalam laporan coin, tekan mana-mana wallet top holder untuk trace terus.
      </p>

      {loading && <div className="card muted">Membaca sehingga 200 swap terkini & pegangan wallet… (10–20 saat)</div>}
      {error && <div className="alert danger">{error}</div>}
      {locked && (
        <div className="card locked-cta">
          <b>🔒 Trace wallet untuk pelanggan ORBIT Pro</b>
          <span className="muted small">Tengok coin apa wallet tu beli & jual, untung rugi, win rate dan pegangan semasa.</span>
          <button className="copy primary" onClick={onSubscribe}>Langgan RM100 / bulan</button>
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
              <Tile label="Nilai wallet" value={usd(d.totalUsd)} sub={`${sol(d.solBalance)} + ${d.holdings.length} token`} />
              <Tile
                label="Untung / rugi (direalisasi)"
                value={signed(st.realizedSol)}
                sub={d.solUsd ? `≈ ${usd(st.realizedSol * d.solUsd)}` : ""}
                tone={st.realizedSol >= 0 ? "up" : "down"}
              />
              <Tile label="Win rate" value={st.winRate != null ? `${st.winRate.toFixed(0)}%` : "—"} sub={`${st.wins} untung · ${st.losses} rugi`} />
              <Tile label="Swap" value={String(st.trades)} sub={`${st.tokensTraded} token · ${st.tradesPerDay ? st.tradesPerDay.toFixed(1) : "—"}/hari`} />
              <Tile label="Purata beli" value={st.avgBuySol != null ? sol(st.avgBuySol, 3) : "—"} sub={`Volume ${sol(st.volumeSol, 1)}`} />
              <Tile label="Purata pegang" value={dur(st.avgHoldMin)} sub="beli pertama → jual terakhir" />
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              Berdasarkan {st.trades} swap {st.complete ? "(semua sejarah)" : "terkini"}
              {st.periodDays ? ` dalam ${st.periodDays < 1 ? `${Math.round(st.periodDays * 24)} jam` : `${st.periodDays.toFixed(0)} hari`}` : ""}.
            </p>
            <CopyButton text={report} label="📋 Copy laporan wallet" className="primary" />
          </div>

          {(mostSold.length > 0 || best.length > 0) && (
            <div className="card">
              <div className="rank-grid">
                {mostSold.length > 0 && (
                  <Rank title="💸 Paling banyak dijual" rows={mostSold.map((t) => ({ mint: t.mint, sym: t.symbol, val: sol(t.soldSol) }))} onOpen={onOpen} />
                )}
                {best.length > 0 && (
                  <Rank title="🔥 Paling untung" rows={best.map((t) => ({ mint: t.mint, sym: t.symbol, val: signed(t.realizedSol!), up: true }))} onOpen={onOpen} />
                )}
                {worst.length > 0 && (
                  <Rank title="📉 Paling rugi" rows={worst.map((t) => ({ mint: t.mint, sym: t.symbol, val: signed(t.realizedSol!), up: false }))} onOpen={onOpen} />
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: "0 0 10px" }}>Coin yang didagang</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="r">Beli</th>
                    <th className="r">Jual</th>
                    <th className="r">Untung</th>
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
                      <td className="small">{t.status === "pegang" ? "🟢 Pegang" : t.status === "separuh" ? "🟠 Separuh" : "⚪ Habis"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">? = beli sebelum tempoh yang dibaca, kos tak diketahui. Tekan baris untuk laporan coin.</p>
          </div>

          {d.holdings.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 10px" }}>Pegangan sekarang</h3>
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
            <h3 style={{ margin: "0 0 10px" }}>Aktiviti terkini</h3>
            <div className="hist">
              {d.swaps.slice(0, 30).map((s) => {
                const t = d.tokens.find((x) => x.mint === s.mint);
                return (
                  <a key={s.signature} className="hist-row" href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">
                    <span className={`side ${s.side === "BUY" ? "buy" : "sell"}`}>{s.side === "BUY" ? "BELI" : "JUAL"}</span>
                    <b>{t?.symbol ?? short(s.mint)}</b>
                    <span className="small">{sol(s.sol, 3)}</span>
                    <span className="muted small">{SRC[s.source] ?? s.source}</span>
                    <span className="muted small hist-t">{ago(s.ts)}</span>
                  </a>
                );
              })}
              {d.swaps.length === 0 && <p className="muted">Tiada swap dijumpai.</p>}
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
