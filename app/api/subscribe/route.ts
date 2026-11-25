import { NextResponse } from "next/server";
import { keyFrom, readSignedKey, signKey, verifyKey } from "@/lib/auth";
import { kvConfigured, kvGet, setOnce } from "@/lib/kv";
import { PROMO_HOURS } from "@/lib/trial";
import { DAYS, findByReference, isPlan, payConfig, plans, refFromSecret, solUsd, USDC_MINT, verifyPayment, type Payment, type PlanId } from "@/lib/pay";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };

/** Price & wallet for the Subscribe page, plus access-code status (x-orbit-key header) */
export async function GET(req: Request) {
  const { wallet, priceUsdc, priceRm } = payConfig();
  let priceSol: number | null = null;
  let sol: number | null = null;
  try {
    sol = await solUsd();
    priceSol = Math.ceil((priceUsdc / sol) * 10_000) / 10_000;
  } catch {}
  const key = keyFrom(req);
  return NextResponse.json(
    {
      ready: !!wallet,
      txidClaims: kvConfigured(), // pasting a TxID needs a database to stop double claims
      wallet,
      priceRm,
      priceUsdc,
      priceSol,
      solUsd: sol,
      usdcMint: USDC_MINT,
      days: DAYS,
      plans: plans(),
      active: key ? { exp: key.exp, tier: key.tier ?? "pro", trial: !!key.trial } : null,
      trials: kvConfigured(),
    },
    { headers: nocache },
  );
}

/**
 * Issue an access code for a payment.
 * Deterministic: the same payment always yields the same code, and a payment only extends a code
 * if it is newer than the last payment already counted in that code (no replay stacking).
 */
function issue(req: Request, pay: Payment, signature: string) {
  const current = verifyKey(req.headers.get("x-orbit-key"));
  const sameTier = (current?.tier ?? "pro") === pay.tier;
  // a newer payment on the same plan extends the code; a different plan (upgrade) starts a fresh code
  const stacks = current && sameTier && (current.t ?? 0) < pay.at;
  if (current && sameTier && !stacks) {
    // This payment is already counted (or older) — keep the current code
    return { key: req.headers.get("x-orbit-key")!.trim(), exp: current.exp, days: 0, usd: pay.usd };
  }
  const exp = Math.max(pay.at, stacks ? current!.exp : 0) + pay.days * 86_400_000;
  const key = signKey({ exp, id: signature.slice(0, 12), t: pay.at, tier: pay.tier });
  return { key, exp, days: pay.days, usd: pay.usd, tier: pay.tier };
}

/** Claim: { secret } (Solana Pay QR / wallet button) or { signature } (needs the database). */
export async function POST(req: Request) {
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: nocache });
  let body: { secret?: string; signature?: string; plan?: string; trial?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request");
  }

  const plan: PlanId = isPlan(body.plan) ? body.plan : "pro-month";
  // $10 first month: only for a finished trial, within 48 h of its end, once per wallet
  let promoWallet: string | null = null;
  if (plan === "pro-promo") {
    const t = readSignedKey(body.trial);
    if (!t?.trial || !t.w) return fail("This offer is only for people who finished the free trial.", 403);
    if (Date.now() > t.exp + PROMO_HOURS * 3_600_000) return fail("This offer has ended. Pro is $23 / month.", 403);
    promoWallet = t.w;
  }
  const promoOnce = async (signature: string) => {
    if (!promoWallet) return true;
    if (!kvConfigured()) return false;
    if (await setOnce(`promo:${promoWallet}`, signature, 400 * 86400)) return true;
    return (await kvGet(`promo:${promoWallet}`)) === signature; // the same payment claimed again
  };
  try {
    if (body.secret) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(body.secret)) return fail("Invalid payment session");
      const signature = await findByReference(refFromSecret(body.secret));
      if (!signature) return NextResponse.json({ pending: true }, { headers: nocache });
      const pay = await verifyPayment(signature, plan);
      if (Date.now() - pay.at > pay.days * 86_400_000) return fail("This payment has already expired");
      if (!(await promoOnce(signature))) return fail("The trial offer was already used for this wallet.", 409);
      return NextResponse.json(issue(req, pay, signature), { headers: nocache });
    }

    const signature = body.signature?.trim() ?? "";
    if (!kvConfigured()) {
      return fail("To pay from an exchange, send to your Phantom/Solflare wallet first, then pay with the QR code / wallet button.", 503);
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return fail("Invalid transaction ID");
    const pay = await verifyPayment(signature, plan);
    // A pasted TxID is public, so each one can only be claimed once
    const first = await setOnce(`used:${signature}`, JSON.stringify({ payer: pay.payer, at: Date.now() }), 400 * 86400);
    if (!first) return fail("This transaction has already been used. If this was your payment, re-enter your access code.", 409);
    if (!(await promoOnce(signature))) return fail("The trial offer was already used for this wallet.", 409);
    return NextResponse.json(issue(req, pay, signature), { headers: nocache });
  } catch (e) {
    return fail((e as Error).message, 400);
  }
}
