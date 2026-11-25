import { NextResponse } from "next/server";
import { keyFrom, signKey } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * Owner only: make a free access code for an influencer, a giveaway winner or a partner.
 * body: { tier: "pro" | "ultra", days: 1–365, label: "kol-ali" }
 */
export async function POST(req: Request) {
  const owner = keyFrom(req);
  if (owner?.id !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let b: { tier?: string; days?: number; label?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const tier = b.tier === "ultra" ? "ultra" : "pro";
  const days = Math.max(1, Math.min(365, Math.round(Number(b.days) || 30)));
  const label = (b.label ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) || "gift";
  const now = Date.now();
  const key = signKey({ exp: now + days * 86_400_000, id: `gift-${label}-${now.toString(36)}`, t: now, tier });
  await logEvent({ type: "gift", at: now, label, tier, days });
  return NextResponse.json({ key, link: `https://www.orbitonsol.com/?kod=${encodeURIComponent(key)}&src=${label}`, tier, days, label });
}
