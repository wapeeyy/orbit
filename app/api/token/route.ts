import { NextResponse } from "next/server";
import { getMarket } from "@/lib/dex";
import { getHolders, isValidMint } from "@/lib/holders";
import { canView } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ca = new URL(req.url).searchParams.get("ca")?.trim() ?? "";
  if (!isValidMint(ca)) {
    return NextResponse.json({ error: "Invalid CA — must be a Solana address (base58, 32 bytes)." }, { status: 400 });
  }
  if (!canView(req, ca)) {
    return NextResponse.json({ error: "A subscription is required to scan this coin", locked: true }, { status: 402 });
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
      { error: holdersError ?? marketError ?? "Token not found." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ca, market, marketError, holders, holdersError });
}
