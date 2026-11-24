import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { tokenExtra } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// /api/report?ca=&dev=&owners=a,b,c (maks 10)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ca = q.get("ca") ?? "";
  if (!isValidMint(ca)) return NextResponse.json({ error: "CA tak sah" }, { status: 400 });
  if (!keyFrom(req)) return NextResponse.json({ error: "Laporan ORBIT untuk pelanggan Pro", locked: true }, { status: 402 });
  const dev = q.get("dev");
  const owners = (q.get("owners") ?? "").split(",").filter(isValidMint).slice(0, 10);
  try {
    const data = await tokenExtra(ca, dev && isValidMint(dev) ? dev : null, owners);
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
