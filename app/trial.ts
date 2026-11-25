"use client";

import bs58 from "bs58";
import { PROMO_HOURS, trialMessage } from "@/lib/trial";
import { setKey } from "./key";

// The trial code is kept even after it expires: it unlocks the after-trial offer.
const T = "orbit.trial.v1";
const D = "orbit.device.v1";

export function trialKey(): string | null {
  try {
    return localStorage.getItem(T);
  } catch {
    return null;
  }
}

function payload(k: string | null): { exp: number; trial?: boolean } | null {
  if (!k) return null;
  try {
    return JSON.parse(atob(k.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** none | active (days left) | offer (ms left on the $10 offer) | over */
export function trialState(): { s: "none" } | { s: "active"; exp: number } | { s: "offer"; until: number } | { s: "over" } {
  const p = payload(trialKey());
  if (!p?.trial) return { s: "none" };
  const now = Date.now();
  if (p.exp > now) return { s: "active", exp: p.exp };
  const until = p.exp + PROMO_HOURS * 3_600_000;
  return until > now ? { s: "offer", until } : { s: "over" };
}

function deviceId() {
  try {
    let d = localStorage.getItem(D);
    if (!d) {
      d = crypto.randomUUID();
      localStorage.setItem(D, d);
    }
    return d;
  } catch {
    return "";
  }
}

type Provider = {
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey: { toString(): string } } | void>;
  signMessage: (m: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

export function walletProvider(): Provider | null {
  const w = window as unknown as { phantom?: { solana?: Provider }; solflare?: Provider; solana?: Provider };
  return w.phantom?.solana ?? w.solflare ?? w.solana ?? null;
}

/** Deep links that open ORBIT inside the wallet app's browser (phones without an injected wallet) */
export const walletLinks = () => {
  const here = encodeURIComponent(window.location.origin + "/?tab=sub");
  return {
    phantom: `https://phantom.app/ul/browse/${here}?ref=${encodeURIComponent(window.location.origin)}`,
    solflare: `https://solflare.com/ul/v1/browse/${here}?ref=${encodeURIComponent(window.location.origin)}`,
  };
};

export async function startTrial(): Promise<{ ok: true; exp: number } | { ok: false; error: string }> {
  const p = walletProvider();
  if (!p) return { ok: false, error: "no-wallet" };
  try {
    const c = await p.connect();
    const wallet = (c && "publicKey" in c ? c.publicKey : p.publicKey)?.toString();
    if (!wallet) return { ok: false, error: "Wallet not connected" };
    const time = new Date().toISOString();
    const res = await p.signMessage(new TextEncoder().encode(trialMessage(wallet, time)), "utf8");
    const sig = res instanceof Uint8Array ? res : res.signature;
    const r = await fetch("/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, time, signature: bs58.encode(sig), device: deviceId() }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error ?? "Couldn't start the trial" };
    try {
      localStorage.setItem(T, j.key);
    } catch {}
    setKey(j.key);
    return { ok: true, exp: j.exp };
  } catch (e) {
    const m = (e as Error).message ?? "";
    return { ok: false, error: /reject|denied|cancel/i.test(m) ? "Request cancelled in the wallet." : m || "Couldn't start the trial" };
  }
}
