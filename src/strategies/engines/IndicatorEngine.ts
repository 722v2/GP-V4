import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";

export interface IndicatorEngineConfig {
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  rsiPeriod: number;
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorEngineConfig = {
  macdFastPeriod: 12,
  macdSlowPeriod: 26,
  macdSignalPeriod: 9,
  rsiPeriod: 14,
};

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Exponential Moving Average calculation.
 */
export function ema(values: readonly number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];

  let sum = 0;
  const initialPeriod = Math.min(period, values.length);
  for (let i = 0; i < initialPeriod; i++) {
    sum += values[i]!;
  }
  let currentEma = sum / initialPeriod;
  out.push(currentEma);

  for (let i = initialPeriod; i < values.length; i++) {
    currentEma = values[i]! * k + currentEma * (1 - k);
    out.push(currentEma);
  }
  return out;
}

/**
 * Calculates MACD (Fast, Slow, Signal) over closed candle closes.
 */
export function calculateMacd(
  closes: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult | null {
  if (closes.length < slowPeriod + signalPeriod) {
    return null;
  }
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);

  // Align EMAs
  const minLen = Math.min(fastEma.length, slowEma.length);
  const macdLine: number[] = [];
  const fastOffset = fastEma.length - minLen;
  const slowOffset = slowEma.length - minLen;

  for (let i = 0; i < minLen; i++) {
    macdLine.push(fastEma[fastOffset + i]! - slowEma[slowOffset + i]!);
  }

  const signalEma = ema(macdLine, signalPeriod);
  if (signalEma.length === 0 || macdLine.length === 0) return null;

  const lastMacd = macdLine[macdLine.length - 1]!;
  const lastSignal = signalEma[signalEma.length - 1]!;
  const histogram = lastMacd - lastSignal;

  return {
    macd: lastMacd,
    signal: lastSignal,
    histogram,
  };
}

/**
 * Calculates RSI (Relative Strength Index).
 */
export function calculateRsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Indicator & Momentum Engine:
 * Evaluates MACD histogram/crossover and RSI as SUPPORTING momentum evidence.
 * Invariant (Part C): MACD/RSI is strictly supporting momentum/confluence evidence
 * and NEVER becomes a hard entry blocker or filter.
 */
export class IndicatorEngine implements AnalysisEngine {
  readonly id = "indicator";

  constructor(private readonly cfg: IndicatorEngineConfig = DEFAULT_INDICATOR_CONFIG) {}

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length < this.cfg.macdSlowPeriod + this.cfg.macdSignalPeriod) {
      return { engine: this.id, evidence: [] };
    }

    const closes = candles.map((c: Candle) => c.close);
    const evidence = [];

    // 1. MACD Momentum (Supporting evidence only)
    const macd = calculateMacd(
      closes,
      this.cfg.macdFastPeriod,
      this.cfg.macdSlowPeriod,
      this.cfg.macdSignalPeriod
    );

    if (macd) {
      if (macd.histogram > 0 && macd.macd > macd.signal) {
        evidence.push({
          source: "indicator",
          kind: "macd-bullish-momentum",
          detail: `MACD bullish histogram (${macd.histogram.toFixed(3)}), MACD > Signal`,
          weight: signedWeight("LONG", 0.35),
        });
      } else if (macd.histogram < 0 && macd.macd < macd.signal) {
        evidence.push({
          source: "indicator",
          kind: "macd-bearish-momentum",
          detail: `MACD bearish histogram (${macd.histogram.toFixed(3)}), MACD < Signal`,
          weight: signedWeight("SHORT", 0.35),
        });
      }
    }

    // 2. RSI Momentum
    const rsi = calculateRsi(closes, this.cfg.rsiPeriod);
    if (rsi !== null) {
      if (rsi >= 50 && rsi < 70) {
        evidence.push({
          source: "indicator",
          kind: "rsi-bullish-momentum",
          detail: `RSI in bullish expansion zone (${rsi.toFixed(1)})`,
          weight: signedWeight("LONG", 0.25),
        });
      } else if (rsi <= 50 && rsi > 30) {
        evidence.push({
          source: "indicator",
          kind: "rsi-bearish-momentum",
          detail: `RSI in bearish expansion zone (${rsi.toFixed(1)})`,
          weight: signedWeight("SHORT", 0.25),
        });
      }
    }

    return { engine: this.id, evidence };
  }
}
