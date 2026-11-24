"use client";

import { useState } from "react";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback untuk browser lama / iOS dalam app
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export function CopyButton({ text, label = "Copy CA", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`copy ${done ? "done" : ""} ${className}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}

export function BuyLinks({ ca, pair }: { ca: string; pair?: string | null }) {
  const links = [
    { name: "Jupiter", href: `https://jup.ag/swap/SOL-${ca}` },
    { name: "GMGN", href: `https://gmgn.ai/sol/token/${ca}` },
    ...(pair ? [{ name: "Photon", href: `https://photon-sol.tinyastro.io/en/lp/${pair}` }] : []),
  ];
  return (
    <div className="buy">
      <CopyButton text={ca} className="primary" />
      {links.map((l) => (
        <a key={l.name} href={l.href} target="_blank" rel="noreferrer" className="buy-link">
          Buy on {l.name} ↗
        </a>
      ))}
    </div>
  );
}
