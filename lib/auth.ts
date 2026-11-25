import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const secret = () => {
  const s = process.env.ORBIT_SECRET || process.env.HELIUS_API_KEY;
  if (!s) throw new Error("ORBIT_SECRET is not set");
  return s;
};
const mac = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type KeyPayload = { exp: number; id: string; t?: number; tier?: "pro" | "ultra" }; // exp & t (masa transaksi terakhir) dalam ms

/** Kod akses langganan: payload.tandatangan */
export function signKey(p: KeyPayload) {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${mac("key:" + body)}`;
}

// Kod percuma seumur hidup (owner & member). Hanya hash disimpan di sini — kod sebenar dipegang pemilik.
// Untuk batalkan satu kod: buang hash dia dari senarai ni.
const COMP_HASHES = new Set([
  "6e2fbbbaafd5b91ad7293028ad2047da92be651146a995b883a9b83355795cec", // owner
  "25e00ea4fc1fc87cd065b3c6414788d318e5605504af49047f7ded46349561c7", // member1
  "331cb1ea04f6748fb4830ae8a036abf82a4231893c29398f9afee15e14b04a67", // owner (Ultra)
  "0aae673dddc65a982d964f84054911a5b1234d64f6e168ba1709f6c9af6571e6", // member1 (Ultra)
]);

export function verifyKey(key: string | null | undefined): KeyPayload | null {
  if (!key) return null;
  const k = key.trim();
  if (COMP_HASHES.has(createHash("sha256").update(k).digest("hex"))) {
    try {
      return JSON.parse(Buffer.from(k.split(".")[0], "base64url").toString()) as KeyPayload;
    } catch {
      return null;
    }
  }
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
