# ORBIT

**Cari Coin** — tarik coin Solana dari DexScreener (profil baru, boost, CTO), semak liquidity / MC / volume / umur,
top holder, dan mint/freeze authority, lalu tunjuk mana yang lulus. Penapis boleh diubah dalam app; refresh setiap minit.

**Scan CA** —
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

## Langganan ORBIT Pro (RM100 / 30 hari)

- Tanpa langganan: 3 coin teratas dalam Cari Coin (dan laporan penuh untuk 3 coin tu sahaja).
- Bayar USDC atau SOL ke `PAY_WALLET`. Dua cara:
  1. **Solana Pay** (QR / butang wallet) — ada `reference` unik; app semak sendiri setiap 6 s dan aktifkan automatik.
  2. **Exchange / wallet lain** — pelanggan paste Transaction ID, server semak di blockchain.
- Server sahkan: transaksi berjaya, ≤ 72 jam, wallet penerima dapat ≥ 97% harga (USDC, atau SOL × harga Jupiter).
  Bayar 2× = 60 hari (maks 12 bulan). Setiap transaksi hanya boleh dituntut sekali (Upstash Redis).
- Kod akses = payload bertandatangan HMAC (tiada akaun/kata laluan). Pelanggan simpan kod untuk guna di peranti lain.

### Setup di Vercel (sekali sahaja)

1. **Storage → Create Database → Upstash (Redis)** → sambung ke projek `orbit`. Ini isi `KV_REST_API_URL` & `KV_REST_API_TOKEN`.
2. Pilihan — **Settings → Environment Variables**: `PRICE_USDC`, `ORBIT_SECRET`, `PAY_WALLET` (lalai: `ADukwrnGbjfBPY9CSErNuog1LBibbkdnd9kpnbH5fjeY`).
3. Redeploy.

Kalau `ORBIT_SECRET` tak diset, `HELIUS_API_KEY` digunakan — tukar kunci Helius = semua kod akses lama jadi tak sah.

## App phone (PWA)

`app/manifest.ts`, `public/sw.js`, ikon dalam `public/`. iPhone: Safari → Share → Add to Home Screen.
Android: Chrome → Install app. Panduan pelanggan: `public/panduan-orbit.pdf`.
