import { kvGet, kvPipeline } from "./kv";
import type { Closed, Pick, Removed } from "./picks";
import { DEFAULT_PREFS, SITE, esc, getCommunity, px, tgReady, tgSend, type TgSub } from "./telegram";

const pc = (a: number, b: number) => {
  const v = (a / b - 1) * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
};
const listName = (k: "scalp" | "hold") => (k === "scalp" ? "Scalp" : "Hold");
const dur = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.round(m / 1440)} days`;
};
const DISC = "<i>Filtered candidate, not financial advice.</i>";

export function pickText(p: Pick) {
  return [
    `<b>New ORBIT ${listName(p.kind)} pick: $${esc(p.symbol)}</b>`,
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

export function closedText(c: Closed) {
  const name = listName(c.kind);
  const move = `$${px(c.entry)} → $${px(c.exit)} in ${dur(c.closedAt - c.at)}`;
  if (c.result === "target")
    return [`<b>Target hit: $${esc(c.symbol)} ${pc(c.exit, c.entry)}</b>`, `ORBIT ${name} pick ${move}.`, "Consider taking profit. Removed from the list.", `<code>${c.ca}</code>`, DISC].join("\n");
  if (c.result === "stop")
    return [`<b>Stop hit: $${esc(c.symbol)} ${pc(c.exit, c.entry)}</b>`, `ORBIT ${name} pick ${move}.`, "The setup is no longer valid. Cut the loss and wait for the next pick. Removed from the list.", `<code>${c.ca}</code>`, DISC].join("\n");
  return [`<b>Time's up: $${esc(c.symbol)} ${pc(c.exit, c.entry)}</b>`, `ORBIT ${name} pick ran ${c.kind === "scalp" ? "24 hours" : "30 days"} without reaching target or stop (${move}).`, "Removed from the list.", `<code>${c.ca}</code>`, DISC].join("\n");
}

export function removedText(r: Removed) {
  const p = r.pick;
  return [
    `<b>$${esc(p.symbol)} removed from ORBIT ${listName(p.kind)}</b>`,
    `No longer passes: ${esc(r.why)}.`,
    `If you are in it, manage the trade: stop $${px(p.stop)}, target $${px(p.target)}.`,
    `<code>${p.ca}</code>`,
    DISC,
  ].join("\n");
}

/** Ultra subscribers who connected Telegram and keep Scalp & Hold alerts on */
async function pickChats() {
  const [ids] = (await kvPipeline([["SMEMBERS", "tgsubs"]])) as [string[]];
  const chats = new Set<number>(); // one message per chat, even if it was connected twice
  for (const id of ids ?? []) {
    const raw = await kvGet(`tgsub:${id}`);
    if (!raw) continue;
    const s = JSON.parse(raw) as TgSub;
    const prefs = { ...DEFAULT_PREFS, ...(s.prefs ?? {}) };
    if (s.chat && s.exp > Date.now() && prefs.picks) chats.add(s.chat);
  }
  return [...chats];
}

async function broadcast(items: { text: string; ca: string }[]) {
  if (!items.length || !tgReady()) return 0;
  const chats = await pickChats();
  const ultra = (await getCommunity()).ultra;
  let sent = 0;
  for (const it of items) {
    const btn = { text: "Open in ORBIT", url: `${SITE}/?ca=${it.ca}&src=tg-pick`, app: true };
    for (const chat of chats) if (await tgSend(chat, it.text, btn)) sent++;
    if (ultra) await tgSend(ultra.id, it.text, btn);
  }
  return sent;
}

/** once per key: no repeats if a coin drops off and comes back soon after */
async function once(key: string, ttl: number) {
  const [ok] = (await kvPipeline([["SET", key, "1", "NX", "EX", ttl]])) as [string | null];
  return ok === "OK";
}

/** Live Telegram alert to every Ultra subscriber (and the Ultra group) when a coin joins Scalp or Hold */
export async function notifyNewPicks(fresh: Pick[]) {
  const items = [];
  for (const p of fresh) if (await once(`picks:told:${p.kind}:${p.ca}`, p.kind === "scalp" ? 86_400 : 7 * 86_400)) items.push({ text: pickText(p), ca: p.ca });
  return broadcast(items);
}

/** Target hit, stop hit or time's up */
export async function notifyClosed(closed: Closed[]) {
  return broadcast(closed.map((c) => ({ text: closedText(c), ca: c.ca })));
}

/** Dropped at a rebuild because it no longer passes every check */
export async function notifyRemoved(removed: Removed[]) {
  const items = [];
  for (const r of removed) if (await once(`picks:gone:${r.pick.kind}:${r.pick.ca}`, 6 * 3600)) items.push({ text: removedText(r), ca: r.pick.ca });
  return broadcast(items);
}
