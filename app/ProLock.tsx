"use client";

import { useEffect, useState } from "react";
import { isActive, onKeyChange } from "./key";
import { useCtaLabel } from "./Upgrade";

export function usePro() {
  const [pro, setPro] = useState(false);
  useEffect(() => {
    const sync = () => setPro(isActive());
    sync();
    return onKeyChange(sync);
  }, []);
  return pro;
}

/** Kad terkunci untuk ciri Pro */
export default function ProLock({ title, text, onSubscribe, ultra = false }: { title: string; text: string; onSubscribe: () => void; ultra?: boolean }) {
  return (
    <div className="card locked-cta">
      <b>{title}</b>
      <span className="muted small">{text}</span>
      {ultra ? (
        <button className="trial-cta-btn sm" onClick={onSubscribe}>
          Get ORBIT Ultra
        </button>
      ) : (
        <LockButton onClick={onSubscribe} />
      )}
    </div>
  );
}

function LockButton({ onClick }: { onClick: () => void }) {
  const label = useCtaLabel(false);
  return (
    <button className="trial-cta-btn sm" onClick={onClick}>
      {label}
    </button>
  );
}
