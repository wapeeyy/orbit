"use client";

import { useEffect, useState } from "react";
import { PROMO_USD, TRIAL_DAYS } from "@/lib/trial";
import { startTrial, trialState, walletLinks } from "./trial";
import { onKeyChange } from "./key";

export function useTrial() {
  const [st, setSt] = useState<ReturnType<typeof trialState>>({ s: "none" });
  useEffect(() => {
    const sync = () => setSt(trialState());
    sync();
    const iv = setInterval(sync, 60_000);
    const off = onKeyChange(sync);
    return () => {
      clearInterval(iv);
      off();
    };
  }, []);
  return st;
}

const left = (ms: number) => {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60_000))} min`;
};

/** Start-trial card on the Subscribe page */
export function TrialCard({ onStarted }: { onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [noWallet, setNoWallet] = useState(false);
  const go = async () => {
    setBusy(true);
    setMsg(null);
    const r = await startTrial();
    setBusy(false);
    if (r.ok) return onStarted();
    if (r.error === "no-wallet") return setNoWallet(true);
    setMsg(r.error);
  };
  const links = noWallet ? walletLinks() : null;
  return (
    <div className="card trial-card">
      <span className="trial-eyebrow">Free for {TRIAL_DAYS} days</span>
      <h3>Try ORBIT Pro free</h3>
      <p className="small muted">
        Every Pro feature for {TRIAL_DAYS} days — no payment. Connect your Solana wallet and sign a message to prove it&apos;s
        yours (signing is free and moves no funds). One trial per wallet.
      </p>
      {!links ? (
        <button className="tier-btn pro" onClick={go} disabled={busy}>
          {busy ? "Check your wallet…" : `Start ${TRIAL_DAYS}-day free trial`}
        </button>
      ) : (
        <div className="trial-wallets">
          <p className="small">No wallet found in this browser. Open ORBIT inside your wallet app:</p>
          <a className="buy-link" href={links.phantom}>Open in Phantom</a>
          <a className="buy-link" href={links.solflare}>Open in Solflare</a>
          <p className="small muted">After the trial starts there, copy your activation link (Subscribe tab) to use Pro in Safari / Chrome too.</p>
        </div>
      )}
      {msg && <div className="alert danger" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

/** Thin banner on every tab: trial days left, or the after-trial offer */
export function TrialBanner({ onSubscribe }: { onSubscribe: () => void }) {
  const st = useTrial();
  if (st.s === "active")
    return (
      <div className="trial-banner" onClick={onSubscribe}>
        <span>⭐ Pro trial · <b>{left(st.exp - Date.now())} left</b></span>
        <span className="trial-cta">Keep Pro →</span>
      </div>
    );
  if (st.s === "offer")
    return (
      <div className="trial-banner offer" onClick={onSubscribe}>
        <span>Your trial ended · <b>Pro ${PROMO_USD} for the first month</b> · {left(st.until - Date.now())} left</span>
        <span className="trial-cta">Claim →</span>
      </div>
    );
  return null;
}
