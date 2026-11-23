"use client";

import { useState } from "react";
import type { Market } from "@/lib/dex";
import type { HolderReport } from "@/lib/holders";

type Result = {
  ca: string;
  market: Market | null;
  marketError: string | null;
  holders: HolderReport | null;
  holdersError: string | null;
};

const usd = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n !== 0 && Math.abs(n) < 0.01) return "$" + n.toPrecision(3);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(n) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) >= 100_000 ? 2 : Math.abs(n) >= 1000 ? 0 : 4,
  }).format(n);
};
const num = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export default function Home() {
  const [ca, setCa] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);

  async function scan(e?: React.FormEvent) {
    e?.preventDefault();
    const q = ca.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/token?ca=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const m = data?.market;
  const h = data?.holders;
  const maxPct = h?.holders[0]?.pct ?? 1;

  return (
    <main>
      <header className="brand">
        <div className="logo" aria-hidden>
          <span />
        </div>
        <h1>ORBIT</h1>
        <p>Paste CA token Solana — harga, market cap, liquidity & siapa pegang supply.</p>
      </header>

      <form onSubmit={scan} className="search">
        <input
          value={ca}
          onChange={(e) => setCa(e.target.value)}
          placeholder="Contoh: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
          spellCheck={false}
          autoComplete="off"
        />
        <button disabled={loading || !ca.trim()}>{loading ? "Scanning…" : "Scan"}</button>
      </form>

      {error && <div className="alert danger">{error}</div>}

      {data && (
        <>
          <section className="card token">
            <div className="token-head">
              {m?.image && <img src={m.image} alt="" />}
              <div>
                <h2>
                  {m ? `${m.name}` : "Token"} {m && <span className="sym">${m.symbol}</span>}
                </h2>
                <code className="ca">{data.ca}</code>
              </div>
              {m?.url && (
                <a href={m.url} target="_blank" rel="noreferrer" className="ext">
                  DexScreener ↗
                </a>
              )}
            </div>
            {m ? (
              <div className="stats">
                <Stat label="Harga" value={usd(m.priceUsd)} sub={m.change24h != null ? `${m.change24h > 0 ? "+" : ""}${m.change24h}% 24j` : undefined} tone={m.change24h == null ? undefined : m.change24h >= 0 ? "up" : "down"} />
                <Stat label="Market cap" value={usd(m.marketCap ?? m.fdv)} sub={m.fdv ? `FDV ${usd(m.fdv)}` : undefined} />
                <Stat label="Liquidity" value={usd(m.liquidityUsd)} sub={`${m.pairCount} pair · utama ${m.dexId}`} />
                <Stat label="Volume 24j" value={usd(m.volume24h)} />
              </div>
            ) : (
              <p className="muted">{data.marketError ?? "Tiada pair di DexScreener untuk token ni."}</p>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h3>Top holder</h3>
              {h && (
                <span className="muted small">
                  Supply {num(h.supply)} · {h.scanned} akaun terbesar diimbas
                </span>
              )}
            </div>

            {data.holdersError && <div className="alert danger">Holder: {data.holdersError}</div>}

            {h && (
              <>
                <div className={`alert ${h.warning ? "danger" : "ok"}`}>
                  <strong>Top 10 pegang {h.top10Pct.toFixed(2)}% supply</strong>
                  {h.warning
                    ? " — ⚠️ Melebihi 30%. Supply tertumpu, risiko dump tinggi."
                    : " — bawah had 30%, taburan nampak OK."}
                  <div className="meter">
                    <div style={{ width: `${Math.min(h.top10Pct, 100)}%` }} />
                    <i style={{ left: "30%" }} />
                  </div>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Wallet</th>
                      <th className="r">Jumlah</th>
                      <th className="r">% supply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.holders.map((x) => (
                      <tr key={x.owner} className={x.rank <= 10 ? "top10" : undefined}>
                        <td>{x.rank}</td>
                        <td>
                          <a href={`https://solscan.io/account/${x.owner}`} target="_blank" rel="noreferrer">
                            <span className="full">{x.owner}</span>
                            <span className="short">{short(x.owner)}</span>
                          </a>
                        </td>
                        <td className="r">{num(x.amount)}</td>
                        <td className="r pct">
                          <span className="bar" style={{ width: `${(x.pct / maxPct) * 100}%` }} />
                          <b>{x.pct.toFixed(2)}%</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {h.excluded.length > 0 && (
                  <details>
                    <summary>
                      {h.excluded.length} akaun ditapis (pool / bonding curve / program) —{" "}
                      {h.excluded.reduce((s, x) => s + x.pct, 0).toFixed(2)}% supply
                    </summary>
                    <ul className="excluded">
                      {h.excluded.map((x) => (
                        <li key={x.owner}>
                          <span className="tag">{x.label}</span>
                          <a href={`https://solscan.io/account/${x.owner}`} target="_blank" rel="noreferrer">
                            {short(x.owner)}
                          </a>
                          <b>{x.pct.toFixed(2)}%</b>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        </>
      )}

      <footer className="muted small">Data: DexScreener · Helius RPC. Bukan nasihat kewangan.</footer>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className={`sub ${tone ?? ""}`}>{sub}</span>}
    </div>
  );
}
