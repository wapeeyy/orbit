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
const ICON: Record<Level, string> = { ok: "✅", warn: "⚠️", bad: "🚩", info: "ℹ️" };

function analyse(m: Market | null, h: HolderReport | null, info: TokenInfo | null | undefined, x: TokenExtra | null) {
  let score = 100;
  const f: Finding[] = [];
  const hit = (n: number, level: Level, text: string) => {
    score -= n;
    f.push({ level, text });
  };

  if (h) {
    if (h.mintAuthority) hit(30, "bad", "Mint authority AKTIF — dev boleh cetak token baru");
    else f.push({ level: "ok", text: "Mint authority dah revoke" });
    if (h.freezeAuthority) hit(25, "bad", "Freeze authority AKTIF — dev boleh beku wallet pembeli");
    else f.push({ level: "ok", text: "Freeze authority dah revoke" });
    if (h.top10Pct > 50) hit(30, "bad", `Top 10 holder pegang ${h.top10Pct.toFixed(1)}% supply — sangat tertumpu`);
    else if (h.top10Pct > 30) hit(20, "warn", `Top 10 holder pegang ${h.top10Pct.toFixed(1)}% supply (> 30%)`);
    else f.push({ level: "ok", text: `Top 10 holder pegang ${h.top10Pct.toFixed(1)}% supply` });
    if (h.top1Pct > 10) hit(10, "warn", `Wallet terbesar pegang ${h.top1Pct.toFixed(1)}%`);
  }

  if (x?.dev) {
    if (x.dev.pct > 5) hit(10, "warn", `Dev masih pegang ${x.dev.pct.toFixed(2)}% — boleh dump bila-bila`);
    else if (x.dev.pct > 0) f.push({ level: "info", text: `Dev pegang ${x.dev.pct.toFixed(2)}%` });
    else f.push({ level: "info", text: "Dev dah tak pegang token ni (dah jual / pindah)" });
  }
  if (x && x.holders.length) {
    const baru = x.holders.filter((a) => a.flag === "baru").length;
    const senyap = x.holders.filter((a) => a.flag === "senyap").length;
    if (x.freshCount >= 3) hit(15, "bad", `${x.freshCount}/${x.holders.length} top holder ialah wallet baru/senyap — tanda insider atau bundle`);
    else if (x.freshCount > 0) hit(5, "warn", `${baru ? `${baru} wallet baru` : ""}${baru && senyap ? " + " : ""}${senyap ? `${senyap} wallet senyap` : ""} dalam top holder`);
    else f.push({ level: "ok", text: "Top holder bukan wallet baru" });
  }

  if (m) {
    const liqRatio = m.marketCap ? (m.liquidityUsd / m.marketCap) * 100 : null;
    if (liqRatio != null && liqRatio < 5) hit(10, "warn", `Liquidity cuma ${liqRatio.toFixed(1)}% dari MC — susah jual dalam jumlah besar`);
    else if (liqRatio != null) f.push({ level: "ok", text: `Liquidity ${liqRatio.toFixed(0)}% dari MC` });
    const ageH = m.createdAt ? (Date.now() - m.createdAt) / 3_600_000 : null;
    if (ageH != null && ageH < 1) hit(10, "warn", `Coin sangat baru (${Math.round(ageH * 60)} minit)`);
    const t = m.txns?.h1;
    if (t && t.buys + t.sells >= 20) {
      const r = t.buys / Math.max(1, t.sells);
      if (r < 0.67) hit(5, "warn", `Tekanan jual 1 jam: ${t.sells} jual vs ${t.buys} beli`);
      else if (r > 1.5) f.push({ level: "info", text: `Tekanan beli 1 jam: ${t.buys} beli vs ${t.sells} jual` });
    }
    if ((m.changes?.h24 ?? 0) < -70) hit(10, "bad", `Harga jatuh ${pct(m.changes?.h24)} dalam 24 jam — kemungkinan rug/dump`);
  }

  if (info) {
    const socials = info.websites.length + (info.twitter ? 1 : 0) + (info.telegram ? 1 : 0);
    if (socials === 0) hit(10, "warn", "Tiada website, X atau Telegram");
    const last = info.activity.map((a) => a.lastPostAt).filter(Boolean).sort().pop();
    if (last && Date.now() - Date.parse(last) > 7 * 86_400_000) hit(5, "warn", "Owner senyap lebih 7 hari di sosial");
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 75 ? { cls: "ok", text: "Risiko rendah" } : score >= 50 ? { cls: "warn", text: "Risiko sederhana" } : { cls: "bad", text: "Risiko tinggi" };
  return { score, grade, findings: f.sort((a, b) => ["bad", "warn", "info", "ok"].indexOf(a.level) - ["bad", "warn", "info", "ok"].indexOf(b.level)) };
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
  info: TokenInfo | null | undefined; // undefined = belum dimuat
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
    `🪐 Laporan ORBIT — ${m?.name ?? ""} ($${m?.symbol ?? ""})`,
    `CA: ${ca}`,
    `Skor keselamatan: ${a.score}/100 (${a.grade.text})`,
    m ? `Harga ${m.priceUsd ?? "—"} · MC ${usd(m.marketCap)} · Liq ${usd(m.liquidityUsd)} · Vol 24j ${usd(m.volume24h)}` : "",
    m?.changes ? `Perubahan: 5m ${pct(m.changes.m5)} · 1j ${pct(m.changes.h1)} · 6j ${pct(m.changes.h6)} · 24j ${pct(m.changes.h24)}` : "",
    holders ? `Top 10 holder: ${holders.top10Pct.toFixed(1)}%` : "",
    info?.narratives.length ? `Naratif: ${info.narratives.join(", ")}` : "",
    "",
    ...a.findings.map((x) => `${ICON[x.level]} ${x.text}`),
    "",
    "Bukan nasihat kewangan — DYOR.",
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
          <span className="label">Laporan ORBIT</span>
          <div className={`grade ${a.grade.cls}`}>{a.grade.text}</div>
          <span className="muted small">{loading ? "Menyemak dev & umur wallet top holder…" : "Skor dikira dari data on-chain & pasaran"}</span>
        </div>
      </div>

      {m?.txns && (
        <div className="pressure">
          {(["m5", "h1", "h6", "h24"] as const).map((w) => {
            const t = m.txns![w];
            const tot = t.buys + t.sells || 1;
            return (
              <div key={w}>
                <i>{w === "m5" ? "5m" : w === "h1" ? "1j" : w === "h6" ? "6j" : "24j"}</i>
                <b className={(m.changes?.[w] ?? 0) >= 0 ? "up-t" : "down-t"}>{pct(m.changes?.[w])}</b>
                <div className="bs-bar">
                  <span style={{ width: `${(t.buys / tot) * 100}%` }} />
                </div>
                <small className="muted">{t.buys} beli · {t.sells} jual</small>
              </div>
            );
          })}
        </div>
      )}

      <ul className="findings">
        {a.findings.map((x, i) => (
          <li key={i} className={x.level}>
            <span>{ICON[x.level]}</span>
            {x.text}
          </li>
        ))}
      </ul>

      {extra && extra.holders.some((h) => h.flag) && (
        <p className="muted small">
          Wallet baru = umur &lt; 3 hari · senyap = ≤ 5 transaksi seumur hidup. Selalunya wallet dev/insider yang dipecahkan.
        </p>
      )}

      <div className="buy">
        <CopyButton text={text} label="📋 Copy laporan" className="primary" />
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Skor ialah anggaran automatik — bukan jaminan coin selamat.</p>
    </section>
  );
}
