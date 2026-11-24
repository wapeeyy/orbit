"use client";

import bs58 from "bs58";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./Copy";
import { api, getKey, keyExpiry, onKeyChange, setKey } from "./key";
import { ADMIN_WA_DISPLAY, adminWa } from "./contact";

type Config = {
  ready: boolean;
  wallet: string | null;
  priceRm: number;
  priceUsdc: number;
  priceSol: number | null;
  usdcMint: string;
  days: number;
  active: { exp: number } | null;
};

const date = (t: number) => new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

export default function Subscribe() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKeyState] = useState<string | null>(null);
  const [renew, setRenew] = useState(false);

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

  return (
    <section>
      <div className="card plan">
        <div className="plan-head">
          <div>
            <span className="label">ORBIT Pro</span>
            <div className="price">
              ${cfg?.priceUsdc ?? 23}
              <small> / {cfg?.days ?? 30} days</small>
            </div>
          </div>
          {active && <span className="pill ok">✓ Active</span>}
        </div>
        <ul className="perks">
          <li>Every coin that passes the filters (not just 3)</li>
          <li>🎯 Near volume zone list</li>
          <li>Scan any CA: holders, chart, narrative, owner's latest posts</li>
          <li>Filters you can tune to your trading style</li>
          <li>📋 ORBIT Report: safety score, dev & insider wallets</li>
          <li>👛 Wallet tracing: buys/sells, PnL, win rate</li>
          <li>🎮 Demo trading with 10 fake SOL</li>
        </ul>
        <p className="muted small">Pay with USDC or SOL (Solana). Access turns on automatically once the payment is confirmed.</p>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {active && key && (
        <div className="card">
          <div className="alert ok" style={{ marginBottom: 12 }}>
            {exp! > Date.UTC(2090, 0, 1) ? (
              <strong>Lifetime Pro access (complimentary)</strong>
            ) : (
              <>
                <strong>Subscription active until {date(exp!)}</strong> ({Math.ceil((exp! - Date.now()) / 86_400_000)} days left)
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
            Save this code (e.g. in Notes). On another phone: open the <b>activation link</b> once and you're Pro.
          </p>
        </div>
      )}

      {cfg && !cfg.ready && (
        <div className="alert danger">Payments are being set up. Please try again shortly.</div>
      )}

      {cfg?.ready && cfg.wallet && (!active || renew) && (
        <PayBox cfg={cfg} onPaid={(k) => { setKey(k); setRenew(false); load(); }} />
      )}

      {!active && <RestoreKey onDone={load} />}

      <a className="buy-link guide-link" href="/orbit-guide.pdf" target="_blank" rel="noreferrer">
        📄 Guide: subscribe, pay &amp; install the app (PDF)
      </a>
      <a className="buy-link guide-link" href={adminWa()} target="_blank" rel="noreferrer">
        💬 Questions or payment issues? WhatsApp admin · {ADMIN_WA_DISPLAY}
      </a>

      <p className="muted small disclaimer">
        ORBIT is a data analysis tool, not financial advice or a signal service. Crypto is high risk — do your own research.
        Payments are non-refundable.
      </p>
    </section>
  );
}

function PayBox({ cfg, onPaid }: { cfg: Config; onPaid: (key: string) => void }) {
  const [token, setToken] = useState<"USDC" | "SOL">("USDC");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState("");
  const reference = useMemo(() => bs58.encode(crypto.getRandomValues(new Uint8Array(32))), []);

  const amount = token === "USDC" ? cfg.priceUsdc.toFixed(2) : (cfg.priceSol ?? 0).toFixed(4);
  const url =
    `solana:${cfg.wallet}?amount=${amount}` +
    (token === "USDC" ? `&spl-token=${cfg.usdcMint}` : "") +
    `&reference=${reference}&label=ORBIT&message=${encodeURIComponent(`ORBIT subscription ${cfg.days} days`)}`;

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#07080d", light: "#ffffff" } }).then(setQr);
  }, [url]);

  const claim = async (body: object) => {
    const r = await api("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, j: await r.json() };
  };

  // Semak automatik setiap 6 saat (bayaran melalui QR / butang wallet) — 20 minit
  useEffect(() => {
    let dead = false;
    const started = Date.now();
    const tick = async () => {
      if (dead || Date.now() - started > 20 * 60_000) return;
      try {
        const { ok, j } = await claim({ reference });
        if (dead) return;
        if (ok && j.key) {
          setStatus("✓ Payment received!");
          onPaid(j.key);
          return;
        }
        if (!ok && !j.pending) setStatus(j.error);
      } catch {}
      setTimeout(tick, 6000);
    };
    const t = setTimeout(tick, 6000);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  const verifySig = async () => {
    setBusy(true);
    setStatus("Checking transaction…");
    try {
      const { ok, j } = await claim({ signature: sig.trim() });
      if (ok && j.key) {
        setStatus("✓ Payment received!");
        onPaid(j.key);
      } else setStatus(j.error ?? "Couldn't verify");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pay">
      <h3>Pay & activate</h3>
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
        <div className="qr">{qr && <img src={qr} alt="QR bayaran Solana Pay" />}</div>
        <div className="pay-steps">
          <p className="small"><b>Option 1 — Phantom / Solflare (easiest)</b></p>
          <p className="small muted">Scan the QR with your wallet, or tap the button below on your phone. Access turns on by itself in ~30 seconds.</p>
          <a className="buy-link wallet-btn" href={url}>
            Open wallet & pay
          </a>
        </div>
      </div>

      <p className="small" style={{ marginTop: 16 }}>
        <b>Option 2 — Send from an exchange / other wallet</b>
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
      {status && <div className={`alert ${status.startsWith("✓") ? "ok" : "danger"}`}>{status}</div>}
      {status && !status.startsWith("✓") && status !== "Checking transaction…" && (
        <a
          className="buy-link"
          href={adminWa(`Hi ORBIT admin, I have a payment issue.\nTxID: ${sig.trim() || "-"}\nMessage: ${status}`)}
          target="_blank"
          rel="noreferrer"
          style={{ marginBottom: 12 }}
        >
          💬 WhatsApp admin ({ADMIN_WA_DISPLAY})
        </a>
      )}
      <p className="muted small">Pay more = longer access (e.g. 2× the price = 60 days, up to 12 months).</p>
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
