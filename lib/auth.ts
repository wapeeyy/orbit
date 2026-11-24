import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => {
  const s = process.env.ORBIT_SECRET || process.env.HELIUS_API_KEY;
  if (!s) throw new Error("ORBIT_SECRET belum diset");
  return s;
};
const mac = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type KeyPayload = { exp: number; id: string }; // exp dalam ms

/** Kod akses langganan: payload.tandatangan */
export function signKey(p: KeyPayload) {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${mac("key:" + body)}`;
}

export function verifyKey(key: string | null | undefined): KeyPayload | null {
  if (!key) return null;
  const [body, sig] = key.trim().split(".");
  if (!body || !sig) return null;
  try {
    if (!same(sig, mac("key:" + body))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as KeyPayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export const keyFrom = (req: Request) => verifyKey(req.headers.get("x-orbit-key"));

// Tiket percuma untuk 3 coin teratas — sah ~3 jam, tanpa pangkalan data
const HOUR = 3_600_000;
export const signFree = (ca: string, t = Date.now()) => mac(`free:${ca}:${Math.floor(t / HOUR)}`).slice(0, 22);

export function verifyFree(ca: string, sig: string | null) {
  if (!sig) return false;
  const now = Date.now();
  return [0, 1, 2].some((h) => same(sig, signFree(ca, now - h * HOUR)));
}

/** Boleh lihat coin ni? (pelanggan aktif, atau coin percuma) */
export function canView(req: Request, ca: string) {
  return !!keyFrom(req) || verifyFree(ca, new URL(req.url).searchParams.get("free"));
}
