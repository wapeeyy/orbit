"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtPrice } from "./Chart";
import { buy, FEE, load, onDemoChange, prices, reset, sell, START_SOL, type DemoState } from "./demo";

const sol = (n: number, d = 3) => `${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) })} SOL`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
const ago = (t: number) => {
  const m = (Date.now() - t) / 60_000;
  return m < 1 ? "now" : m < 60 ? `${Math.floor(m)}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

export function useDemo() {
  const [s, setS] = useState<DemoState | null>(null);
  useEffect(() => {
    setS(load());
    return onDemoChange(() => setS(load()));
  }, []);
  return s;
}

/** Demo tab: fake-SOL portfolio */
export default function Demo({ onOpen }: { onOpen: (ca: string) => void }) {
  const s = useDemo();
  const [px, setPx] = useState<Record<string, { sol: number; usd: number }>>({});
  const [solUsd, setSolUsd] = useState(0);
  const [ca, setCa] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const held = s ? Object.keys(s.pos) : [];
  const refresh = useCallback(async () => {
    const cas = Object.keys(load().pos);
    try {
      const r = await prices(cas);
      setSolUsd(r.solUsd);
      setPx(Object.fromEntries(Object.entries(r.prices).map(([k, v]) => [k, { sol: v.sol, usd: v.usd }])));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, held.join(",")]);

  if (!s) return null;

  const posValue = held.reduce((v, k) => v + (px[k] ? s.pos[k].amount * px[k].sol : s.pos[k].costSol), 0);
  const total = s.sol + posValue;
  const pnl = total - s.start;

  const quickBuy = async (amt: number) => {
    setMsg(null);
    const c = ca.trim();
    try {
      const r = await prices([c]);
      const p = r.prices[c];
      if (!p) throw new Error("Token not found on DexScreener");
      const got = buy({ ca: c, symbol: p.symbol, name: p.name, image: p.image }, amt, p.sol);
      setMsg({ ok: true, text: `✓ Bought ${got.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${p.symbol} for ${amt} fake SOL` });
      setCa("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section>
      <div className="card plan">
        <div className="plan-head">
          <div>
            <span className="label">Demo trading · fake SOL</span>
            <div className="price">{sol(total, 3)}</div>
            <span className={pnl >= 0 ? "up-t" : "down-t"}>
              {pnl >= 0 ? "▲" : "▼"} {sol(Math.abs(pnl))} ({pct((pnl / s.start) * 100)}) vs {s.start} SOL start
            </span>
          </div>
        </div>
        <div className="demo-tiles">
          <div><i>SOL balance</i><b>{sol(s.sol)}</b></div>
          <div><i>In positions</i><b>{sol(posValue)}</b></div>
          <div><i>Realized PnL</i><b className={s.realized >= 0 ? "up-t" : "down-t"}>{sol(s.realized)}</b></div>
          <div><i>USD value</i><b>{solUsd ? `$${(total * solUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</b></div>
        </div>
        <p className="muted small">
          Real DexScreener prices · {FEE * 100}% simulated fee + slippage on every buy/sell · no real money.
        </p>
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 10px" }}>Buy (demo)</h3>
        <div className="search" style={{ marginBottom: 10 }}>
          <input value={ca} onChange={(e) => setCa(e.target.value)} placeholder="Paste a token CA" spellCheck={false} />
        </div>
        <div className="chips">
          {[0.1, 0.5, 1, 2].map((a) => (
            <button key={a} className="ghost" disabled={ca.trim().length < 32} onClick={() => quickBuy(a)}>
              Buy {a} SOL
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Or tap <b>Demo buy</b> in any coin report.</p>
        {msg && <div className={`alert ${msg.ok ? "ok" : "danger"}`}>{msg.text}</div>}
      </div>

      <div className="card">
        <div className="section-head">
          <h3>Positions ({held.length})</h3>
          <button className="ghost" onClick={refresh}>↻</button>
        </div>
        {held.length === 0 && <p className="muted">No positions yet. Buy a coin to get started.</p>}
        <div className="positions">
          {held.map((k) => {
            const p = s.pos[k];
            const cur = px[k];
            const val = cur ? p.amount * cur.sol : null;
            const pp = val != null ? (val / p.costSol - 1) * 100 : null;
            return (
              <div key={k} className="pos">
                <div className="pos-head" onClick={() => onOpen(k)}>
                  {p.image ? <img src={p.image} alt="" /> : <div className="noimg">{p.symbol.slice(0, 2)}</div>}
                  <div className="coin-name">
                    <b>{p.symbol}</b>
                    <span className="muted small">
                      {p.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} · bought {ago(p.openedAt)} ago
                    </span>
                  </div>
                  <div className="pos-val">
                    <b>{val != null ? sol(val) : "…"}</b>
                    <span className={pp == null ? "muted" : pp >= 0 ? "up-t" : "down-t"}>{pp == null ? "" : pct(pp)}</span>
                  </div>
                </div>
                <div className="muted small">
                  Cost {sol(p.costSol)} · price now {cur ? `${fmtPrice(cur.sol)} SOL` : "…"}
                </div>
                <div className="chips">
                  {[0.25, 0.5, 1].map((f) => (
                    <button
                      key={f}
                      className="ghost"
                      disabled={!cur}
                      onClick={() => {
                        try {
                          const r = sell(k, f, cur!.sol);
                          setMsg({ ok: r.pnl >= 0, text: `${r.pnl >= 0 ? "✓ Profit" : "Loss"} ${sol(Math.abs(r.pnl))} — sold ${f * 100}% ${p.symbol}` });
                        } catch (e) {
                          setMsg({ ok: false, text: (e as Error).message });
                        }
                      }}
                    >
                      Sell {f === 1 ? "all" : `${f * 100}%`}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {s.hist.length > 0 && (
        <div className="card">
          <h3 style={{ margin: "0 0 10px" }}>History</h3>
          <div className="hist">
            {s.hist.slice(0, 30).map((t, i) => (
              <div key={i} className="hist-row">
                <span className={`side ${t.side === "BUY" ? "buy" : "sell"}`}>{t.side}</span>
                <b>{t.symbol}</b>
                <span className="muted small">{sol(t.sol)}</span>
                {t.pnlSol != null && <span className={t.pnlSol >= 0 ? "up-t small" : "down-t small"}>{t.pnlSol >= 0 ? "+" : ""}{t.pnlSol.toFixed(3)}</span>}
                <span className="muted small hist-t">{ago(t.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        className="ghost wide"
        onClick={() => {
          if (confirm(`Reset the demo? All positions are cleared and your balance goes back to ${START_SOL} fake SOL.`)) reset();
        }}
      >
        Reset demo (start again with {START_SOL} SOL)
      </button>
    </section>
  );
}

/** Widget inside a coin report: demo buy/sell this coin */
export function DemoTrade({ ca, symbol, name, image, priceSol }: { ca: string; symbol: string; name: string; image?: string; priceSol: number | null }) {
  const s = useDemo();
  const [price, setPrice] = useState<number | null>(priceSol);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (priceSol) return;
    prices([ca]).then((r) => setPrice(r.prices[ca]?.sol ?? null)).catch(() => {});
  }, [ca, priceSol]);

  if (!s) return null;
  const pos = s.pos[ca];
  const val = pos && price ? pos.amount * price : null;
  const pp = val != null && pos ? (val / pos.costSol - 1) * 100 : null;

  const doBuy = (a: number) => {
    try {
      const got = buy({ ca, symbol, name, image }, a, price!);
      setMsg({ ok: true, text: `✓ Got ${got.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol} (demo)` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section className="card demo-box">
      <div className="section-head">
        <h3>Demo buy</h3>
        <span className="muted small">Balance {s.sol.toFixed(3)} fake SOL</span>
      </div>
      <div className="chips">
        {[0.1, 0.5, 1, 2].map((a) => (
          <button key={a} className="ghost" disabled={!price} onClick={() => doBuy(a)}>
            {a} SOL
          </button>
        ))}
      </div>
      {pos && (
        <div className="demo-pos">
          <span>
            Holding {pos.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {symbol} · cost {pos.costSol.toFixed(3)} SOL ·{" "}
            <b className={pp == null ? "" : pp >= 0 ? "up-t" : "down-t"}>{val != null ? `${val.toFixed(3)} SOL (${pct(pp!)})` : "…"}</b>
          </span>
          <div className="chips">
            {[0.5, 1].map((f) => (
              <button
                key={f}
                className="ghost"
                disabled={!price}
                onClick={() => {
                  const r = sell(ca, f, price!);
                  setMsg({ ok: r.pnl >= 0, text: `${r.pnl >= 0 ? "✓ Profit" : "Loss"} ${Math.abs(r.pnl).toFixed(3)} SOL (demo)` });
                }}
              >
                Sell {f === 1 ? "all" : "50%"}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <div className={`alert ${msg.ok ? "ok" : "danger"}`} style={{ marginTop: 10, marginBottom: 0 }}>{msg.text}</div>}
    </section>
  );
}
