"use client";

import { useEffect } from "react";

/** Keep the page at 100% (no pinch / double-tap zoom). Pinch still works inside the chart, which zooms the candles. */
export default function NoZoom() {
  useEffect(() => {
    const inChart = (t: EventTarget | null) => t instanceof Element && !!t.closest(".chart-wrap");
    // iOS Safari ignores user-scalable=no, so stop its gesture events outside the chart
    const gesture = (e: Event) => {
      if (!inChart(e.target)) e.preventDefault();
    };
    const pinch = (e: TouchEvent) => {
      if (e.touches.length > 1 && !inChart(e.target)) e.preventDefault();
    };
    let lastTap = 0;
    const doubleTap = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 300 && !inChart(e.target) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      lastTap = now;
    };
    document.addEventListener("gesturestart", gesture, { passive: false });
    document.addEventListener("gesturechange", gesture, { passive: false });
    document.addEventListener("touchmove", pinch, { passive: false });
    document.addEventListener("touchend", doubleTap, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", gesture);
      document.removeEventListener("gesturechange", gesture);
      document.removeEventListener("touchmove", pinch);
      document.removeEventListener("touchend", doubleTap);
    };
  }, []);
  return null;
}
