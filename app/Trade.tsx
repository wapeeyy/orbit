"use client";

import { useEffect, useState } from "react";
import { api } from "./key";
import { walletLinks, walletProvider } from "./trial";

// Ultra: buy / sell this coin from the user's own wallet through Jupiter.
// ORBIT never holds funds or keys — Jupiter builds the swap, the wallet app signs and sends it.
const SOL = "So11111111111111111111111111111111111111112";
type Quote = { inAmount: string; outAmount: string; priceImpactPct: string; routePlan: { swapInfo: { label: string } }[] };
type Prov = ReturnType<typeof walletProvider> & { signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string> };

const BUYS = [0.1, 0.25, 0.5, 1];
const SELLS = [25, 50, 100];
const SLIPS = [100, 300, 1000];

export default function Trade({ ca, symbol, decimals }: { ca: string; symbol: string; decimals: number }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState(0.1); // SOL for buys, % for sells
  const [slip, setSlip] = useState(300);
  const [owner, setOwner] = useState<string | null>(null);
  const [bal, setBal] = useState<{ sol: number; token: { raw: string; ui: number } } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [noWallet, setNoWallet] = useState(false);

  const refreshBal = (o = owner) =>
    o &&
    api(`/api/balance?owner=${o}&mint=${ca}`)
      .then((r) => r.json())
      .then((j) => !j.error && setBal(j))
      .catch(() => {});

  async function connect() {
    const p = walletProvider();
    if (!p) return setNoWallet(true);
    try {
      const c = await p.connect();
      const pk = (c && "publicKey" in c ? c.publicKey : p.publicKey)?.toString() ?? null;
      setOwner(pk);
      refreshBal(pk);
    } catch {
      setMsg({ ok: false, text: "Connection cancelled in the wallet." });
    }
  }

  const amountRaw = () => {
    if (side === "buy") return String(Math.round(amt * 1e9));
    if (!bal) return "0";
    return ((BigInt(bal.token.raw) * BigInt(amt)) / 100n).toString();
  };

  useEffect(() => {
    setQuote(null);
    const raw = amountRaw();
    if (raw === "0") return;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const [i, o] = side === "buy" ? [SOL, ca] : [ca, SOL];
        const r = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${i}&outputMint=${o}&amount=${raw}&slippageBps=${slip}`);
        const j = await r.json();
        if (!dead) j.outAmount ? setQuote(j) : setMsg({ ok: false, text: j.error ?? "No route for this trade." });
      } catch {
        if (!dead) setMsg({ ok: false, text: "Couldn't get a quote." });
      }
    }, 350);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, amt, slip, bal, ca]);

  async function swap() {
    if (!quote || !owner) return;
    const p = walletProvider() as Prov | null;
    if (!p?.signAndSendTransaction) return setMsg({ ok: false, text: "This wallet can't send transactions from here. Try Phantom or Solflare." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteResponse: quote, userPublicKey: owner, dynamicComputeUnitLimit: true, dynamicSlippage: true, prioritizationFeeLamports: "auto" }),
      });
      const j = await r.json();
      if (!j.swapTransaction) throw new Error(j.error ?? "Jupiter couldn't build the swap");
      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(j.swapTransaction), (c) => c.charCodeAt(0)));
      const res = await p.signAndSendTransaction(tx);
      const sig = typeof res === "string" ? res : res.signature;
      setMsg({ ok: true, text: "Sent. It usually lands within a few seconds.", sig });
      setTimeout(() => refreshBal(), 8000);
    } catch (e) {
      const m = (e as Error).message ?? "";
      setMsg({ ok: false, text: /reject|cancel|denied/i.test(m) ? "Cancelled in the wallet." : m || "Swap failed." });
    }
    setBusy(false);
  }

  const outUi = quote ? Number(quote.outAmount) / (side === "buy" ? 10 ** decimals : 1e9) : null;
  const impact = quote ? Number(quote.priceImpactPct) * 100 : 0;
  const links = noWallet ? walletLinks() : null;

  return (
    <section className="card trade">
      <div className="section-head">
        <h3>Trade ${symbol}</h3>
        <span className="tier-tag ultra">Ultra</span>
      </div>
      {!owner ? (
        links ? (
          <div className="trial-wallets">
            <p className="small">No wallet in this browser. Open ORBIT inside your wallet app to trade:</p>
            <a className="buy-link" href={links.phantom}>Open in Phantom</a>
            <a className="buy-link" href={links.solflare}>Open in Solflare</a>
          </div>
        ) : (
          <button className="tier-btn ultra" onClick={connect}>Connect wallet to trade</button>
        )
      ) : (
        <>
          <div className="views" style={{ marginBottom: 10 }}>
            <button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(0.1); }}>Buy</button>
            <button className={side === "sell" ? "on" : ""} onClick={() => { setSide("sell"); setAmt(50); }}>Sell</button>
          </div>
          <div className="trade-chips">
            {(side === "buy" ? BUYS : SELLS).map((v) => (
              <button key={v} className={amt === v ? "on" : ""} onClick={() => setAmt(v)}>
                {side === "buy" ? `${v} SOL` : `${v}%`}
              </button>
            ))}
          </div>
          <div className="trade-meta small muted">
            <span>
              Wallet {owner.slice(0, 4)}…{owner.slice(-4)} · {bal ? `${bal.sol.toFixed(3)} SOL · ${bal.token.ui.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}` : "loading balance…"}
            </span>
            <span>
              Slippage{" "}
              {SLIPS.map((s) => (
                <button key={s} className={`slip ${slip === s ? "on" : ""}`} onClick={() => setSlip(s)}>{s / 100}%</button>
              ))}
            </span>
          </div>
          <div className="trade-quote">
            {quote ? (
              <>
                <span>You get ≈ <b>{outUi!.toLocaleString("en-US", { maximumFractionDigits: side === "buy" ? 2 : 4 })} {side === "buy" ? symbol : "SOL"}</b></span>
                <span className={`small ${impact > 5 ? "down" : "muted"}`}>Price impact {impact.toFixed(2)}% · via {[...new Set(quote.routePlan.map((r) => r.swapInfo.label))].join(", ")}</span>
              </>
            ) : (
              <span className="muted small">{side === "sell" && bal && bal.token.raw === "0" ? `You don't hold ${symbol}.` : "Getting the best route…"}</span>
            )}
          </div>
          <button className={`tier-btn ${side === "buy" ? "pro" : "ultra"}`} disabled={!quote || busy} onClick={swap}>
            {busy ? "Confirm in your wallet…" : side === "buy" ? `Buy ${symbol}` : `Sell ${amt}% of ${symbol}`}
          </button>
        </>
      )}
      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "danger"}`} style={{ marginTop: 10 }}>
          {msg.text}{" "}
          {msg.sig && (
            <a href={`https://solscan.io/tx/${msg.sig}`} target="_blank" rel="noreferrer">View on Solscan ↗</a>
          )}
        </div>
      )}
      <p className="muted small">You sign every trade in your own wallet — ORBIT never holds your funds or keys. Routing by Jupiter. Memecoins are high risk.</p>
    </section>
  );
}
