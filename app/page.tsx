"use client";

import { useEffect, useState } from "react";
import Discover from "./Discover";
import Chart from "./Chart";
import About from "./About";
import { BuyLinks } from "./Copy";
import Subscribe from "./Subscribe";
import { api, isActive, onKeyChange } from "./key";
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
  const [tab, setTab] = useState<"scan" | "discover" | "sub">("discover");
  const [scanCa, setScanCa] = useState<{ ca: string; n: number; free?: string } | null>(null);
  const [pro, setPro] = useState(false);
  useEffect(() => {
    const sync = () => setPro(isActive());
    sync();
    return onKeyChange(sync);
  }, []);
  const goSub = () => {
    setTab("sub");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main>
      <header className="brand">
        <div className="logo" aria-hidden>
          <span />
        </div>
        <h1>ORBIT</h1>
        <p>Cari coin Solana yang okey, atau paste CA untuk semak harga, liquidity & siapa pegang supply.</p>
      </header>

      <nav className="tabs">
        <button className={tab === "discover" ? "on" : ""} onClick={() => setTab("discover")}>
          Cari Coin
        </button>
        <button className={tab === "scan" ? "on" : ""} onClick={() => setTab("scan")}>
          Scan CA
        </button>
        <button className={tab === "sub" ? "on" : ""} onClick={() => setTab("sub")}>
          {pro ? "✓ Pro" : "Langgan"}
        </button>
      </nav>

      <div hidden={tab !== "discover"}>
        <Discover
          onSubscribe={goSub}
          onOpen={(ca, free) => {
            setScanCa((p) => ({ ca, free, n: (p?.n ?? 0) + 1 }));
            setTab("scan");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
      <div hidden={tab !== "scan"}>
        <ScanView request={scanCa} onSubscribe={goSub} />
      </div>
      <div hidden={tab !== "sub"}>
        <Subscribe />
      </div>

      <footer className="muted small">Data: DexScreener · Helius RPC. Bukan nasihat kewangan — DYOR.</footer>
    </main>
  );
}

function ScanView({
  request,
  onSubscribe,
}: {
  request: { ca: string; n: number; free?: string } | null;
  onSubscribe: () => void;
}) {
  const [ca, setCa] = useState("");
  const [locked, setLocked] = useState(false);
  const [free, setFree] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);

  useEffect(() => {
    if (request) {
      setCa(request.ca);
      setFree(request.free);
      scan(undefined, request.ca, request.free);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function scan(e?: React.FormEvent, override?: string, freeSig?: string) {
    e?.preventDefault();
    const q = (override ?? ca).trim();
    if (!q) return;
    if (!override) setFree(undefined); // scan manual: tiket percuma tak berkenaan
    setLoading(true);
    setError(null);
    setLocked(false);
    setData(null);
    try {
      const f = override ? freeSig : undefined;
      const res = await api(`/api/token?ca=${encodeURIComponent(q)}${f ? `&free=${f}` : ""}`);
      const json = await res.json();
      if (res.status === 402) {
        setLocked(true);
        return;
      }
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
    <>
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
      {locked && (
        <div className="card locked-cta">
          <b>🔒 Scan CA untuk pelanggan ORBIT Pro</b>
          <span className="muted small">
            Versi percuma boleh buka 3 coin teratas dalam Cari Coin. Langgan untuk scan mana-mana CA: holder, chart,
            naratif dan post terakhir owner.
          </span>
          <button className="copy primary" onClick={onSubscribe}>Langgan RM100 / bulan</button>
        </div>
      )}

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
            <BuyLinks ca={data.ca} pair={m?.pairAddress} />
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

          <About key={"about-" + data.ca} ca={data.ca} free={free} />

          {m?.pairAddress && <Chart key={m.pairAddress} pool={m.pairAddress} token={data.ca} />}

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

                <div className="badges">
                  <Badge ok={h.mintAuthority === null} yes="Mint authority revoked" no="Mint authority AKTIF — dev boleh cetak token baru" />
                  <Badge ok={h.freezeAuthority === null} yes="Freeze authority revoked" no="Freeze authority AKTIF — dev boleh beku wallet" />
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

    </>
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

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`badge ${ok ? "ok" : "bad"}`}>{ok ? "✓ " + yes : "✕ " + no}</span>;
}
