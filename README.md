# ORBIT

Paste CA token Solana → harga, market cap, liquidity (DexScreener) + top holder (Helius).

- Ambil 20 akaun token terbesar (`getTokenLargestAccounts`), gabung ikut wallet pemilik.
- **Tapis** pool / bonding curve / vault: alamat pair DexScreener, alamat dikenali (`lib/known.ts`),
  pemilik ialah PDA (off-curve), atau akaun dimiliki program (Pump.fun, Raydium, Meteora, Orca, PumpSwap, locker…).
  Yang ditapis dipaparkan berasingan.
- % supply setiap wallet, dan **amaran merah jika top 10 pegang > 30%**.

## Jalankan

```bash
cp .env.example .env.local   # isi HELIUS_API_KEY
npm install
npm run dev
```

## Deploy ke Vercel

1. vercel.com → **Add New → Project** → import repo `wapeeyy/orbit` (Next.js dikesan automatik).
2. **Environment Variables**: `HELIUS_API_KEY` = kunci dari dashboard.helius.dev.
3. Deploy.

Atau CLI: `npx vercel --prod` (set `HELIUS_API_KEY` dalam project settings dulu).

Kunci Helius hanya digunakan di server (`app/api/token/route.ts`) — tak pernah dihantar ke browser.

## Had

`getTokenLargestAccounts` pulangkan maksimum 20 akaun, jadi selepas pool ditapis senarai wallet mungkin < 20.
