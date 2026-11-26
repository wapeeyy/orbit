import { analyse, type Candle } from "./ta";

// How often the ORBIT Read was right on this coin's own history:
// replay the read at past candles and check the move over the next `horizon` candles.
export type Backtest = {
  horizon: number;
  bull: { n: number; hit: number; avg: number };
  bear: { n: number; hit: number; avg: number };
  samples: number;
};

export function backtest(cs: Candle[], horizon = 6): Backtest | null {
  if (cs.length < 80) return null;
  const bull = { n: 0, hit: 0, sum: 0 };
  const bear = { n: 0, hit: 0, sum: 0 };
  const step = Math.max(2, Math.floor((cs.length - 60) / 50));
  for (let i = 60; i + horizon < cs.length; i += step) {
    const read = analyse(cs.slice(0, i + 1)).read;
    const ret = (cs[i + horizon].c / cs[i].c - 1) * 100;
    if (read.bias === "Bullish") {
      bull.n++;
      bull.sum += ret;
      if (ret > 0) bull.hit++;
    } else if (read.bias === "Bearish") {
      bear.n++;
      bear.sum += ret;
      if (ret < 0) bear.hit++;
    }
  }
  const pack = (x: typeof bull) => ({ n: x.n, hit: x.n ? Math.round((x.hit / x.n) * 100) : 0, avg: x.n ? x.sum / x.n : 0 });
  return { horizon, bull: pack(bull), bear: pack(bear), samples: bull.n + bear.n };
}
