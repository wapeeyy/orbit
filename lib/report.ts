import { rpc } from "./holders";

// Semakan tambahan untuk laporan token: pegangan dev & wallet "baru" dalam top holder

export type HolderAge = { owner: string; txCount: number; ageDays: number | null; flag: "baru" | "senyap" | null };
export type TokenExtra = {
  dev: { address: string; pct: number; amount: number } | null;
  holders: HolderAge[];
  freshCount: number;
};

async function devHolding(ca: string, dev: string) {
  const [acc, supply] = await Promise.all([
    rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }>(
      "getTokenAccountsByOwner",
      [dev, { mint: ca }, { encoding: "jsonParsed" }],
    ),
    rpc<{ value: { uiAmountString: string } }>("getTokenSupply", [ca]),
  ]);
  const amount = acc.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  const total = Number(supply.value.uiAmountString) || 0;
  return { address: dev, amount, pct: total ? (amount / total) * 100 : 0 };
}

/** Umur & aktiviti wallet dari 100 tandatangan terakhir */
async function holderAge(owner: string): Promise<HolderAge> {
  const sigs = await rpc<{ blockTime: number | null }[]>("getSignaturesForAddress", [owner, { limit: 100 }]);
  const times = sigs.map((s) => s.blockTime).filter((t): t is number => !!t);
  const oldest = times.length ? Math.min(...times) : null;
  // Kurang 100 tx = kita nampak sejarah penuh → umur sebenar wallet
  const ageDays = sigs.length < 100 && oldest ? (Date.now() / 1000 - oldest) / 86400 : null;
  const flag = sigs.length <= 5 ? "senyap" : ageDays != null && ageDays < 3 ? "baru" : null;
  return { owner, txCount: sigs.length, ageDays, flag };
}

export async function tokenExtra(ca: string, dev: string | null, owners: string[]): Promise<TokenExtra> {
  const devP = dev ? devHolding(ca, dev).catch(() => null) : Promise.resolve(null);
  const holders: HolderAge[] = [];
  for (let i = 0; i < owners.length; i += 2) {
    const part = await Promise.all(owners.slice(i, i + 2).map((o) => holderAge(o).catch(() => null)));
    for (const h of part) if (h) holders.push(h);
  }
  return { dev: await devP, holders, freshCount: holders.filter((h) => h.flag).length };
}
