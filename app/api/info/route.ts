import { NextResponse } from "next/server";
import { isValidMint } from "@/lib/holders";
import { getInfo } from "@/lib/info";
import { canView, keyFrom } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const ca = new URL(req.url).searchParams.get("ca")?.trim() ?? "";
  if (!isValidMint(ca)) return NextResponse.json({ error: "Invalid CA" }, { status: 400 });
  if (!canView(req, ca)) return NextResponse.json({ error: "Subscription required", locked: true }, { status: 402 });
  // Respons untuk pelanggan bergantung pada header — jangan kongsi di CDN
  const cache = keyFrom(req) ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=600";
  try {
    const info = await getInfo(ca);
    return NextResponse.json(info, { headers: { "cache-control": cache } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
