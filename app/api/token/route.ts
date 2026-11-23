import { NextResponse } from "next/server";
import { getMarket } from "@/lib/dex";
import { getHolders, isValidMint } from "@/lib/holders";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ca = new URL(req.url).searchParams.get("ca")?.trim() ?? "";
  if (!isValidMint(ca)) {
    return NextResponse.json({ error: "CA tak sah — mesti alamat Solana (base58, 32 bait)." }, { status: 400 });
  }

  let market = null;
  let marketError: string | null = null;
  try {
    market = await getMarket(ca);
  } catch (e) {
    marketError = (e as Error).message;
  }

  let holders = null;
  let holdersError: string | null = null;
  try {
    holders = await getHolders(ca, market?.pairAddresses ?? {});
  } catch (e) {
    holdersError = (e as Error).message;
  }

  if (!market && !holders) {
    return NextResponse.json(
      { error: holdersError ?? marketError ?? "Token tak dijumpai." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ca, market, marketError, holders, holdersError });
}
