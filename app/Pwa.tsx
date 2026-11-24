"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Daftar service worker + butang "Install app" (Android/Chrome). iPhone: arahan Add to Home Screen. */
export default function Pwa() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("orbit.install.dismissed") === "1";
    } catch {}
    if (standalone || dismissed) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIos(isIos);
    if (isIos) setHidden(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("orbit.install.dismissed", "1");
    } catch {}
  };

  return (
    <div className="install">
      <img src="/icon-192.png" alt="" />
      <div>
        <b>Install app ORBIT</b>
        {ios ? (
          <span className="small muted">
            Tekan <b>Share</b> (kotak anak panah) di Safari → <b>Add to Home Screen</b>
          </span>
        ) : (
          <span className="small muted">Buka terus dari home screen, skrin penuh</span>
        )}
      </div>
      {evt && (
        <button
          className="copy primary"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
            setHidden(true);
          }}
        >
          Install
        </button>
      )}
      <button className="x" onClick={close} aria-label="Tutup">
        ✕
      </button>
    </div>
  );
}
