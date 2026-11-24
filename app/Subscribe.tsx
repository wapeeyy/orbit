"use client";

import bs58 from "bs58";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./Copy";
import { api, getKey, keyExpiry, setKey } from "./key";
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

const date = (t: number) => new Date(t).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" });

export default function Subscribe() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKeyState] = useState<string | null>(null);
  const [renew, setRenew] = useState(false);

  const load = () =>
    api("/api/subscribe")
      .then((r) => r.json())
      .then((j: Config) => {
        setCfg(j);
        const k = getKey();
        // Kod tamat atau tandatangan tak sah → buang dari browser
        if (k && !j.active) setKey(null);
        setKeyState(j.active ? k : null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
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
              RM{cfg?.priceRm ?? 100}
              <small> / {cfg?.days ?? 30} hari</small>
            </div>
          </div>
          {active && <span className="pill ok">✓ Aktif</span>}
        </div>
        <ul className="perks">
          <li>Semua coin yang lulus penapis (bukan 3 sahaja)</li>
          <li>Senarai 🎯 Dekat zon volume</li>
          <li>Scan mana-mana CA: holder, chart, naratif, post terakhir owner</li>
          <li>Penapis boleh ubah ikut gaya trading kau</li>
        </ul>
        <p className="muted small">Bayar guna USDC atau SOL (Solana). Akses aktif automatik sebaik bayaran disahkan.</p>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {active && key && (
        <div className="card">
          <div className="alert ok" style={{ marginBottom: 12 }}>
            {exp! > Date.UTC(2090, 0, 1) ? (
              <strong>Akses Pro seumur hidup (percuma)</strong>
            ) : (
              <>
                <strong>Langganan aktif sampai {date(exp!)}</strong> ({Math.ceil((exp! - Date.now()) / 86_400_000)} hari lagi)
              </>
            )}
          </div>
          <span className="label">Kod akses kau</span>
          <code className="keybox">{key}</code>
          <div className="buy" style={{ marginTop: 8 }}>
            <CopyButton text={key} label="Copy kod akses" className="primary" />
            <button className="ghost" onClick={() => setRenew((v) => !v)}>
              {renew ? "Tutup" : "Sambung tempoh"}
            </button>
          </div>
          <p className="muted small">
            Simpan kod ni (contoh dalam Notes). Guna untuk buka ORBIT di phone lain atau kalau data browser terpadam.
          </p>
        </div>
      )}

      {cfg && !cfg.ready && (
        <div className="alert danger">Sistem bayaran sedang disediakan. Cuba lagi sekejap lagi.</div>
      )}

      {cfg?.ready && cfg.wallet && (!active || renew) && (
        <PayBox cfg={cfg} onPaid={(k) => { setKey(k); setRenew(false); load(); }} />
      )}

      {!active && <RestoreKey onDone={load} />}

      <a className="buy-link guide-link" href="/panduan-orbit.pdf" target="_blank" rel="noreferrer">
        📄 Panduan daftar, bayar &amp; install app (PDF)
      </a>
      <a className="buy-link guide-link" href={adminWa()} target="_blank" rel="noreferrer">
        💬 Ada soalan atau masalah bayaran? WhatsApp admin · {ADMIN_WA_DISPLAY}
      </a>

      <p className="muted small disclaimer">
        ORBIT ialah alat analisis data, bukan nasihat kewangan atau signal. Crypto berisiko tinggi — buat kajian sendiri.
        Bayaran tidak dikembalikan.
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
    `&reference=${reference}&label=ORBIT&message=${encodeURIComponent(`Langganan ORBIT ${cfg.days} hari`)}`;

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
          setStatus("✓ Bayaran diterima!");
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
    setStatus("Menyemak transaksi…");
    try {
      const { ok, j } = await claim({ signature: sig.trim() });
      if (ok && j.key) {
        setStatus("✓ Bayaran diterima!");
        onPaid(j.key);
      } else setStatus(j.error ?? "Gagal disahkan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pay">
      <h3>Bayar & aktifkan</h3>
      <div className="views" style={{ marginBottom: 14 }}>
        {(["USDC", "SOL"] as const).map((t) => (
          <button key={t} className={token === t ? "on" : ""} onClick={() => setToken(t)}>
            Bayar {t}
          </button>
        ))}
      </div>

      <div className="pay-amount">
        <b>
          {amount} {token}
        </b>
        <span className="muted small">
          ≈ RM{cfg.priceRm} · rangkaian <b>Solana</b> sahaja
        </span>
      </div>

      <div className="pay-grid">
        <div className="qr">{qr && <img src={qr} alt="QR bayaran Solana Pay" />}</div>
        <div className="pay-steps">
          <p className="small"><b>Cara 1 — Phantom / Solflare (paling senang)</b></p>
          <p className="small muted">Scan QR dengan wallet, atau tekan butang di bawah dalam phone. Akses aktif sendiri dalam ~30 saat.</p>
          <a className="buy-link wallet-btn" href={url}>
            Buka wallet & bayar
          </a>
        </div>
      </div>

      <p className="small" style={{ marginTop: 16 }}>
        <b>Cara 2 — Hantar dari exchange / wallet lain</b>
      </p>
      <p className="small muted">
        Hantar tepat <b>{amount} {token}</b> (network <b>Solana</b>) ke alamat ni, kemudian paste Transaction ID (TxID) di bawah.
      </p>
      <code className="keybox">{cfg.wallet}</code>
      <div className="buy" style={{ margin: "8px 0 12px" }}>
        <CopyButton text={cfg.wallet!} label="Copy alamat wallet" className="primary" />
      </div>
      <div className="search" style={{ marginBottom: 8 }}>
        <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Paste Transaction ID / signature" spellCheck={false} />
        <button onClick={verifySig} disabled={busy || sig.trim().length < 80}>
          Sahkan
        </button>
      </div>
      {status && <div className={`alert ${status.startsWith("✓") ? "ok" : "danger"}`}>{status}</div>}
      {status && !status.startsWith("✓") && status !== "Menyemak transaksi…" && (
        <a
          className="buy-link"
          href={adminWa(`Hai admin ORBIT, bayaran saya bermasalah.\nTxID: ${sig.trim() || "-"}\nMesej: ${status}`)}
          target="_blank"
          rel="noreferrer"
          style={{ marginBottom: 12 }}
        >
          💬 WhatsApp admin ({ADMIN_WA_DISPLAY})
        </a>
      )}
      <p className="muted small">Bayar lebih = tempoh lebih (contoh: 2× harga = 60 hari, maksimum 12 bulan).</p>
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
    } else setMsg("Kod tak sah atau dah tamat.");
  };
  return (
    <details className="card restore">
      <summary>Dah langgan? Masukkan kod akses</summary>
      <div className="search" style={{ margin: "12px 0 0" }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Paste kod akses" spellCheck={false} />
        <button onClick={check} disabled={val.trim().length < 20}>
          Masuk
        </button>
      </div>
      {msg && <div className="alert danger" style={{ marginTop: 10 }}>{msg}</div>}
    </details>
  );
}
