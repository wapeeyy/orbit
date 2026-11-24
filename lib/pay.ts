import { rpc } from "./holders";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const DAYS = 30;
// Wallet rasmi ORBIT yang terima bayaran (boleh ditukar dengan env PAY_WALLET)
export const DEFAULT_PAY_WALLET = "ADukwrnGbjfBPY9CSErNuog1LBibbkdnd9kpnbH5fjeY";

export function payConfig() {
  const wallet = process.env.PAY_WALLET?.trim() || DEFAULT_PAY_WALLET;
  const priceUsdc = Number(process.env.PRICE_USDC || 23);
  const priceRm = Number(process.env.PRICE_RM || 100);
  return { wallet, priceUsdc, priceRm };
}

export async function solUsd(): Promise<number> {
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { cache: "no-store" });
  const j = await r.json();
  const p = Number(j?.[SOL_MINT]?.usdPrice);
  if (!p) throw new Error("Couldn't get SOL price");
  return p;
}

type Bal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmountString: string } };
type Tx = {
  blockTime: number | null;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: Bal[];
    postTokenBalances?: Bal[];
  } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
};

export type Payment = { usd: number; usdc: number; sol: number; payer: string; days: number; at: number };

/** Semak transaksi: berjaya, ≤ 72 jam, dan wallet penerima dapat USDC/SOL yang cukup. */
export async function verifyPayment(signature: string): Promise<Payment> {
  const { wallet, priceUsdc } = payConfig();
  if (!wallet) throw new Error("Receiving wallet (PAY_WALLET) is not set");
  const tx = await rpc<Tx | null>("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);
  if (!tx || !tx.meta) throw new Error("Transaction not found — wait 30 seconds and try again");
  if (tx.meta.err) throw new Error("This transaction failed on-chain");
  const at = (tx.blockTime ?? 0) * 1000;
  if (Date.now() - at > 72 * 3_600_000) throw new Error("Transaction is older than 72 hours — contact admin");

  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const i = keys.indexOf(wallet);
  const sol = i >= 0 ? (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9 : 0;

  const amt = (list: Bal[] | undefined, idx: number) =>
    Number(list?.find((b) => b.accountIndex === idx)?.uiTokenAmount.uiAmountString ?? 0);
  let usdc = 0;
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.owner === wallet && b.mint === USDC_MINT) {
      usdc += amt(tx.meta.postTokenBalances, b.accountIndex) - amt(tx.meta.preTokenBalances, b.accountIndex);
    }
  }
  const usd = usdc + (sol > 0 ? sol * (await solUsd()) : 0);
  const unit = priceUsdc * 0.97; // toleransi 3% untuk turun naik harga SOL
  if (usd < unit) {
    throw new Error(`Payment too small or not sent to the ORBIT wallet: received ~$${usd.toFixed(2)}, need $${priceUsdc}`);
  }
  const days = DAYS * Math.min(12, Math.floor(usd / unit));
  return { usd, usdc, sol: Math.max(sol, 0), payer: keys[0], days, at };
}

/** Cari transaksi Solana Pay melalui alamat reference */
export async function findByReference(reference: string): Promise<string | null> {
  const r = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [reference, { limit: 5 }]);
  return r.find((x) => !x.err)?.signature ?? null;
}
