import { NextResponse } from "next/server";
import { canView, keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { tokenExtra } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// /api/report?ca=&dev=&owners=a,b,c (maks 10)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ca = q.get("ca") ?? "";
  if (!isValidMint(ca)) return NextResponse.json({ error: "CA tak sah" }, { status: 400 });
  if (!canView(req, ca)) return NextResponse.json({ error: "Langganan diperlukan", locked: true }, { status: 402 });
  const dev = q.get("dev");
  const owners = (q.get("owners") ?? "").split(",").filter(isValidMint).slice(0, 10);
  try {
    const data = await tokenExtra(ca, dev && isValidMint(dev) ? dev : null, owners);
    const cache = keyFrom(req) ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=600";
    return NextResponse.json(data, { headers: { "cache-control": cache } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
