import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { NextResponse } from "next/server";
import { signKey } from "@/lib/auth";
import { rpc } from "@/lib/holders";
import { kvConfigured, kvGet, kvIncr, setOnce } from "@/lib/kv";
import { TRIAL_DAYS, trialMessage } from "@/lib/trial";
import { countryOf, logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };
const DAY = 86_400_000;
/**
 * One free Pro trial per Solana wallet (proved by a signature), per device and at most 3 per network a month.
 * The wallet must have some history so throw-away wallets can't farm trials.
 */
export async function POST(req: Request) {
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: nocache });
  if (!kvConfigured()) return fail("Free trials are not open yet — please check back soon.", 503);

  let b: { wallet?: string; time?: string; signature?: string; device?: string };
  try {
    b = await req.json();
  } catch {
    return fail("Invalid request");
  }
  const wallet = b.wallet ?? "";
  const time = b.time ?? "";
  const device = (b.device ?? "").slice(0, 64);
  let pub: Uint8Array, sig: Uint8Array;
  try {
    pub = bs58.decode(wallet);
    sig = bs58.decode(b.signature ?? "");
  } catch {
    return fail("Invalid wallet or signature");
  }
  if (pub.length !== 32 || sig.length !== 64) return fail("Invalid wallet or signature");
  const t = Date.parse(time);
  if (!t || Math.abs(Date.now() - t) > 10 * 60_000) return fail("Signature expired — please try again");
  const ok = (() => {
    try {
      return ed25519.verify(sig, new TextEncoder().encode(trialMessage(wallet, time)), pub);
    } catch {
      return false;
    }
  })();
  if (!ok) return fail("Signature check failed — please try again");

  // already claimed?
  if (await kvGet(`trial:w:${wallet}`)) return fail("This wallet has already used its free trial.", 409);
  if (device && (await kvGet(`trial:d:${device}`))) return fail("This device has already used a free trial.", 409);

  // throw-away wallets: need some on-chain history
  try {
    const sigs = await rpc<{ signature: string }[]>("getSignaturesForAddress", [wallet, { limit: 5 }]);
    if (sigs.length < 3) return fail("Please use your main wallet — this one has almost no history on Solana.", 403);
  } catch {
    return fail("Couldn't check the wallet right now — try again in a minute.", 502);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if ((await kvIncr(`trial:ip:${ip}`, 30 * 86400)) > 3) return fail("Too many free trials from this network. Please subscribe to continue.", 429);

  // claim the wallet (atomic: a second request for the same wallet loses)
  const now = Date.now();
  const exp = now + TRIAL_DAYS * DAY;
  if (!(await setOnce(`trial:w:${wallet}`, String(now), 400 * 86400))) return fail("This wallet has already used its free trial.", 409);
  if (device) await setOnce(`trial:d:${device}`, wallet, 400 * 86400);

  const key = signKey({ exp, id: `trial-${wallet.slice(0, 8)}`, t: now, tier: "pro", trial: true, w: wallet });
  await logEvent({ type: "trial", at: now, wallet, country: countryOf(req) });
  return NextResponse.json({ key, exp }, { headers: nocache });
}
