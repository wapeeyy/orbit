import { NextResponse } from "next/server";
import { discover } from "@/lib/discover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await discover();
    return NextResponse.json(data, {
      headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
