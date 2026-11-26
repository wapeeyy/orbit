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
    // Don't greet first-time visitors with a banner: show it on a return visit, or after 40 s on the site
    let visits = 0;
    try {
      visits = Number(localStorage.getItem("orbit.visits") ?? 0) + 1;
      localStorage.setItem("orbit.visits", String(visits));
    } catch {}
    let ready = visits > 1;
    let canPrompt = isIos;
    const show = () => ready && canPrompt && setHidden(false);
    const t = setTimeout(() => {
      ready = true;
      show();
    }, 40_000);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
      canPrompt = true;
      show();
    };
    show();
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  useEffect(() => {
    // keep the page's last buttons reachable above the banner
    document.body.classList.toggle("has-install", !hidden);
    return () => document.body.classList.remove("has-install");
  }, [hidden]);

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
        <b>Install the ORBIT app</b>
        {ios ? (
          <span className="small muted">
            Tap <b>Share</b> (box with arrow) in Safari → <b>Add to Home Screen</b>
          </span>
        ) : (
          <span className="small muted">Open it from your home screen, full screen</span>
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
      <button className="x" onClick={close} aria-label="Close">
        ✕
      </button>
    </div>
  );
}
