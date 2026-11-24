"use client";

import { useEffect, useState } from "react";
import Discover from "./Discover";
import MarketList from "./Market";
import Chart from "./Chart";
import About from "./About";
import { BuyLinks } from "./Copy";
import Subscribe from "./Subscribe";
import Report from "./Report";
import Wallet from "./Wallet";
import Demo, { DemoTrade } from "./Demo";
import ProLock, { usePro } from "./ProLock";
import { Galaxy, Icon } from "./Cosmos";
import type { TokenInfo } from "@/lib/info";
import type { TokenExtra } from "@/lib/report";
import { api, isActive, onKeyChange, setKey } from "./key";
import { PRICE_LABEL } from "./price";
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
  const [tab, setTab] = useState<"scan" | "discover" | "wallet" | "demo" | "sub">("discover");
  const [mode, setMode] = useState<"all" | "picks">("all");
  useEffect(() => {
    try {
      const m = localStorage.getItem("orbit.discover.mode");
      if (m === "picks" || m === "all") setMode(m);
    } catch {}
  }, []);
  const pickMode = (m: "all" | "picks") => {
    setMode(m);
    try {
      localStorage.setItem("orbit.discover.mode", m);
    } catch {}
  };
  const [walletReq, setWalletReq] = useState<{ address: string; n: number } | null>(null);
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const openCa = (ca: string, free?: string) => {
    setScanCa((p) => ({ ca, free, n: (p?.n ?? 0) + 1 }));
    setTab("scan");
    top();
  };
  const trace = (address: string) => {
    setWalletReq((p) => ({ address, n: (p?.n ?? 0) + 1 }));
    setTab("wallet");
    top();
  };
  const [scanCa, setScanCa] = useState<{ ca: string; n: number; free?: string } | null>(null);
  const [pro, setPro] = useState(false);
  useEffect(() => {
    const sync = () => setPro(isActive());
    sync();
    return onKeyChange(sync);
  }, []);

  // Link aktivasi: /?kod=KOD_AKSES → simpan kod, buang dari URL, buka tab Langgan
  useEffect(() => {
    const url = new URL(window.location.href);
    const kod = url.searchParams.get("kod")?.trim();
    if (!kod) return;
    url.searchParams.delete("kod");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    fetch("/api/subscribe", { headers: { "x-orbit-key": kod } })
      .then((r) => r.json())
      .then((j) => {
        if (j.active) setKey(kod);
        setTab("sub");
      })
      .catch(() => {});
  }, []);
  const goSub = () => {
    setTab("sub");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main>
      <header className="brand">
        <Galaxy size={230} className="brand-mark" />
        <h1>Orbit</h1>
        <p className="eyebrow">Solana coin intelligence</p>
        <p className="brand-sub">Find Solana coins worth a look, or paste a CA to check price, liquidity & who holds the supply.</p>
      </header>

      <nav className="tabs">
        {(
          [
            ["discover", "discover", "Discover"],
            ["scan", "scan", "Scan"],
            ["wallet", "wallet", "Wallet"],
            ["demo", "demo", "Demo"],
            ["sub", "pro", pro ? "Pro" : "Subscribe"],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={`${tab === id ? "on" : ""} ${id === "sub" && pro ? "is-pro" : ""}`} onClick={() => setTab(id)}>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div hidden={tab !== "discover"}>
        <div className="views mode-switch" role="tablist" aria-label="Discover mode">
          <button role="tab" aria-selected={mode === "all"} className={mode === "all" ? "on" : ""} onClick={() => pickMode("all")}>
            All pairs
          </button>
          <button role="tab" aria-selected={mode === "picks"} className={mode === "picks" ? "on" : ""} onClick={() => pickMode("picks")}>
            ORBIT picks
          </button>
        </div>
        <div hidden={mode !== "all"}>
          <MarketList onOpen={(ca) => openCa(ca)} />
        </div>
        <div hidden={mode !== "picks"}>
          <Discover onSubscribe={goSub} onOpen={openCa} />
        </div>
      </div>
      <div hidden={tab !== "scan"}>
        <ScanView request={scanCa} onSubscribe={goSub} onTrace={trace} />
      </div>
      <div hidden={tab !== "wallet"}>
        <Wallet request={walletReq} onOpen={(ca) => openCa(ca)} onSubscribe={goSub} />
      </div>
      <div hidden={tab !== "demo"}>
        {pro ? (
          <Demo onOpen={(ca) => openCa(ca)} />
        ) : (
          <ProLock
            title="Demo trading is for Pro subscribers"
            text="Practise with 10 fake SOL at real prices: buy, sell half or all, and watch your PnL live — no real money at risk."
            onSubscribe={goSub}
          />
        )}
      </div>
      <div hidden={tab !== "sub"}>
        <Subscribe />
      </div>

      <footer className="muted small">Data: DexScreener · Helius RPC. Not financial advice — DYOR.</footer>
    </main>
  );
}

function ScanView({
  request,
  onSubscribe,
  onTrace,
}: {
  request: { ca: string; n: number; free?: string } | null;
  onSubscribe: () => void;
  onTrace: (address: string) => void;
}) {
  const pro = usePro();
  const [info, setInfo] = useState<TokenInfo | null | undefined>(undefined);
  const [extra, setExtra] = useState<TokenExtra | null>(null);
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
    setInfo(undefined);
    setExtra(null);
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
          placeholder="e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
          spellCheck={false}
          autoComplete="off"
        />
        <button disabled={loading || !ca.trim()}>{loading ? "Scanning…" : "Scan"}</button>
      </form>

      {error && <div className="alert danger">{error}</div>}
      {locked && (
        <div className="card locked-cta">
          <b>Scanning any CA is for ORBIT Pro subscribers</b>
          <span className="muted small">
            The free version opens the top 3 coins in Discover. Subscribe to scan any CA: holders, chart,
            narrative and the owner's latest posts.
          </span>
          <button className="copy primary" onClick={onSubscribe}>Subscribe — {PRICE_LABEL}</button>
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
                <Stat label="Price" value={usd(m.priceUsd)} sub={m.change24h != null ? `${m.change24h > 0 ? "+" : ""}${m.change24h}% 24h` : undefined} tone={m.change24h == null ? undefined : m.change24h >= 0 ? "up" : "down"} />
                <Stat label="Market cap" value={usd(m.marketCap ?? m.fdv)} sub={m.fdv ? `FDV ${usd(m.fdv)}` : undefined} />
                <Stat label="Liquidity" value={usd(m.liquidityUsd)} sub={`${m.pairCount} pairs · main ${m.dexId}`} />
                <Stat label="Volume 24h" value={usd(m.volume24h)} />
              </div>
            ) : (
              <p className="muted">{data.marketError ?? "No DexScreener pair for this token."}</p>
            )}
          </section>

          {pro ? (
            <>
              <Report
                key={"report-" + data.ca}
                ca={data.ca}
                market={m ?? null}
                holders={h ?? null}
                info={info}
                free={free}
                onExtra={setExtra}
              />
              {m && <DemoTrade key={"demo-" + data.ca} ca={data.ca} symbol={m.symbol} name={m.name} image={m.image} priceSol={m.priceSol} />}
            </>
          ) : (
            <ProLock
              title="ORBIT Report & Demo buy"
              text="0–100 safety score, how much the dev still holds, fresh/insider wallets among top holders, buy vs sell pressure, a copy-ready report — and demo-buy this coin with fake SOL."
              onSubscribe={onSubscribe}
            />
          )}

          <About key={"about-" + data.ca} ca={data.ca} free={free} onInfo={setInfo} />

          {m?.pairAddress && <Chart key={m.pairAddress} pool={m.pairAddress} token={data.ca} />}

          <section className="card">
            <div className="section-head">
              <h3>Top holders</h3>
              {h && (
                <span className="muted small">
                  Supply {num(h.supply)} · {h.scanned} largest accounts scanned
                </span>
              )}
            </div>

            {data.holdersError && <div className="alert danger">Holder: {data.holdersError}</div>}

            {h && (
              <>
                <div className={`alert ${h.warning ? "danger" : "ok"}`}>
                  <strong>Top 10 hold {h.top10Pct.toFixed(2)}% of supply</strong>
                  {h.warning
                    ? " — over 30%. Supply is concentrated, high dump risk."
                    : " — under the 30% limit, distribution looks OK."}
                  <div className="meter">
                    <div style={{ width: `${Math.min(h.top10Pct, 100)}%` }} />
                    <i style={{ left: "30%" }} />
                  </div>
                </div>

                <div className="badges">
                  <Badge ok={h.mintAuthority === null} yes="Mint authority revoked" no="Mint authority ACTIVE — dev can mint new tokens" />
                  <Badge ok={h.freezeAuthority === null} yes="Freeze authority revoked" no="Freeze authority ACTIVE — dev can freeze wallets" />
                </div>

                <p className="muted small" style={{ margin: "0 0 8px" }}>Tap a wallet to trace it: what it buys, sells & its PnL.</p>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Wallet</th>
                      <th className="r">Amount</th>
                      <th className="r">% supply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.holders.map((x) => (
                      <tr key={x.owner} className={x.rank <= 10 ? "top10" : undefined}>
                        <td>{x.rank}</td>
                        <td>
                          <button type="button" className="linkish" onClick={() => onTrace(x.owner)} title="Trace this wallet">
                            <span className="full">{x.owner}</span>
                            <span className="short">{short(x.owner)}</span>
                          </button>
                          {(() => {
                            const a = extra?.holders.find((y) => y.owner === x.owner);
                            if (info?.dev === x.owner) return <span className="flag dev">DEV</span>;
                            if (a?.flag === "baru") return <span className="flag">NEW {a.ageDays != null ? `${a.ageDays.toFixed(1)}d` : ""}</span>;
                            if (a?.flag === "senyap") return <span className="flag">SILENT {a.txCount}tx</span>;
                            return null;
                          })()}
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
                      {h.excluded.length} accounts filtered out (pool / bonding curve / program) —{" "}
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
