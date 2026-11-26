// Shared by the browser (what the wallet signs) and /api/trial (rebuilds and checks it)
export const TRIAL_DAYS = 7;
export const PROMO_USD = 10; // first Pro month after a trial
export const PROMO_HOURS = 48; // offer window after the trial ends
export const TRIAL_ULTRA_USD = 5; // upgrade to Ultra for one month, only while the trial is running

export const trialMessage = (wallet: string, time: string) =>
  `ORBIT — start my free ${TRIAL_DAYS}-day Pro trial.\n\nWallet: ${wallet}\nTime: ${time}\n\nSigning is free and does not move any funds.`;
