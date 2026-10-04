import type { Candle } from "../core/types/Candle.js";
import type { Direction, Evidence } from "../core/types/Setup.js";
import type { Timeframe } from "../core/types/MarketTypes.js";

/** Input slice passed to analysis engines. Candles are closed bars, ascending. */
export interface EngineContext {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Closed candles ascending by openTime. The last element is the most recent closed bar. */
  readonly candles: readonly Candle[];
}

export interface EngineOutput {
  readonly engine: string;
  readonly evidence: readonly Evidence[];
  /** Optional structure levels the engine wants the confluence layer to see. */
  readonly levels?: readonly EngineLevel[];
}

export interface EngineLevel {
  readonly price: number;
  /** "swing-high" | "swing-low" | "equal-high" | "equal-low" | "range" | other engine-specific kind. */
  readonly kind: string;
  readonly touchedAt: number;
}

/** A stateless analysis engine: same input -> same output. Engines never call external services. */
export interface AnalysisEngine {
  readonly id: string;
  analyze(ctx: EngineContext): EngineOutput;
}

export function lastN<T>(items: readonly T[], n: number): readonly T[] {
  return n <= 0 ? [] : items.slice(-n);
}

export function signedWeight(direction: Direction, magnitude: number): number {
  const m = Math.max(0, Math.min(1, magnitude));
  return direction === "LONG" ? m : -m;
}
