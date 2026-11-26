import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { solUsd } from "@/lib/pay";
import { fetchSwaps, toSwap } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Latest swaps of a wallet (newest first).
 * ?address=&mint=  → only that token (dev tracker, Pro)
 * ?address=        → any token (smart-money follow, Ultra)
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const address = q.get("address") ?? "";
  const mint = q.get("mint");
  if (!isValidMint(address) || (mint && !isValidMint(mint))) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  const key = keyFrom(req);
  if (!key) return NextResponse.json({ error: "Pro only", locked: true }, { status: 402 });
  if (!mint && key.tier !== "ultra") return NextResponse.json({ error: "Ultra only", locked: true }, { status: 402 });
  try {
    const [{ txs }, sol] = await Promise.all([fetchSwaps(address, mint ? 3 : 1), solUsd().catch(() => 0)]);
    const swaps = txs
      .map((t) => toSwap(t, address, sol))
      .filter((s): s is NonNullable<typeof s> => !!s && (!mint || s.mint === mint))
      .slice(0, 50)
      .map((s) => ({ ...s, usd: Math.round(s.sol * sol) }));
    return NextResponse.json({ swaps, solUsd: sol }, { headers: { "cache-control": "private, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
