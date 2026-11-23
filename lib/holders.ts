import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { KNOWN_ADDRESSES, KNOWN_PROGRAMS, SYSTEM_PROGRAM } from "./known";

export type Holder = {
  rank: number;
  owner: string;
  amount: number; // ui amount
  pct: number; // % of supply
  kind: "wallet" | "excluded";
  label?: string;
};

export type HolderReport = {
  decimals: number;
  supply: number;
  scanned: number; // token accounts inspected (max 20)
  holders: Holder[]; // wallets only, ranked
  excluded: Holder[]; // pools / curves / programs
  top10Pct: number;
  warning: boolean;
};

const WARN_THRESHOLD = 30;

function rpcUrl() {
  const key = process.env.HELIUS_API_KEY;
  if (!key && process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (!key) throw new Error("HELIUS_API_KEY belum diset");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result as T;
}

/** Alamat off-curve = PDA = dikawal program (pool, curve, vault), bukan wallet orang. */
export function isOnCurve(address: string): boolean {
  try {
    const bytes = bs58.decode(address);
    if (bytes.length !== 32) return false;
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

export function isValidMint(address: string): boolean {
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

type AccountInfo = { owner: string; data: unknown; lamports: number } | null;

export async function getHolders(
  mint: string,
  pairAddresses: Record<string, string>,
): Promise<HolderReport> {
  const [supplyRes, largest] = await Promise.all([
    rpc<{ value: { amount: string; decimals: number; uiAmountString: string } }>("getTokenSupply", [mint]),
    rpc<{ value: { address: string; amount: string }[] }>("getTokenLargestAccounts", [mint]),
  ]);
  const supplyRaw = BigInt(supplyRes.value.amount);
  const decimals = supplyRes.value.decimals;
  const accounts = largest.value.slice(0, 20);

  // Token account -> wallet pemilik
  const tokenInfos = await rpc<{ value: AccountInfo[] }>("getMultipleAccounts", [
    accounts.map((a) => a.address),
    { encoding: "jsonParsed" },
  ]);

  // Gabung beberapa token account milik wallet sama
  const byOwner = new Map<string, bigint>();
  accounts.forEach((a, i) => {
    const data = tokenInfos.value[i]?.data as { parsed?: { info?: { owner?: string } } } | undefined;
    const owner = data?.parsed?.info?.owner ?? a.address;
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + BigInt(a.amount));
  });

  const owners = [...byOwner.keys()];
  // Siapa yang memiliki akaun wallet tu? (System Program = wallet biasa)
  const ownerInfos = await rpc<{ value: AccountInfo[] }>("getMultipleAccounts", [
    owners,
    { encoding: "base64", dataSlice: { offset: 0, length: 0 } },
  ]);

  const pct = (raw: bigint) => (supplyRaw === 0n ? 0 : Number((raw * 1_000_000n) / supplyRaw) / 10_000);
  const ui = (raw: bigint) => Number(raw) / 10 ** decimals;

  const rows: Holder[] = owners.map((owner, i) => {
    const raw = byOwner.get(owner)!;
    const programOwner = ownerInfos.value[i]?.owner;
    let label: string | undefined;

    if (pairAddresses[owner]) label = `Pool ${pairAddresses[owner]}`;
    else if (KNOWN_ADDRESSES[owner]) label = KNOWN_ADDRESSES[owner];
    else if (programOwner && KNOWN_PROGRAMS[programOwner]) label = KNOWN_PROGRAMS[programOwner];
    else if (!isOnCurve(owner)) label = "Program / PDA";
    else if (programOwner && programOwner !== SYSTEM_PROGRAM) label = "Akaun program";

    return { rank: 0, owner, amount: ui(raw), pct: pct(raw), kind: label ? "excluded" : "wallet", label };
  });

  rows.sort((a, b) => b.pct - a.pct);
  const holders = rows.filter((r) => r.kind === "wallet").map((r, i) => ({ ...r, rank: i + 1 }));
  const excluded = rows.filter((r) => r.kind === "excluded");
  const top10Pct = holders.slice(0, 10).reduce((s, h) => s + h.pct, 0);

  return {
    decimals,
    supply: ui(supplyRaw),
    scanned: accounts.length,
    holders,
    excluded,
    top10Pct,
    warning: top10Pct > WARN_THRESHOLD,
  };
}
