import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { readPicks, trackRecord } from "@/lib/picks";

export const dynamic = "force-dynamic";

/** Ultra: current Scalp & Hold picks + their track record */
export async function GET(req: Request) {
  if (keyFrom(req)?.tier !== "ultra") return NextResponse.json({ error: "Ultra only", locked: true }, { status: 402 });
  const [scalp, hold, rs, rh] = await Promise.all([readPicks("scalp"), readPicks("hold"), trackRecord("scalp"), trackRecord("hold")]);
  return NextResponse.json({ scalp, hold, record: { scalp: rs, hold: rh } }, { headers: { "cache-control": "private, no-store" } });
}
