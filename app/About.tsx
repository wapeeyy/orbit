"use client";

import { useEffect, useState } from "react";
import type { TokenInfo, Activity } from "@/lib/info";
import { CopyButton } from "./Copy";

export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "baru sahaja";
  if (s < 3600) return `${Math.floor(s / 60)} minit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} hari lalu`;
  return `${Math.floor(s / (86400 * 30))} bulan lalu`;
}

function freshness(iso: string | null) {
  if (!iso) return { cls: "", label: "" };
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 24) return { cls: "ok", label: "Aktif" };
  if (h < 24 * 7) return { cls: "warn", label: "Kurang aktif" };
  return { cls: "bad", label: "Senyap" };
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export default function About({ ca }: { ca: string }) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let dead = false;
    setInfo(null);
    setError(null);
    fetch(`/api/info?ca=${ca}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (!dead) setInfo(j);
      })
      .catch((e) => !dead && setError(e.message));
    return () => {
      dead = true;
    };
  }, [ca]);

  return (
    <section className="card">
      <div className="section-head">
        <h3>Tentang coin</h3>
        {info?.launchpad && <span className="muted small">Dilancar di {info.launchpad}</span>}
      </div>

      {error && <div className="alert danger">Info: {error}</div>}
      {!info && !error && <p className="muted">Mencari naratif, link & aktiviti owner…</p>}

      {info && (
        <>
          <div className="narr">
            <span className="label">Naratif</span>
            <div className="tags">
              {(info.narratives.length ? info.narratives : ["Meme / umum"]).map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          </div>
          {info.description ? (
            <p className={`desc ${more ? "open" : ""}`} onClick={() => setMore((v) => !v)}>
              {info.description}
            </p>
          ) : (
            <p className="muted small">Dev tak tulis penerangan untuk coin ni.</p>
          )}

          <div className="links">
            {info.websites.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="buy-link">🌐 {host(u)}</a>
            ))}
            {info.twitter && (
              <a href={info.twitter} target="_blank" rel="noreferrer" className="buy-link">𝕏 X</a>
            )}
            {info.telegram && (
              <a href={info.telegram} target="_blank" rel="noreferrer" className="buy-link">✈️ Telegram</a>
            )}
            {info.others.map((o) => (
              <a key={o.url} href={o.url} target="_blank" rel="noreferrer" className="buy-link">{o.label}</a>
            ))}
            {!info.websites.length && !info.twitter && !info.telegram && !info.others.length && (
              <span className="alert danger small" style={{ margin: 0 }}>
                ⚠️ Tiada website, X atau Telegram — tanda merah untuk coin baru
              </span>
            )}
          </div>

          {info.activity.length > 0 && (
            <div className="activity">
              <span className="label">Post terakhir owner</span>
              {info.activity.map((a) => (
                <ActivityRow key={a.platform} a={a} />
              ))}
            </div>
          )}

          <div className="meta-row muted small">
            {info.holderCount != null && <span>{info.holderCount.toLocaleString("en-US")} holder</span>}
            {info.dev && (
              <span className="dev">
                Dev:{" "}
                <a href={`https://solscan.io/account/${info.dev}`} target="_blank" rel="noreferrer">
                  {info.dev.slice(0, 4)}…{info.dev.slice(-4)}
                </a>{" "}
                <CopyButton text={info.dev} label="Copy" />
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const f = freshness(a.lastPostAt);
  return (
    <a className="act" href={a.url} target="_blank" rel="noreferrer">
      <div className="act-head">
        <b>{a.platform === "x" ? "𝕏" : "✈️"} {a.platform === "x" ? "@" : ""}{a.handle}</b>
        {a.lastPostAt ? (
          <span className={`pill ${f.cls}`}>
            {f.label} · {ago(a.lastPostAt)}
          </span>
        ) : (
          <span className="pill">Tak dapat semak</span>
        )}
      </div>
      {a.lastText && <p className="act-text">“{a.lastText}”</p>}
      {a.note && <p className="muted small">{a.note}</p>}
      {a.lastPostAt && (
        <p className="muted small">
          {new Date(a.lastPostAt).toLocaleString("ms-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </a>
  );
}
