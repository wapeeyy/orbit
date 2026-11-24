import { NextResponse } from "next/server";
import { keyFrom, signKey, verifyKey } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { kvConfigured, setOnce } from "@/lib/kv";
import { DAYS, findByReference, payConfig, solUsd, USDC_MINT } from "@/lib/pay";
import { verifyPayment } from "@/lib/pay";

export const dynamic = "force-dynamic";
const nocache = { "cache-control": "no-store" };

/** Harga & wallet untuk page Langgan, + status kod akses (header x-orbit-key) */
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
      ready: !!wallet && kvConfigured(),
      wallet,
      priceRm,
      priceUsdc,
      priceSol,
      solUsd: sol,
      usdcMint: USDC_MINT,
      days: DAYS,
      active: key ? { exp: key.exp } : null,
    },
    { headers: nocache },
  );
}

/** Tuntut langganan: { signature } atau { reference } (Solana Pay). Pilihan: header x-orbit-key untuk sambung tempoh. */
export async function POST(req: Request) {
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: nocache });
  let body: { signature?: string; reference?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Permintaan tak sah");
  }
  if (!kvConfigured()) return fail("Sistem bayaran belum siap — hubungi admin", 503);

  let signature = body.signature?.trim() ?? "";
  try {
    if (!signature && body.reference) {
      if (!isValidMint(body.reference)) return fail("Reference tak sah");
      const found = await findByReference(body.reference);
      if (!found) return NextResponse.json({ pending: true }, { headers: nocache });
      signature = found;
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return fail("Transaction ID tak sah");

    const pay = await verifyPayment(signature);
    // Satu transaksi hanya boleh dituntut sekali
    const first = await setOnce(`used:${signature}`, JSON.stringify({ payer: pay.payer, at: Date.now() }), 400 * 86400);
    if (!first) return fail("Transaksi ni dah digunakan. Kalau ni bayaran kau, masukkan semula kod akses kau.", 409);

    const current = verifyKey(req.headers.get("x-orbit-key"));
    const start = Math.max(Date.now(), current?.exp ?? 0);
    const exp = start + pay.days * 86_400_000;
    const key = signKey({ exp, id: signature.slice(0, 12) });
    return NextResponse.json({ key, exp, days: pay.days, usd: pay.usd }, { headers: nocache });
  } catch (e) {
    return fail((e as Error).message, 400);
  }
}
