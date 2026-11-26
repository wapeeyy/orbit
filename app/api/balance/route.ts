import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint, rpc } from "@/lib/holders";

export const dynamic = "force-dynamic";

/** Ultra (trade box): SOL + one token balance of a wallet */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const owner = q.get("owner") ?? "";
  const mint = q.get("mint") ?? "";
  if (!isValidMint(owner) || !isValidMint(mint)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  if (keyFrom(req)?.tier !== "ultra") return NextResponse.json({ error: "Ultra only" }, { status: 402 });
  try {
    type Acc = { account: { data: { parsed: { info: { tokenAmount: { amount: string; uiAmount: number; decimals: number } } } } } };
    const [sol, toks] = await Promise.all([
      rpc<{ value: number }>("getBalance", [owner]),
      rpc<{ value: Acc[] }>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]),
    ]);
    let raw = 0n;
    let ui = 0;
    for (const a of toks.value) {
      raw += BigInt(a.account.data.parsed.info.tokenAmount.amount);
      ui += a.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    }
    return NextResponse.json({ sol: sol.value / 1e9, token: { raw: raw.toString(), ui } }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
