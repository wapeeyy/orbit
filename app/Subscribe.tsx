"use client";

import bs58 from "bs58";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./Copy";
import { api, getKey, keyExpiry, onKeyChange, setKey } from "./key";
import { ADMIN_WA_DISPLAY, adminWa } from "./contact";
import PlanCards from "./PlanCards";
import TelegramCard, { CommunityCard } from "./Telegram";
import { TrialCard, useTrial } from "./Trial";
import { trialKey } from "./trial";
import { PROMO_USD, TRIAL_ULTRA_USD } from "@/lib/trial";
import type { Billing, Tier } from "./plans";

type Config = {
  ready: boolean;
  txidClaims: boolean;
  wallet: string | null;
  priceRm: number;
  priceUsdc: number;
  priceSol: number | null;
  usdcMint: string;
  days: number;
  solUsd: number | null;
  plans?: Record<string, { tier: "pro" | "ultra"; usd: number; days: number; yearly: boolean }>;
  active: { exp: number; tier?: "pro" | "ultra"; trial?: boolean } | null;
  trials?: boolean;
};

const date = (t: number) => new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

export default function Subscribe() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKeyState] = useState<string | null>(null);
  const [renew, setRenew] = useState(false);
  const [pick, setPick] = useState<{ tier: Tier; billing: Billing }>({ tier: "pro", billing: "month" });

  const load = () => {
    const sent = getKey();
    return api("/api/subscribe")
      .then((r) => r.json())
      .then((j: Config) => {
        if (getKey() !== sent) return; // kod bertukar semasa menunggu — semakan baru akan menyusul
        setCfg(j);
        // Kod tamat atau tandatangan tak sah → buang dari browser
        if (sent && !j.active) setKey(null);
        setKeyState(j.active ? sent : null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    return onKeyChange(() => {
      load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exp = keyExpiry(key);
  const active = !!exp && exp > Date.now();
  const tier: Tier = active ? (cfg?.active?.tier ?? "pro") : "free";
  const tierName = tier === "ultra" ? "Ultra" : "Pro";
  const trial = useTrial();
  const promo = !active && trial.s === "offer";
  const inTrial = active && trial.s === "active" && !!cfg?.active?.trial;

  return (
    <section>
      {inTrial && (
        <div className="card trial-card offer">
          <span className="trial-eyebrow">Trial offer · ends with your trial</span>
          <h3>Ultra for a month — just ${TRIAL_ULTRA_USD}</h3>
          <p className="small muted">
            Upgrade during your free trial and get 30 days of ORBIT Ultra: whale trades on the chart, every timeframe at once,
            unlimited alerts. Normally $59. Once per wallet.
          </p>
          <button
            className="tier-btn ultra"
            onClick={() => {
              setPick({ tier: "ultra", billing: "month" });
              setRenew(true);
              setTimeout(() => document.querySelector(".card.pay")?.scrollIntoView({ behavior: "smooth" }), 80);
            }}
          >
            Get Ultra for ${TRIAL_ULTRA_USD}
          </button>
        </div>
      )}
      {promo && (
        <div className="card trial-card offer">
          <span className="trial-eyebrow">Your free trial has ended</span>
          <h3>Keep Pro for ${PROMO_USD} — first month</h3>
          <p className="small muted">Normally $23. This offer is for the next 48 hours only, once per wallet. Pay below.</p>
        </div>
      )}
      {!active && cfg?.trials && trial.s === "none" && <TrialCard onStarted={load} />}
      <PlanCards
        promo={promo}
        ultraOffer={inTrial}
        current={tier}
        onPick={(t, b) => {
          setPick({ tier: t, billing: b });
          setRenew(true);
          setTimeout(() => document.querySelector(".card.pay")?.scrollIntoView({ behavior: "smooth" }), 80);
        }}
      />
      <p className="muted small" style={{ textAlign: "center" }}>Pay with USDC or SOL (Solana). Access turns on automatically once the payment is confirmed.</p>

      {error && <div className="alert danger">{error}</div>}

      {active && key && (
        <div className="card">
          <div className="alert ok" style={{ marginBottom: 12 }}>
            {exp! > Date.UTC(2090, 0, 1) ? (
              <strong>Lifetime {tierName} access (complimentary)</strong>
            ) : (
              <>
                <strong>ORBIT {tierName} active until {date(exp!)}</strong> ({Math.ceil((exp! - Date.now()) / 86_400_000)} days left)
              </>
            )}
          </div>
          <span className="label">Your access code</span>
          <code className="keybox">{key}</code>
          <div className="buy" style={{ marginTop: 8 }}>
            <CopyButton text={key} label="Copy access code" className="primary" />
            <CopyButton text={`${location.origin}/?kod=${encodeURIComponent(key)}`} label="Copy activation link" />
            <button className="ghost" onClick={() => setRenew((v) => !v)}>
              {renew ? "Close" : "Extend"}
            </button>
          </div>
          <p className="muted small">
            Save this code (e.g. in Notes). On another phone: open the <b>activation link</b> once and you&apos;re {tierName}.
          </p>
        </div>
      )}

      {cfg && !cfg.ready && (
        <div className="alert danger">Payments are being set up. Please try again shortly.</div>
      )}

      {cfg?.ready && cfg.wallet && (!active || renew) && (
        <PayBox cfg={cfg} plan={inTrial && pick.tier === "ultra" && pick.billing === "month" ? "ultra-trial" : promo && pick.tier !== "ultra" && pick.billing === "month" ? "pro-promo" : `${pick.tier === "ultra" ? "ultra" : "pro"}-${pick.billing}`} onPaid={(k) => { setKey(k); setRenew(false); load(); }} />
      )}

      {!active && <RestoreKey onDone={load} />}

      {active && tier === "ultra" && <TelegramCard />}
      <CommunityCard />

      <a className="buy-link guide-link" href="/orbit-guide.pdf" target="_blank" rel="noreferrer">
        Guide: subscribe, pay &amp; install the app (PDF) ↗
      </a>
      <a className="buy-link guide-link" href={adminWa()} target="_blank" rel="noreferrer">
        Questions or payment issues? WhatsApp admin · {ADMIN_WA_DISPLAY}
      </a>

      <p className="muted small disclaimer">
        ORBIT is a data analysis tool, not financial advice or a signal service. Crypto is high risk — do your own research.
        Payments are non-refundable.
      </p>
    </section>
  );
}

const PAY_KEY = "orbit.pay.secret";

/** Payment session secret: kept in this browser until the payment is claimed */
function paySecret() {
  try {
    const s = localStorage.getItem(PAY_KEY);
    if (s) return s;
  } catch {}
  const s = bs58.encode(crypto.getRandomValues(new Uint8Array(32)));
  try {
    localStorage.setItem(PAY_KEY, s);
  } catch {}
  return s;
}

/** Same derivation as the server: sha256("orbit-ref:" + secret) → base58 */
async function refFromSecret(secret: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("orbit-ref:" + secret));
  return bs58.encode(new Uint8Array(d));
}

function PayBox({ cfg, plan, onPaid }: { cfg: Config; plan: string; onPaid: (key: string) => void }) {
  const p = cfg.plans?.[plan] ?? { tier: "pro" as const, usd: cfg.priceUsdc, days: cfg.days, yearly: false };
  const planName = `ORBIT ${p.tier === "ultra" ? "Ultra" : "Pro"} · ${plan === "pro-promo" || plan === "ultra-trial" ? "first month offer" : p.yearly ? "1 year" : `${p.days} days`}`;
  const solAmount = cfg.solUsd ? Math.ceil((p.usd / cfg.solUsd) * 10_000) / 10_000 : null;
  const [token, setToken] = useState<"USDC" | "SOL">("USDC");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState("");
  const secret = useMemo(() => paySecret(), []);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    refFromSecret(secret).then(setReference);
  }, [secret]);

  const amount = token === "USDC" ? p.usd.toFixed(2) : (solAmount ?? 0).toFixed(4);
  const url = reference
    ? `solana:${cfg.wallet}?amount=${amount}` +
      (token === "USDC" ? `&spl-token=${cfg.usdcMint}` : "") +
      `&reference=${reference}&label=ORBIT&message=${encodeURIComponent(planName)}`
    : null;

  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#07080d", light: "#ffffff" } }).then(setQr);
  }, [url]);

  const claim = async (body: object) => {
    const r = await api("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, j: await r.json() };
  };

  const done = (key: string) => {
    setStatus("✓ Payment received!");
    try {
      localStorage.removeItem(PAY_KEY); // next payment gets a fresh session
    } catch {}
    onPaid(key);
  };

  // Check automatically every 6 seconds while this page is open (QR / wallet button payments)
  useEffect(() => {
    let dead = false;
    const started = Date.now();
    const tick = async () => {
      if (dead || Date.now() - started > 30 * 60_000) return;
      try {
        const { ok, j } = await claim({ secret, plan, trial: plan === "pro-promo" || plan === "ultra-trial" ? trialKey() : undefined });
        if (dead) return;
        if (ok && j.key) return done(j.key);
        if (!ok && !j.pending) setStatus(j.error);
      } catch {}
      setTimeout(tick, 6000);
    };
    const t = setTimeout(tick, 1500);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, plan]);

  const verifySig = async () => {
    setBusy(true);
    setStatus("Checking transaction…");
    try {
      const { ok, j } = await claim({ signature: sig.trim(), plan, trial: plan === "pro-promo" || plan === "ultra-trial" ? trialKey() : undefined });
      if (ok && j.key) done(j.key);
      else setStatus(j.error ?? "Couldn't verify");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pay">
      <h3>Pay & activate</h3>
      <p className="pay-plan">{planName} — <b>${p.usd}</b></p>
      <div className="views" style={{ marginBottom: 14 }}>
        {(["USDC", "SOL"] as const).map((t) => (
          <button key={t} className={token === t ? "on" : ""} onClick={() => setToken(t)}>
            Pay {t}
          </button>
        ))}
      </div>

      <div className="pay-amount">
        <b>
          {amount} {token}
        </b>
        <span className="muted small">
          Solana network <b>only</b>
        </span>
      </div>

      <div className="pay-grid">
        <div className="qr">{qr && <img src={qr} alt="Solana Pay QR code" />}</div>
        <div className="pay-steps">
          <p className="small"><b>Pay with Phantom / Solflare</b></p>
          <p className="small muted">
            Scan the QR with your wallet app, or tap the button below on your phone. Keep this page open — your plan turns on by
            itself about 30 seconds after you pay.
          </p>
          {url && (
            <a className="buy-link wallet-btn" href={url}>
              Open wallet & pay
            </a>
          )}
        </div>
      </div>

      {cfg.txidClaims ? (
        <>
          <p className="small" style={{ marginTop: 16 }}>
            <b>Or send from an exchange / other wallet</b>
          </p>
          <p className="small muted">
            Send exactly <b>{amount} {token}</b> (<b>Solana</b> network) to this address, then paste the Transaction ID (TxID) below.
          </p>
          <code className="keybox">{cfg.wallet}</code>
          <div className="buy" style={{ margin: "8px 0 12px" }}>
            <CopyButton text={cfg.wallet!} label="Copy wallet address" className="primary" />
          </div>
          <div className="search" style={{ marginBottom: 8 }}>
            <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Paste Transaction ID / signature" spellCheck={false} />
            <button onClick={verifySig} disabled={busy || sig.trim().length < 80}>
              Verify
            </button>
          </div>
        </>
      ) : (
        <div className="tip-box">
          <b>Your crypto is on an exchange (Binance, Bybit, OKX…)?</b>
          <span className="small muted">
            Withdraw it to your own Phantom or Solflare wallet first (choose the <b>Solana</b> network), then pay with the QR /
            button above. Payments sent straight from an exchange can&apos;t be matched to you.
          </span>
          <span className="small muted">
            ORBIT receives at <code>{cfg.wallet!.slice(0, 4)}…{cfg.wallet!.slice(-4)}</code> — check your wallet shows the same before confirming.
          </span>
        </div>
      )}

      {status && <div className={`alert ${status.startsWith("✓") ? "ok" : "danger"}`}>{status}</div>}
      {status && !status.startsWith("✓") && status !== "Checking transaction…" && (
        <a
          className="buy-link"
          href={adminWa(`Hi ORBIT admin, I have a payment issue.\nTxID: ${sig.trim() || "-"}\nMessage: ${status}`)}
          target="_blank"
          rel="noreferrer"
          style={{ marginBottom: 12 }}
        >
          WhatsApp admin ({ADMIN_WA_DISPLAY})
        </a>
      )}
      <p className="muted small">
        {plan === "ultra-trial" ? "30 days of Ultra from the day you pay (replaces your trial)." : plan === "pro-promo" ? "One month of Pro at the trial price." : p.yearly ? "Yearly plan: 12 months of access." : "Pay more = longer access (e.g. 2× the price = 60 days, up to 12 months)."} Switching from Pro to Ultra
        starts a new Ultra code from the day you pay.
      </p>
    </div>
  );
}

function RestoreKey({ onDone }: { onDone: () => void }) {
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const check = async () => {
    const r = await fetch("/api/subscribe", { headers: { "x-orbit-key": val.trim() } });
    const j = await r.json();
    if (j.active) {
      setKey(val.trim());
      setMsg(null);
      onDone();
    } else setMsg("Invalid or expired code.");
  };
  return (
    <details className="card restore">
      <summary>Already subscribed? Enter your access code</summary>
      <div className="search" style={{ margin: "12px 0 0" }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Paste access code" spellCheck={false} />
        <button onClick={check} disabled={val.trim().length < 20}>
          Enter
        </button>
      </div>
      {msg && <div className="alert danger" style={{ marginTop: 10 }}>{msg}</div>}
    </details>
  );
}
