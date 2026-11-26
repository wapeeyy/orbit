import { NextResponse } from "next/server";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";
import { dexInfo } from "@/lib/marketwatch";
import { openPickCas, refreshPicks, settlePicks } from "@/lib/picks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by the alerts workflow. Scalp list rebuilt every ~5 min, Hold list every ~6 h,
 * open picks settled (target / stop / expired) every run. Public but safe: locked, reads public data only.
 */
export async function GET() {
  if (!kvConfigured()) return NextResponse.json({ skipped: "no database" });
  const [lock] = (await kvPipeline([["SET", "picks:lock", "1", "NX", "EX", 55]])) as [string | null];
  if (lock !== "OK") return NextResponse.json({ skipped: "locked" });
  const out: Record<string, unknown> = {};
  try {
    const cas = await openPickCas();
    if (cas.length) {
      const info = await dexInfo(cas);
      await settlePicks(new Map([...info].map(([ca, d]) => [ca, d.price])));
    }
    const now = Date.now();
    const age = async (k: string) => now - Number((await kvGet(`picks:${k}:built`)) ?? 0);
    if ((await age("hold")) > 6 * 3_600_000) {
      const s = await refreshPicks("hold");
      await kvPipeline([["SET", "picks:hold:built", String(now)]]);
      out.hold = { scanned: s.scanned, passed: s.passed };
    } else if ((await age("scalp")) > 5 * 60_000) {
      const s = await refreshPicks("scalp");
      await kvPipeline([["SET", "picks:scalp:built", String(now)]]);
      out.scalp = { scanned: s.scanned, passed: s.passed };
    }
  } catch (e) {
    out.error = (e as Error).message;
  }
  await kvPipeline([["DEL", "picks:lock"]]);
  return NextResponse.json(out);
}
