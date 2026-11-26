"use client";

import { useEffect, useState } from "react";
import { useTrial } from "./Trial";

// Free-trial calls to action used across the app (hero, sticky header, under the table, coin pages, locked features).

/** "Start Free 7-Day Trial" while the trial is still available, otherwise the plan button */
export function useCtaLabel(long: boolean | "short" = true) {
  const t = useTrial();
  if (long === "short") return t.s === "none" ? "Free 7-day trial" : t.s === "offer" ? "Pro $10" : "Get Pro";
  return t.s === "none" ? (long ? "Start Free 7-Day Pro Trial" : "Start Free 7-Day Trial") : t.s === "offer" ? "Keep Pro — $10 first month" : "Get ORBIT Pro";
}

export function TrialButton({ onClick, size = "lg", long = true }: { onClick: () => void; size?: "lg" | "sm"; long?: boolean | "short" }) {
  const label = useCtaLabel(long);
  return (
    <button type="button" className={`trial-cta-btn ${size}`} onClick={onClick}>
      {label}
    </button>
  );
}

/** Above-the-fold hero for visitors without Pro */
export function Hero({ onTrial }: { onTrial: () => void }) {
  return (
    <div className="hero">
      <h1 className="hero-title">Solana Coin Intelligence</h1>
      <p className="hero-sub">Rug checks, smart money tracking, and clear reads on any coin. Free for 7 days.</p>
      <TrialButton onClick={onTrial} />
      <p className="hero-note">No credit card required. Just connect your wallet.</p>
      <p className="hero-proof">Early users are already using ORBIT to avoid rugs, track smart money, and get clear reads on trending coins.</p>
    </div>
  );
}

/** Slim bar that slides in once the hero has scrolled away */
export function StickyCta({ onTrial }: { onTrial: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 420);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className={`sticky-cta ${show ? "on" : ""}`} aria-hidden={!show}>
      <span className="sticky-brand">ORBIT</span>
      <TrialButton onClick={onTrial} size="sm" long="short" />
    </div>
  );
}

/** Inline card: under the pairs table and on coin pages */
export function TrialStrip({ onTrial, text }: { onTrial: () => void; text?: string }) {
  return (
    <div className="card trial-strip">
      <div>
        <b>Unlock every ORBIT feature</b>
        <span className="muted small">{text ?? "Full rug checks, smart money alerts, wallet tracing and ORBIT Reads."}</span>
      </div>
      <TrialButton onClick={onTrial} size="sm" long={false} />
    </div>
  );
}

/** Shown when a free user taps a Pro-only feature */
export function UpgradeModal({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: () => void }) {
  const label = useCtaLabel(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="up-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <span className="label">ORBIT Pro</span>
        <h2 id="up-title">Unlock Full Access</h2>
        <p>Get full rug checks, smart money alerts, wallet tracing, and ORBIT Reads.</p>
        <button type="button" className="trial-cta-btn lg" onClick={onStart}>
          {label}
        </button>
        <p className="muted small">No credit card required. Just connect your wallet.</p>
      </div>
    </div>
  );
}
