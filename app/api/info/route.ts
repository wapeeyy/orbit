import { NextResponse } from "next/server";
import { isValidMint } from "@/lib/holders";
import { getInfo } from "@/lib/info";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const ca = new URL(req.url).searchParams.get("ca")?.trim() ?? "";
  if (!isValidMint(ca)) return NextResponse.json({ error: "CA tak sah" }, { status: 400 });
  try {
    const info = await getInfo(ca);
    return NextResponse.json(info, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
