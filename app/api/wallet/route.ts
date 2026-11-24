import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { traceWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Trace wallet — ciri ORBIT Pro
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if (!isValidMint(address)) return NextResponse.json({ error: "Alamat wallet tak sah" }, { status: 400 });
  if (!keyFrom(req)) {
    return NextResponse.json({ error: "Trace wallet untuk pelanggan ORBIT Pro", locked: true }, { status: 402 });
  }
  try {
    const data = await traceWallet(address);
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
