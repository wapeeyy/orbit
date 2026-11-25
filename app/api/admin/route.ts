import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { readEvents } from "@/lib/events";
import { kvConfigured } from "@/lib/kv";

export const dynamic = "force-dynamic";

/** Owner only: trials, payments and revenue */
export async function GET(req: Request) {
  const key = keyFrom(req);
  if (key?.id !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (!kvConfigured()) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  try {
    return NextResponse.json(await readEvents(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
