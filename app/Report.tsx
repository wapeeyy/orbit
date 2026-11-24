"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/lib/dex";
import type { HolderReport } from "@/lib/holders";
import type { TokenInfo } from "@/lib/info";
import type { TokenExtra } from "@/lib/report";
import { CopyButton } from "./Copy";
import { api } from "./key";

type Level = "ok" | "warn" | "bad" | "info";
type Finding = { level: Level; text: string };

const usd = (n: number | null | undefined) =>
  n == null ? "—" : "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n: number | undefined | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`);
const ICON: Record<Level, string> = { ok: "✓", warn: "!", bad: "✕", info: "·" };
const ORDER: Level[] = ["bad", "warn", "info", "ok"];

function analyse(m: Market | null, h: HolderReport | null, info: TokenInfo | null | undefined, x: TokenExtra | null) {
  let score = 100;
  const f: Finding[] = [];
  const hit = (n: number, level: Level, text: string) => {
    score -= n;
    f.push({ level, text });
  };

  if (h) {
    if (h.mintAuthority) hit(30, "bad", "Mint authority ACTIVE — the dev can mint new tokens");
    else f.push({ level: "ok", text: "Mint authority revoked" });
    if (h.freezeAuthority) hit(25, "bad", "Freeze authority ACTIVE — the dev can freeze buyers' wallets");
    else f.push({ level: "ok", text: "Freeze authority revoked" });
    if (h.top10Pct > 50) hit(30, "bad", `Top 10 holders own ${h.top10Pct.toFixed(1)}% of supply — very concentrated`);
    else if (h.top10Pct > 30) hit(20, "warn", `Top 10 holders own ${h.top10Pct.toFixed(1)}% of supply (> 30%)`);
    else f.push({ level: "ok", text: `Top 10 holders own ${h.top10Pct.toFixed(1)}% of supply` });
    if (h.top1Pct > 10) hit(10, "warn", `Largest wallet holds ${h.top1Pct.toFixed(1)}%`);
  }

  if (x?.dev) {
    if (x.dev.pct > 5) hit(10, "warn", `Dev still holds ${x.dev.pct.toFixed(2)}% — can dump at any time`);
    else if (x.dev.pct > 0) f.push({ level: "info", text: `Dev holds ${x.dev.pct.toFixed(2)}%` });
    else f.push({ level: "info", text: "Dev no longer holds this token (sold / moved)" });
  }
  if (x && x.holders.length) {
    const fresh = x.holders.filter((a) => a.flag === "baru").length;
    const silent = x.holders.filter((a) => a.flag === "senyap").length;
    if (x.freshCount >= 3) hit(15, "bad", `${x.freshCount}/${x.holders.length} top holders are new/silent wallets — sign of insiders or a bundle`);
    else if (x.freshCount > 0)
      hit(5, "warn", `${fresh ? `${fresh} new wallet${fresh > 1 ? "s" : ""}` : ""}${fresh && silent ? " + " : ""}${silent ? `${silent} silent wallet${silent > 1 ? "s" : ""}` : ""} among top holders`);
    else f.push({ level: "ok", text: "Top holders are not fresh wallets" });
  }

  if (m) {
    const liqRatio = m.marketCap ? (m.liquidityUsd / m.marketCap) * 100 : null;
    if (liqRatio != null && liqRatio < 5) hit(10, "warn", `Liquidity is only ${liqRatio.toFixed(1)}% of MC — hard to sell size`);
    else if (liqRatio != null) f.push({ level: "ok", text: `Liquidity is ${liqRatio.toFixed(0)}% of MC` });
    const ageH = m.createdAt ? (Date.now() - m.createdAt) / 3_600_000 : null;
    if (ageH != null && ageH < 1) hit(10, "warn", `Very new coin (${Math.round(ageH * 60)} minutes old)`);
    const t = m.txns?.h1;
    if (t && t.buys + t.sells >= 20) {
      const r = t.buys / Math.max(1, t.sells);
      if (r < 0.67) hit(5, "warn", `Sell pressure (1h): ${t.sells} sells vs ${t.buys} buys`);
      else if (r > 1.5) f.push({ level: "info", text: `Buy pressure (1h): ${t.buys} buys vs ${t.sells} sells` });
    }
    if ((m.changes?.h24 ?? 0) < -70) hit(10, "bad", `Price down ${pct(m.changes?.h24)} in 24h — possible rug/dump`);
  }

  if (info) {
    const socials = info.websites.length + (info.twitter ? 1 : 0) + (info.telegram ? 1 : 0);
    if (socials === 0) hit(10, "warn", "No website, X or Telegram");
    const last = info.activity.map((a) => a.lastPostAt).filter(Boolean).sort().pop();
    if (last && Date.now() - Date.parse(last) > 7 * 86_400_000) hit(5, "warn", "Owner silent on socials for 7+ days");
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 75 ? { cls: "ok", text: "Low risk" } : score >= 50 ? { cls: "warn", text: "Medium risk" } : { cls: "bad", text: "High risk" };
  return { score, grade, findings: f.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level)) };
}

export default function Report({
  ca,
  market,
  holders,
  info,
  free,
  onExtra,
}: {
  ca: string;
  market: Market | null;
  holders: HolderReport | null;
  info: TokenInfo | null | undefined; // undefined = still loading
  free?: string;
  onExtra?: (x: TokenExtra) => void;
}) {
  const [extra, setExtra] = useState<TokenExtra | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!holders || info === undefined) return;
    let dead = false;
    const owners = holders.holders.slice(0, 10).map((x) => x.owner).join(",");
    const q = `/api/report?ca=${ca}&owners=${owners}${info?.dev ? `&dev=${info.dev}` : ""}${free ? `&free=${free}` : ""}`;
    setLoading(true);
    api(q)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setExtra(j);
        onExtra?.(j);
      })
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ca, holders, info?.dev, free]);

  const a = analyse(market, holders, info, extra);
  const m = market;

  const text = [
    `ORBIT Report — ${m?.name ?? ""} ($${m?.symbol ?? ""})`,
    `CA: ${ca}`,
    `Safety score: ${a.score}/100 (${a.grade.text})`,
    m ? `Price ${m.priceUsd ?? "—"} · MC ${usd(m.marketCap)} · Liq ${usd(m.liquidityUsd)} · Vol 24h ${usd(m.volume24h)}` : "",
    m?.changes ? `Change: 5m ${pct(m.changes.m5)} · 1h ${pct(m.changes.h1)} · 6h ${pct(m.changes.h6)} · 24h ${pct(m.changes.h24)}` : "",
    holders ? `Top 10 holders: ${holders.top10Pct.toFixed(1)}%` : "",
    info?.narratives.length ? `Narrative: ${info.narratives.join(", ")}` : "",
    "",
    ...a.findings.map((x) => `${ICON[x.level]} ${x.text}`),
    "",
    "Not financial advice — DYOR.",
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");

  return (
    <section className="card report">
      <div className="report-head">
        <div className={`score ${a.grade.cls}`}>
          <b>{a.score}</b>
          <span>/100</span>
        </div>
        <div>
          <span className="label">ORBIT Report</span>
          <div className={`grade ${a.grade.cls}`}>{a.grade.text}</div>
          <span className="muted small">{loading ? "Checking dev & top-holder wallet ages…" : "Score based on on-chain & market data"}</span>
        </div>
      </div>

      {m?.txns && (
        <div className="pressure">
          {(["m5", "h1", "h6", "h24"] as const).map((w) => {
            const t = m.txns![w];
            const tot = t.buys + t.sells || 1;
            return (
              <div key={w}>
                <i>{w === "m5" ? "5m" : w === "h1" ? "1h" : w === "h6" ? "6h" : "24h"}</i>
                <b className={(m.changes?.[w] ?? 0) >= 0 ? "up-t" : "down-t"}>{pct(m.changes?.[w])}</b>
                <div className="bs-bar">
                  <span style={{ width: `${(t.buys / tot) * 100}%` }} />
                </div>
                <small className="muted">{t.buys} buys · {t.sells} sells</small>
              </div>
            );
          })}
        </div>
      )}

      <ul className="findings">
        {a.findings.map((x, i) => (
          <li key={i} className={x.level}>
            <span className={`fmark ${x.level}`} aria-hidden="true" />
            {x.text}
          </li>
        ))}
      </ul>

      {extra && extra.holders.some((h) => h.flag) && (
        <p className="muted small">
          New wallet = less than 3 days old · silent = 5 or fewer transactions ever. Often a dev/insider splitting supply.
        </p>
      )}

      <div className="buy">
        <CopyButton text={text} label="Copy report" className="primary" />
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>The score is an automatic estimate — not a guarantee the coin is safe.</p>
    </section>
  );
}
