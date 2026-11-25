"use client";

// Price alerts, stored in this browser. Checked while ORBIT is open (see AlertWatcher).
export type PriceAlert = { id: string; ca: string; symbol: string; price: number; dir: "above" | "below"; label?: string; created: number; hit?: number };

const K = "orbit.alerts.v1";
const listeners = new Set<() => void>();

export function getAlerts(): PriceAlert[] {
  try {
    return JSON.parse(localStorage.getItem(K) ?? "[]");
  } catch {
    return [];
  }
}

function save(list: PriceAlert[]) {
  try {
    localStorage.setItem(K, JSON.stringify(list));
  } catch {}
  listeners.forEach((f) => f());
}

export function addAlert(a: Omit<PriceAlert, "id" | "created">) {
  const list = getAlerts().filter((x) => !(x.ca === a.ca && Math.abs(x.price / a.price - 1) < 1e-6 && !x.hit));
  list.push({ ...a, id: Math.random().toString(36).slice(2, 10), created: Date.now() });
  save(list.slice(-50));
  if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

export function removeAlert(id: string) {
  save(getAlerts().filter((x) => x.id !== id));
}

export function markHit(ids: string[]) {
  const now = Date.now();
  save(getAlerts().map((x) => (ids.includes(x.id) ? { ...x, hit: now } : x)));
}

export function onAlertsChange(f: () => void) {
  listeners.add(f);
  const storage = (e: StorageEvent) => e.key === K && f();
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(f);
    window.removeEventListener("storage", storage);
  };
}
