import type { Candle, CandleSeries, Quote } from "../core/types/Candle.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";

export interface CandleRequest {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  /** Maximum number of most-recent closed bars to return. */
  readonly limit: number;
}

/**
 * Boundary for market-data providers. Implementations MUST:
 * - return only CLOSED bars (no partial current bar),
 * - order candles ascending by openTime,
 * - map provider symbols to internal symbols,
 * - never fabricate data.
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchCandles(req: CandleRequest): Promise<CandleSeries>;
  fetchQuote?(symbol: Symbol): Promise<Quote>;
}

export interface ProviderHealth {
  readonly provider: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly checkedAt: number;
}
