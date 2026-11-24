"use client";

import { useEffect, useState } from "react";
import type { TokenInfo, Activity } from "@/lib/info";
import { CopyButton } from "./Copy";
import { api } from "./key";

export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))} mo ago`;
}

function freshness(iso: string | null) {
  if (!iso) return { cls: "", label: "" };
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 24) return { cls: "ok", label: "Active" };
  if (h < 24 * 7) return { cls: "warn", label: "Quiet" };
  return { cls: "bad", label: "Silent" };
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export default function About({ ca, free, onInfo }: { ca: string; free?: string; onInfo?: (i: TokenInfo | null) => void }) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let dead = false;
    setInfo(null);
    setError(null);
    api(`/api/info?ca=${ca}${free ? `&free=${free}` : ""}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (!dead) {
          setInfo(j);
          onInfo?.(j);
        }
      })
      .catch((e) => {
        if (dead) return;
        setError(e.message);
        onInfo?.(null);
      });
    return () => {
      dead = true;
    };
  }, [ca, free]);

  return (
    <section className="card">
      <div className="section-head">
        <h3>About this coin</h3>
        {info?.launchpad && <span className="muted small">Launched on {info.launchpad}</span>}
      </div>

      {error && <div className="alert danger">Info: {error}</div>}
      {!info && !error && <p className="muted">Looking up narrative, links & owner activity…</p>}

      {info && (
        <>
          <div className="narr">
            <span className="label">Narrative</span>
            <div className="tags">
              {(info.narratives.length ? info.narratives : ["Meme / general"]).map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          </div>
          {info.description ? (
            <p className={`desc ${more ? "open" : ""}`} onClick={() => setMore((v) => !v)}>
              {info.description}
            </p>
          ) : (
            <p className="muted small">The dev didn't write a description for this coin.</p>
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
                ⚠️ No website, X or Telegram — a red flag for a new coin
              </span>
            )}
          </div>

          {info.activity.length > 0 && (
            <div className="activity">
              <span className="label">Owner's latest posts</span>
              {info.activity.map((a) => (
                <ActivityRow key={a.platform} a={a} />
              ))}
            </div>
          )}

          <div className="meta-row muted small">
            {info.holderCount != null && <span>{info.holderCount.toLocaleString("en-US")} holders</span>}
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
          <span className="pill">Can't check</span>
        )}
      </div>
      {a.lastText && <p className="act-text">“{a.lastText}”</p>}
      {a.note && <p className="muted small">{a.note}</p>}
      {a.lastPostAt && (
        <p className="muted small">
          {new Date(a.lastPostAt).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </a>
  );
}
