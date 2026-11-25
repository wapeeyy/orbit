import { NextResponse } from "next/server";
import { countryOf } from "@/lib/events";
import { kvConfigured, kvPipeline } from "@/lib/kv";

export const dynamic = "force-dynamic";
const KEEP = 120 * 86400; // keep daily stats for 120 days
const clean = (s: unknown, n = 40) => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, n) : "");

/** One visit (sent once per browser session): unique visitors, views, country and traffic source per day */
export async function POST(req: Request) {
  if (!kvConfigured()) return new NextResponse(null, { status: 204 });
  let b: { d?: string; src?: string };
  try {
    b = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const device = clean(b.d, 64) || "anon";
  const src = clean(b.src) || "direct";
  const cc = countryOf(req);
  try {
    await kvPipeline([
      ["PFADD", `uv:${day}`, device],
      ["INCR", `pv:${day}`],
      ["HINCRBY", `cc:${day}`, cc, 1],
      ["HINCRBY", `src:${day}`, src, 1],
      ["EXPIRE", `uv:${day}`, KEEP],
      ["EXPIRE", `pv:${day}`, KEEP],
      ["EXPIRE", `cc:${day}`, KEEP],
      ["EXPIRE", `src:${day}`, KEEP],
    ]);
  } catch {}
  return new NextResponse(null, { status: 204 });
}
