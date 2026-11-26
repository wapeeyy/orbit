import { NextResponse } from "next/server";
import { keyFrom } from "@/lib/auth";
import { isValidMint } from "@/lib/holders";
import { bundleCheck, holderFlow } from "@/lib/insiders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ultra: holder flow (1 h / 24 h) + launch bundle check for ?ca= */
export async function GET(req: Request) {
  const ca = new URL(req.url).searchParams.get("ca") ?? "";
  if (!isValidMint(ca)) return NextResponse.json({ error: "Invalid CA" }, { status: 400 });
  const key = keyFrom(req);
  if (key?.tier !== "ultra") return NextResponse.json({ error: "Ultra only", locked: true }, { status: 402 });
  try {
    const flow = await holderFlow(ca);
    const bundle = await bundleCheck(ca, flow.holders).catch((e) => ({ ok: false as const, reason: (e as Error).message }));
    return NextResponse.json({ flow, bundle }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
