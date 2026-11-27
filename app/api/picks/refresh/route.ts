import { after, NextResponse } from "next/server";
import { kvConfigured, kvGet, kvPipeline } from "@/lib/kv";
import { dexInfo } from "@/lib/marketwatch";
import { notifyClosed, notifyNewPicks, notifyRemoved } from "@/lib/picknotify";
import { jobRunning, openPickCas, refreshPicks, settlePicks, type Kind } from "@/lib/picks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by the alerts workflow. Scalp list rebuilt every ~5 min, Hold list every ~6 h,
 * open picks settled (target / stop / expired) every run. Public but safe: locked, reads public data only.
 */
/**
 * Called every minute by cron-job.org (and the GitHub workflow as a backup). Answers at once and does the
 * work after the response, so the caller never times out; ?wait=1 runs it inline and returns the result.
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("wait") === "1") return tick();
  after(async () => {
    await tick();
  });
  return NextResponse.json({ queued: true });
}

async function tick() {
  if (!kvConfigured()) return NextResponse.json({ skipped: "no database" });
  const [lock] = (await kvPipeline([["SET", "picks:lock", "1", "NX", "EX", 55]])) as [string | null];
  if (lock !== "OK") return NextResponse.json({ skipped: "locked" });
  const out: Record<string, unknown> = {};
  try {
    const cas = await openPickCas();
    if (cas.length) {
      const info = await dexInfo(cas);
      const closed = await settlePicks(new Map([...info].map(([ca, d]) => [ca, d.price])));
      if (closed.length) out.closed = await notifyClosed(closed).catch(() => 0);
    }
    const now = Date.now();
    const age = async (k: string) => now - Number((await kvGet(`picks:${k}:built`)) ?? 0);
    // finish a rebuild in progress first, otherwise start whichever list is due
    let kind: Kind | null = (await jobRunning("hold")) ? "hold" : (await jobRunning("scalp")) ? "scalp" : null;
    if (!kind) kind = (await age("hold")) > 6 * 3_600_000 ? "hold" : (await age("scalp")) > 5 * 60_000 ? "scalp" : null;
    if (kind) {
      const s = await refreshPicks(kind, 40_000);
      if (s.done) await kvPipeline([["SET", `picks:${kind}:built`, String(now)]]);
      if (s.fresh?.length) out.notified = await notifyNewPicks(s.fresh).catch(() => 0);
      if (s.removed?.length) out.removed = await notifyRemoved(s.removed).catch(() => 0);
      out[kind] = { done: s.done, scanned: s.scanned, shortlisted: s.shortlisted, passed: s.passed, failed: s.failed };
    }
  } catch (e) {
    out.error = (e as Error).message;
  }
  await kvPipeline([["DEL", "picks:lock"]]);
  return NextResponse.json(out);
}
