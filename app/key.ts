"use client";

// Kod akses langganan disimpan dalam browser pengguna.
const K = "orbit.key.v1";
const listeners = new Set<() => void>();

export function getKey(): string | null {
  try {
    return localStorage.getItem(K);
  } catch {
    return null;
  }
}

export function setKey(key: string | null) {
  try {
    if (key) localStorage.setItem(K, key);
    else localStorage.removeItem(K);
  } catch {}
  listeners.forEach((f) => f());
}

export function onKeyChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Tarikh tamat dari kod (tandatangan disahkan di server). */
export function keyExpiry(key: string | null): number | null {
  if (!key) return null;
  try {
    const body = key.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(body));
    return typeof p.exp === "number" ? p.exp : null;
  } catch {
    return null;
  }
}

/** Plan stored in the signed code: "ultra" or (default) "pro" */
export function keyTier(key = getKey()): "pro" | "ultra" | null {
  if (!isActive(key)) return null;
  try {
    const p = JSON.parse(atob(key!.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return p.tier === "ultra" ? "ultra" : "pro";
  } catch {
    return "pro";
  }
}

export function isActive(key = getKey()) {
  const exp = keyExpiry(key);
  return !!exp && exp > Date.now();
}

/** fetch dengan kod akses */
export function api(url: string, init: RequestInit = {}) {
  const key = getKey();
  const headers = new Headers(init.headers);
  if (key) headers.set("x-orbit-key", key);
  return fetch(url, { ...init, headers });
}
