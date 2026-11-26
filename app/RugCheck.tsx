"use client";

import { useEffect, useState } from "react";

// Pro: can you actually sell? Round-trip quote through Jupiter (buy 0.1 SOL, then sell what you got)
// + RugCheck risk summary (authorities, LP lock, concentration, Token-2022 tricks).
const SOL = "So11111111111111111111111111111111111111112";
const TEST_LAMPORTS = 100_000_000; // 0.1 SOL

type Risk = { name: string; value?: string; description?: string; level: "danger" | "warn" | "info" | string };
type Summary = { risks?: Risk[]; score_normalised?: number; lpLockedPct?: number; tokenProgram?: string };
type Trip = { ok: true; lossPct: number; impactPct: number; route: string } | { ok: false; reason: string };

async function quote(input: string, output: string, amount: string) {
  const r = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=1000&restrictIntermediateTokens=true`);
  const j = await r.json();
  if (!r.ok || !j.outAmount) throw new Error(j.error || j.errorCode || `Jupiter ${r.status}`);
  return j as { outAmount: string; priceImpactPct: string; routePlan: { swapInfo: { label: string } }[] };
}

async function roundTrip(ca: string): Promise<Trip> {
  try {
    const buy = await quote(SOL, ca, String(TEST_LAMPORTS));
    try {
      const sell = await quote(ca, SOL, buy.outAmount);
      const back = Number(sell.outAmount);
      return {
        ok: true,
        lossPct: Math.max(0, (1 - back / TEST_LAMPORTS) * 100),
        impactPct: (Number(buy.priceImpactPct) + Number(sell.priceImpactPct)) * 100,
        route: [...new Set([...buy.routePlan, ...sell.routePlan].map((r) => r.swapInfo.label))].join(", "),
      };
    } catch (e) {
      return { ok: false, reason: `No sell route found (${(e as Error).message}). This can be a honeypot.` };
    }
  } catch (e) {
    return { ok: false, reason: `Can't quote a buy (${(e as Error).message}).` };
  }
}

export default function RugCheck({ ca }: { ca: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [sum, setSum] = useState<Summary | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    setTrip(null);
    setSum(undefined);
    roundTrip(ca).then((t) => !dead && setTrip(t));
    fetch(`https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !dead && setSum(j))
      .catch(() => !dead && setSum(null));
    return () => {
      dead = true;
    };
  }, [ca]);

  const danger = (sum?.risks ?? []).filter((r) => r.level === "danger");
  const warns = (sum?.risks ?? []).filter((r) => r.level === "warn");
  const honeypot = trip && !trip.ok;
  const taxy = trip?.ok && trip.lossPct > 15;
  const verdict = honeypot ? "bad" : taxy || danger.length ? "warn" : trip && sum !== undefined ? "ok" : "wait";
  const title =
    verdict === "bad" ? "Sell may be blocked" : verdict === "warn" ? "Sellable — with risks" : verdict === "ok" ? "Sellable · no major red flags" : "Checking…";

  return (
    <section className={`card rugcheck ${verdict}`}>
      <div className="section-head">
        <h3>Rug & honeypot check</h3>
        <span className={`rc-verdict ${verdict}`}>{title}</span>
      </div>
      <div className="rc-grid">
        <div className="rc-cell">
          <span className="label">Test trade (0.1 SOL in → out)</span>
          {!trip ? (
            <span className="muted small">Quoting through Jupiter…</span>
          ) : trip.ok ? (
            <>
              <b className={trip.lossPct > 15 ? "down" : trip.lossPct > 5 ? "warn" : "up"}>{trip.lossPct.toFixed(1)}% lost round-trip</b>
              <span className="muted small">
                Fees, tax and price impact together{trip.impactPct > 0.05 ? ` · impact ${trip.impactPct.toFixed(1)}%` : ""} · via {trip.route}
              </span>
            </>
          ) : (
            <>
              <b className="down">Can&apos;t sell</b>
              <span className="muted small">{trip.reason}</span>
            </>
          )}
        </div>
        <div className="rc-cell">
          <span className="label">Liquidity locked / burned</span>
          {sum === undefined ? (
            <span className="muted small">Loading…</span>
          ) : sum?.lpLockedPct != null ? (
            <>
              <b className={sum.lpLockedPct >= 90 ? "up" : sum.lpLockedPct >= 50 ? "warn" : "down"}>{sum.lpLockedPct.toFixed(0)}%</b>
              <span className="muted small">{sum.lpLockedPct >= 90 ? "Pool can't be pulled" : "Part of the pool can still be removed (bonding-curve / AMM pools often show 0%)"}</span>
            </>
          ) : (
            <span className="muted small">Not available</span>
          )}
        </div>
      </div>
      {sum && (danger.length > 0 || warns.length > 0) && (
        <ul className="rc-risks">
          {[...danger, ...warns].slice(0, 8).map((r) => (
            <li key={r.name} className={r.level}>
              <b>{r.name}</b>
              {r.value ? ` · ${r.value}` : ""}
              {r.description ? <span className="muted small"> — {r.description}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {sum && !danger.length && !warns.length && <p className="muted small">No risks flagged by RugCheck.</p>}
      <p className="muted small">Sources: Jupiter quotes, RugCheck. A quote is a simulation, not a guarantee.</p>
    </section>
  );
}
