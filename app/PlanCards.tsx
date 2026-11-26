"use client";

import { useState } from "react";
import { PLANS, type Billing, type Tier } from "./plans";

/** Free / Pro / Ultra pricing cards with monthly–yearly switch */
export default function PlanCards({ current, onPick, promo = false, ultraOffer = false }: { current: Tier; onPick: (t: Tier, b: Billing) => void; promo?: boolean; ultraOffer?: boolean }) {
  const [billing, setBilling] = useState<Billing>("month");
  return (
    <div className="plans-wrap">
      <div className="billing" role="tablist">
        <button className={billing === "month" ? "on" : ""} onClick={() => setBilling("month")}>Monthly</button>
        <button className={billing === "year" ? "on" : ""} onClick={() => setBilling("year")}>
          Yearly <em>2 months free</em>
        </button>
      </div>
      <div className="plans">
        {PLANS.map((p) => {
          const isCur = current === p.id;
          const price = p.price[billing];
          return (
            <div key={p.id} className={`tier tier-${p.id} ${isCur ? "current" : ""}`}>
              {p.id === "ultra" && <span className="tier-badge">Most powerful</span>}
              {p.id === "pro" && <span className="tier-badge pro">Most popular</span>}
              <span className="tier-name">{p.name}</span>
              {ultraOffer && p.id === "ultra" && billing === "month" ? (
                <div className="tier-price">
                  $5 <s className="was">${price}</s>
                  <small> first month</small>
                </div>
              ) : promo && p.id === "pro" && billing === "month" ? (
                <div className="tier-price">
                  $10 <s className="was">${price}</s>
                  <small> first month</small>
                </div>
              ) : (
                <div className="tier-price">
                  ${price}
                  {price > 0 && <small> / {billing}</small>}
                </div>
              )}
              {billing === "year" && price > 0 && <span className="tier-save">≈ ${(price / 12).toFixed(2)} / month</span>}
              <p className="tier-tag">{p.tagline}</p>
              <ul>
                {p.features.map((f) => (
                  <li key={f.text} className={f.soon ? "soon" : ""}>
                    {f.text}
                    {f.soon && <em>soon</em>}
                  </li>
                ))}
              </ul>
              {p.id === "free" ? (
                <button className="tier-btn ghost" disabled>{isCur ? "Your plan" : "Included"}</button>
              ) : (
                <button className={`tier-btn ${p.id}`} disabled={isCur} onClick={() => onPick(p.id, billing)}>
                  {isCur ? "✓ Your plan" : `Get ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
