import { kvGet, kvPipeline } from "./kv";
import type { Pick } from "./picks";
import { DEFAULT_PREFS, SITE, esc, getCommunity, px, tgReady, tgSend, type TgSub } from "./telegram";

const pc = (a: number, b: number) => {
  const v = (a / b - 1) * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
};

export function pickText(p: Pick) {
  const name = p.kind === "scalp" ? "Scalp" : "Hold";
  return [
    `<b>New ORBIT ${name} pick: $${esc(p.symbol)}</b>`,
    `ORBIT score ${p.score} · ${esc(p.bias)} · ${p.horizon}`,
    "",
    `Entry zone  $${px(p.entry[0])} – $${px(p.entry[1])}`,
    `Target  $${px(p.target)} (${pc(p.target, p.price)})`,
    `Stop  $${px(p.stop)} (${pc(p.stop, p.price)})`,
    `Reward : risk  ${p.rr.toFixed(1)} : 1`,
    "",
    `Passed all ${p.checks.length} checks: ${p.checks.map((c) => c.k.toLowerCase()).join(", ")}.`,
    `<code>${p.ca}</code>`,
    "<i>Filtered candidate, not financial advice. Size small and respect the stop.</i>",
  ].join("\n");
}

/** Live Telegram alert to every Ultra subscriber (and the Ultra group) when a coin joins Scalp or Hold */
export async function notifyNewPicks(fresh: Pick[]) {
  if (!fresh.length || !tgReady()) return 0;
  const todo: Pick[] = [];
  for (const p of fresh) {
    // once per coin per list: no repeat if it drops off and comes back soon after
    const [ok] = (await kvPipeline([["SET", `picks:told:${p.kind}:${p.ca}`, "1", "NX", "EX", p.kind === "scalp" ? 86_400 : 7 * 86_400]])) as [string | null];
    if (ok === "OK") todo.push(p);
  }
  if (!todo.length) return 0;
  const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
  const chats: number[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`tgsub:${id}`);
    if (!raw) continue;
    const s = JSON.parse(raw) as TgSub;
    const prefs = { ...DEFAULT_PREFS, ...(s.prefs ?? {}) };
    if (s.chat && s.exp > Date.now() && prefs.picks) chats.push(s.chat);
  }
  const ultra = (await getCommunity()).ultra;
  let sent = 0;
  for (const p of todo) {
    const btn = { text: "Open in ORBIT", url: `${SITE}/?ca=${p.ca}&src=tg-pick` };
    const text = pickText(p);
    for (const chat of chats) if (await tgSend(chat, text, btn)) sent++;
    if (ultra) await tgSend(ultra.id, text, btn);
  }
  return sent;
}
