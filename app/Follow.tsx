"use client";

import { useEffect, useState } from "react";
import { api } from "./key";

// Ultra: smart-money watchlist. Follow wallets; ORBIT checks their latest swaps every few minutes
// while the app is open (and via Telegram when connected) and alerts on every new buy or sell.
export type Followed = { address: string; label: string; seen: string[]; added: number };
export type SmartSwap = { address: string; label: string; side: "BUY" | "SELL"; mint: string; symbol: string; usd: number; ts: number; signature: string };

const K = "orbit.follow.v1";
const FEED = "orbit.follow.feed.v1";
const listeners = new Set<() => void>();
const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "") as T;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
  listeners.forEach((f) => f());
};

export const getFollows = () => read<Followed[]>(K, []);
export const getFeed = () => read<SmartSwap[]>(FEED, []);
export const isFollowed = (a: string) => getFollows().some((f) => f.address === a);
export function toggleFollow(address: string, label?: string) {
  const l = getFollows();
  write(K, l.some((f) => f.address === address) ? l.filter((f) => f.address !== address) : [...l, { address, label: label || `${address.slice(0, 4)}…${address.slice(-4)}`, seen: [], added: Date.now() }].slice(0, 15));
}
export function onFollowChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
export function useFollows() {
  const [s, setS] = useState({ list: [] as Followed[], feed: [] as SmartSwap[] });
  useEffect(() => {
    const sync = () => setS({ list: getFollows(), feed: getFeed() });
    sync();
    return onFollowChange(sync);
  }, []);
  return s;
}

async function symbols(mints: string[]) {
  const out = new Map<string, string>();
  if (!mints.length) return out;
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(0, 30).join(",")}`);
    for (const p of (await r.json()) as { baseToken: { address: string; symbol: string } }[]) out.set(p.baseToken.address, p.baseToken.symbol);
  } catch {}
  return out;
}

/** One pass over followed wallets: returns new swaps since the last pass (first pass only records what is there). */
export async function checkFollows(): Promise<SmartSwap[]> {
  const list = getFollows();
  const fresh: SmartSwap[] = [];
  for (const f of list) {
    try {
      const r = await api(`/api/swaps?address=${f.address}`);
      if (!r.ok) continue;
      const { swaps } = (await r.json()) as { swaps: { side: "BUY" | "SELL"; mint: string; usd: number; ts: number; signature: string }[] };
      const firstRun = f.seen.length === 0;
      const news = swaps.filter((s) => !f.seen.includes(s.signature) && Date.now() - s.ts < 6 * 3_600_000);
      const cur = getFollows();
      const me = cur.find((x) => x.address === f.address);
      if (me) {
        me.seen = [...swaps.map((s) => s.signature), ...me.seen].slice(0, 80);
        write(K, cur);
      }
      if (!firstRun) for (const s of news) fresh.push({ ...s, address: f.address, label: f.label, symbol: "" });
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  if (fresh.length) {
    const sym = await symbols([...new Set(fresh.map((s) => s.mint))]);
    fresh.forEach((s) => (s.symbol = sym.get(s.mint) ?? s.mint.slice(0, 4)));
    write(FEED, [...fresh, ...getFeed()].slice(0, 60));
  }
  return fresh;
}

/** "Follow" button on a traced wallet */
export function FollowButton({ address, ultra, onSubscribe }: { address: string; ultra: boolean; onSubscribe: () => void }) {
  const { list } = useFollows();
  const on = list.some((f) => f.address === address);
  return (
    <button className={`watch-star ${on ? "on" : ""}`} onClick={() => (ultra ? toggleFollow(address) : onSubscribe())}>
      {on ? "Following" : "Follow wallet"}
      {!ultra && <em className="lock-tag">Ultra</em>}
    </button>
  );
}

const usd = (n: number) => "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const when = (t: number) => new Date(t).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Followed wallets + the latest trades they made (Wallet tab) */
export function SmartMoney({ onTrace, onOpen }: { onTrace: (a: string) => void; onOpen: (ca: string) => void }) {
  const { list, feed } = useFollows();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  if (!list.length)
    return (
      <div className="card">
        <h3>Smart-money watchlist</h3>
        <p className="muted small">Trace a wallet below and tap <b>Follow wallet</b>. ORBIT alerts you every time it buys or sells (up to 15 wallets).</p>
      </div>
    );
  return (
    <div className="card smart">
      <div className="section-head">
        <h3>Smart-money watchlist</h3>
        <button
          className="ghost small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await checkFollows();
            setBusy(false);
          }}
        >
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>
      <div className="sm-wallets">
        {list.map((f) => (
          <span key={f.address} className="chip">
            {edit === f.address ? (
              <input
                autoFocus
                defaultValue={f.label}
                onBlur={(e) => {
                  const cur = getFollows();
                  const me = cur.find((x) => x.address === f.address);
                  if (me) me.label = e.target.value.slice(0, 24) || me.label;
                  write(K, cur);
                  setEdit(null);
                }}
              />
            ) : (
              <button onClick={() => onTrace(f.address)}>{f.label}</button>
            )}
            <button onClick={() => setEdit(f.address)} title="Rename">✎</button>
            <button onClick={() => toggleFollow(f.address)} title="Unfollow">✕</button>
          </span>
        ))}
      </div>
      {feed.length === 0 ? (
        <p className="muted small">No new trades yet. New buys and sells appear here and as alerts (checked every 3 minutes while ORBIT is open).</p>
      ) : (
        <div className="sm-feed">
          {feed.slice(0, 20).map((s) => (
            <div key={s.signature} className="sm-row" onClick={() => onOpen(s.mint)}>
              <b className={s.side === "BUY" ? "up" : "down"}>{s.side}</b>
              <span>${s.symbol}</span>
              <span className="mono">{usd(s.usd)}</span>
              <span className="muted small">{s.label}</span>
              <span className="muted small">{when(s.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
