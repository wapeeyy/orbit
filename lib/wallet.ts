import { rpc } from "./holders";
import { SOL_MINT, solUsd } from "./pay";

// Analisis wallet: pegangan semasa + sejarah swap (Helius Enhanced Transactions API)

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLES = new Set([USDC, USDT]);
const PAGES = 2; // 2 × 100 swap terkini

export type Swap = {
  ts: number; // ms
  side: "BUY" | "SELL";
  mint: string;
  amount: number; // token
  sol: number; // nilai dalam SOL (USDC ditukar ikut harga SOL semasa)
  source: string;
  signature: string;
};

export type TokenStat = {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  buys: number;
  sells: number;
  boughtSol: number;
  soldSol: number;
  boughtAmt: number;
  soldAmt: number;
  realizedSol: number | null; // null = kos tak diketahui (beli sebelum tempoh)
  holdingAmt: number;
  holdingUsd: number | null;
  status: "pegang" | "habis" | "separuh";
  firstTs: number;
  lastTs: number;
};

export type Holding = { mint: string; symbol: string; name: string; image?: string; amount: number; usd: number | null };

export type WalletReport = {
  address: string;
  solBalance: number;
  solUsd: number;
  totalUsd: number;
  holdings: Holding[];
  swaps: Swap[]; // terkini dahulu
  tokens: TokenStat[];
  stats: {
    trades: number;
    tokensTraded: number;
    realizedSol: number;
    winRate: number | null;
    wins: number;
    losses: number;
    volumeSol: number;
    avgBuySol: number | null;
    avgHoldMin: number | null;
    tradesPerDay: number | null;
    periodDays: number | null;
    complete: boolean; // semua swap wallet ni dah dibaca
  };
  labels: string[];
};

type AccountData = {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges?: { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[];
};
type EnhancedTx = { signature: string; timestamp: number; type: string; source: string; accountData?: AccountData[]; transactionError?: unknown };

function heliusKey() {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY belum diset");
  return k;
}
const apiBase = () => process.env.HELIUS_API_BASE || "https://api.helius.xyz";

async function fetchSwaps(address: string) {
  const out: EnhancedTx[] = [];
  let before = "";
  let complete = false;
  for (let page = 0; page < PAGES; page++) {
    const url =
      `${apiBase()}/v0/addresses/${address}/transactions?api-key=${heliusKey()}&type=SWAP&limit=100` +
      (before ? `&before=${before}` : "");
    let res = await fetch(url, { cache: "no-store" });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url, { cache: "no-store" });
    }
    if (!res.ok) {
      if (page === 0) throw new Error(`Helius ${res.status}: tak dapat baca transaksi wallet`);
      break;
    }
    const list = (await res.json()) as EnhancedTx[];
    out.push(...list);
    if (list.length < 100) {
      complete = true;
      break;
    }
    before = list[list.length - 1].signature;
  }
  return { txs: out, complete };
}

/** Tukar satu transaksi kepada swap (dari sudut wallet ni) */
function toSwap(tx: EnhancedTx, wallet: string, solPrice: number): Swap | null {
  if (tx.transactionError || !tx.accountData) return null;
  let sol = 0;
  const tokens = new Map<string, number>();
  for (const a of tx.accountData) {
    if (a.account === wallet) sol += a.nativeBalanceChange / 1e9;
    for (const t of a.tokenBalanceChanges ?? []) {
      if (t.userAccount !== wallet) continue;
      const v = Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals;
      if (t.mint === SOL_MINT) sol += v; // wSOL = SOL
      else tokens.set(t.mint, (tokens.get(t.mint) ?? 0) + v);
    }
  }
  // Stablecoin sebagai mata wang sebut harga
  let stableUsd = 0;
  for (const m of STABLES) {
    if (tokens.has(m)) {
      stableUsd += tokens.get(m)!;
      tokens.delete(m);
    }
  }
  const quoteSol = sol + (solPrice ? stableUsd / solPrice : 0);
  // Token utama = perubahan terbesar (abaikan habuk)
  const main = [...tokens.entries()].filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (!main) return null;
  const [mint, amt] = main;
  const side = amt > 0 ? "BUY" : "SELL";
  // Abaikan transaksi yang tak macam swap (contoh terima airdrop)
  if ((side === "BUY" && quoteSol >= 0) || (side === "SELL" && quoteSol <= 0)) return null;
  return {
    ts: tx.timestamp * 1000,
    side,
    mint,
    amount: Math.abs(amt),
    sol: Math.abs(quoteSol),
    source: tx.source,
    signature: tx.signature,
  };
}

type DasItem = {
  id: string;
  interface: string;
  content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } };
  token_info?: { balance?: number; decimals?: number; symbol?: string; price_info?: { total_price?: number } };
};

async function holdingsOf(address: string) {
  const r = await rpc<{ items: DasItem[]; nativeBalance?: { lamports: number } }>("getAssetsByOwner", {
    ownerAddress: address,
    page: 1,
    limit: 1000,
    displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false },
  });
  const holdings: Holding[] = (r.items ?? [])
    .filter((i) => i.token_info?.balance && (i.interface === "FungibleToken" || i.interface === "FungibleAsset"))
    .map((i) => ({
      mint: i.id,
      symbol: i.token_info?.symbol || i.content?.metadata?.symbol || i.id.slice(0, 4),
      name: i.content?.metadata?.name || "",
      image: i.content?.links?.image,
      amount: (i.token_info!.balance ?? 0) / 10 ** (i.token_info!.decimals ?? 0),
      usd: i.token_info?.price_info?.total_price ?? null,
    }));
  return { holdings, sol: (r.nativeBalance?.lamports ?? 0) / 1e9 };
}

type DexLite = { baseToken: { address: string; symbol: string; name: string }; priceUsd?: string; liquidity?: { usd?: number }; info?: { imageUrl?: string } };

/** Harga & nama dari DexScreener (30 token setiap panggilan) */
async function dexInfo(mints: string[]) {
  const out = new Map<string, { price: number | null; symbol: string; name: string; image?: string; liq: number }>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { cache: "no-store" });
      if (!r.ok) continue;
      for (const p of (await r.json()) as DexLite[]) {
        const cur = out.get(p.baseToken.address);
        const liq = p.liquidity?.usd ?? 0;
        if (cur && cur.liq >= liq) continue;
        out.set(p.baseToken.address, {
          price: p.priceUsd ? Number(p.priceUsd) : null,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          image: p.info?.imageUrl,
          liq,
        });
      }
    } catch {}
  }
  return out;
}

const cache = new Map<string, { at: number; v: WalletReport }>();

export async function traceWallet(address: string): Promise<WalletReport> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < 120_000) return hit.v;

  const [solPrice, { txs, complete }, held] = await Promise.all([solUsd().catch(() => 0), fetchSwaps(address), holdingsOf(address)]);
  const swaps = txs.map((t) => toSwap(t, address, solPrice)).filter((s): s is Swap => s !== null);

  // Nama & harga: token yang didagang + token dipegang tanpa harga
  const needInfo = [
    ...new Set([...swaps.map((s) => s.mint), ...held.holdings.filter((h) => h.usd == null).map((h) => h.mint)]),
  ].slice(0, 90);
  const info = await dexInfo(needInfo);
  for (const h of held.holdings) {
    const d = info.get(h.mint);
    if (h.usd == null && d?.price != null) h.usd = d.price * h.amount;
    if (d && (!h.symbol || h.symbol === h.mint.slice(0, 4))) h.symbol = d.symbol;
    if (d && !h.image) h.image = d.image;
  }
  held.holdings.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const heldMap = new Map(held.holdings.map((h) => [h.mint, h]));

  // Kumpul ikut token
  const byMint = new Map<string, TokenStat>();
  for (const s of [...swaps].reverse()) {
    let t = byMint.get(s.mint);
    if (!t) {
      const d = info.get(s.mint);
      const h = heldMap.get(s.mint);
      t = {
        mint: s.mint,
        symbol: d?.symbol || h?.symbol || s.mint.slice(0, 4) + "…",
        name: d?.name || h?.name || "",
        image: d?.image || h?.image,
        buys: 0, sells: 0, boughtSol: 0, soldSol: 0, boughtAmt: 0, soldAmt: 0,
        realizedSol: null, holdingAmt: h?.amount ?? 0, holdingUsd: h?.usd ?? null,
        status: "pegang", firstTs: s.ts, lastTs: s.ts,
      };
      byMint.set(s.mint, t);
    }
    if (s.side === "BUY") {
      t.buys++;
      t.boughtSol += s.sol;
      t.boughtAmt += s.amount;
    } else {
      t.sells++;
      t.soldSol += s.sol;
      t.soldAmt += s.amount;
    }
    t.lastTs = s.ts;
  }

  let wins = 0, losses = 0, realized = 0;
  const holdTimes: number[] = [];
  for (const t of byMint.values()) {
    if (t.sells > 0 && t.boughtAmt > 0) {
      const frac = Math.min(1, t.soldAmt / t.boughtAmt);
      t.realizedSol = t.soldSol - t.boughtSol * frac;
      realized += t.realizedSol;
      if (t.realizedSol >= 0) wins++;
      else losses++;
      holdTimes.push((t.lastTs - t.firstTs) / 60_000);
    }
    t.status = t.holdingAmt > 0 && t.sells === 0 ? "pegang" : t.holdingAmt > 0 ? "separuh" : "habis";
    if (t.sells === 0 && t.holdingAmt === 0) t.status = "habis"; // dipindah keluar
  }
  const tokens = [...byMint.values()].sort((a, b) => b.boughtSol + b.soldSol - (a.boughtSol + a.soldSol));

  const buys = swaps.filter((s) => s.side === "BUY");
  const first = swaps.length ? swaps[swaps.length - 1].ts : null;
  const last = swaps.length ? swaps[0].ts : null;
  const periodDays = first && last ? Math.max((last - first) / 86_400_000, 1 / 24) : null;
  const totalUsd = held.sol * solPrice + held.holdings.reduce((s, h) => s + (h.usd ?? 0), 0);
  const avgHold = holdTimes.length ? holdTimes.sort((a, b) => a - b)[Math.floor(holdTimes.length / 2)] : null;
  const tradesPerDay = periodDays ? swaps.length / periodDays : null;
  const winRate = wins + losses ? (wins / (wins + losses)) * 100 : null;

  const labels: string[] = [];
  if (totalUsd >= 100_000) labels.push("🐋 Whale");
  if (tradesPerDay != null && tradesPerDay > 150) labels.push("🤖 Bot / sangat laju");
  if (realized >= 10 && (winRate ?? 0) >= 55) labels.push("🔥 Trader untung");
  if (realized <= -10) labels.push("📉 Banyak rugi");
  if (complete && first && Date.now() - first < 3 * 86_400_000) labels.push("🆕 Wallet baru");
  if (avgHold != null && avgHold < 30) labels.push("⚡ Scalper (pegang < 30 min)");
  if (avgHold != null && avgHold > 24 * 60) labels.push("💎 Pegang lama");
  if (swaps.length === 0) labels.push("😴 Tiada swap");

  const v: WalletReport = {
    address,
    solBalance: held.sol,
    solUsd: solPrice,
    totalUsd,
    holdings: held.holdings.slice(0, 30),
    swaps: swaps.slice(0, 60),
    tokens: tokens.slice(0, 40),
    stats: {
      trades: swaps.length,
      tokensTraded: byMint.size,
      realizedSol: realized,
      winRate,
      wins,
      losses,
      volumeSol: swaps.reduce((s, x) => s + x.sol, 0),
      avgBuySol: buys.length ? buys.reduce((s, x) => s + x.sol, 0) / buys.length : null,
      avgHoldMin: avgHold,
      tradesPerDay,
      periodDays,
      complete,
    },
    labels,
  };
  cache.set(address, { at: Date.now(), v });
  return v;
}
