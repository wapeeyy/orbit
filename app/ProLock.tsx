"use client";

import { useEffect, useState } from "react";
import { isActive, onKeyChange } from "./key";

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
export default function ProLock({ title, text, onSubscribe }: { title: string; text: string; onSubscribe: () => void }) {
  return (
    <div className="card locked-cta">
      <b>🔒 {title}</b>
      <span className="muted small">{text}</span>
      <button className="copy primary" onClick={onSubscribe}>
        Langgan ORBIT Pro — RM100 / bulan
      </button>
    </div>
  );
}
