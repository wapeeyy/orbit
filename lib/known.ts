// Program & alamat yang dikenali: pool DEX, bonding curve, locker, burn.
// Digunakan untuk label sahaja — penapis utama ialah semakan PDA/program (lib/holders.ts).

export const KNOWN_PROGRAMS: Record<string, string> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun bonding curve",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap pool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM pool",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "Raydium CPMM pool",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM pool",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "Raydium LaunchLab curve",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM pool",
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: "Meteora AMM pool",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2 pool",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora bonding curve",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG: "Moonshot bonding curve",
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: "Streamflow lock",
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: "Jupiter lock",
};

export const KNOWN_ADDRESSES: Record<string, string> = {
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium AMM authority",
  GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL: "Raydium CPMM authority",
  WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh: "Raydium LaunchLab authority",
  "1nc1nerator11111111111111111111111111111111": "Burn (incinerator)",
};

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
