import type { CandleRequest, MarketDataProvider, ProviderHealth } from "../MarketDataProvider.js";
import type { Candle, CandleSeries, Quote } from "../../core/types/Candle.js";
import type { Symbol, Timeframe } from "../../core/types/MarketTypes.js";
import { seriesKey } from "../../core/types/Candle.js";
import { validateCandleSeries } from "../validation.js";
import { AppError, ErrorCode, type Logger } from "../../core/logging/Logger.js";

export interface BiquitiConfig {
  baseUrl: string;
  apiKey: string;
  candlesPath: string;
  authHeader: string;
  symbolMap: Record<string, string>;
  timeoutMs: number;
}

export type RawCandle = Record<string, unknown>;

/**
 * Field mapping from provider payload to normalized candle.
 * The real Biquiti schema is UNVERIFIED. Configure these names instead of hard-coding.
 */
export interface BiquitiFieldMap {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export const DEFAULT_FIELD_MAP: BiquitiFieldMap = {
  openTime: "openTime",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
};

/**
 * Parses a raw Biquiti candle array into normalized candles using a configurable field map.
 * Pure function — unit-tested independently of network transport.
 */
export function parseBiquitiCandles(
  raw: readonly RawCandle[],
  symbol: Symbol,
  timeframe: Timeframe,
  fieldMap: BiquitiFieldMap = DEFAULT_FIELD_MAP,
  opts: { now?: number } = {}
): Candle[] {
  const now = opts.now ?? Date.now();
  const tfMs = TIMEFRAME_MS_SAFE[timeframe];
  const candles: Candle[] = [];
  for (const r of raw) {
    const openTime = numOrThrow(r[fieldMap.openTime], fieldMap.openTime);
    const closeTime = openTime + tfMs - 1;
    const candle: Candle = {
      symbol,
      timeframe,
      openTime,
      open: numOrThrow(r[fieldMap.open], fieldMap.open),
      high: numOrThrow(r[fieldMap.high], fieldMap.high),
      low: numOrThrow(r[fieldMap.low], fieldMap.low),
      close: numOrThrow(r[fieldMap.close], fieldMap.close),
      volume: numOrThrow(r[fieldMap.volume], fieldMap.volume, 0),
      closeTime,
    };
    // Drop bars that are still open — closed bars only.
    if (closeTime >= now) continue;
    candles.push(candle);
  }
  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}

const TIMEFRAME_MS_SAFE: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
};

function numOrThrow(v: unknown, field: string, fallback?: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (fallback !== undefined && (v === undefined || v === null)) return fallback;
  throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `Biquiti payload: field "${field}" missing or non-numeric`);
}

/**
 * Biquiti adapter. Endpoint path, auth header, symbol mapping, and field names
 * are all configuration — the real API contract must come from Biquiti docs.
 * Returns NOT_CONFIGURED until baseUrl/candlesPath/symbol mapping are supplied.
 */
export class BiquitiAdapter implements MarketDataProvider {
  readonly name = "biquiti";

  constructor(
    private readonly cfg: BiquitiConfig,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fieldMap: BiquitiFieldMap = DEFAULT_FIELD_MAP
  ) {}

  isConfigured(): boolean {
    return (
      this.cfg.baseUrl !== "" &&
      this.cfg.candlesPath !== "" &&
      (this.cfg.symbolMap["XAUUSD"] ?? "") !== ""
    );
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: this.name, ok: false, detail: "not configured (missing base URL, candles path, or symbol mapping)", checkedAt: Date.now() };
    }
    try {
      await this.fetchCandles({ symbol: "XAUUSD", timeframe: "M1", limit: 1 });
      return { provider: this.name, ok: true, detail: "ok", checkedAt: Date.now() };
    } catch (err) {
      return { provider: this.name, ok: false, detail: err instanceof Error ? err.message : String(err), checkedAt: Date.now() };
    }
  }

  async fetchCandles(req: CandleRequest): Promise<CandleSeries> {
    const { symbol, timeframe, limit } = req;
    if (!this.isConfigured()) {
      throw new AppError(
        ErrorCode.EXTERNAL_UNAVAILABLE,
        `Biquiti adapter not configured for ${seriesKey(symbol, timeframe)} — set BIQUITI_BASE_URL, BIQUITI_CANDLES_PATH, BIQUITI_SYMBOL_MAP_*`
      );
    }
    const providerSymbol = this.cfg.symbolMap[symbol];
    if (!providerSymbol) {
      throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `no Biquiti symbol mapping for ${symbol}`);
    }

    const url = new URL(this.cfg.candlesPath, this.cfg.baseUrl);
    url.searchParams.set("symbol", providerSymbol);
    url.searchParams.set("interval", timeframe);
    url.searchParams.set("limit", String(limit));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cfg.apiKey) {
      // Header value format (Bearer vs raw) is provider-specific; config owns it.
      headers[this.cfg.authHeader] = this.cfg.apiKey;
    }

    this.log.debug("biquiti fetch", { url: url.toString() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, `Biquiti HTTP ${res.status}`, { status: res.status });
    }
    const body: unknown = await res.json();
    const raw = extractCandleArray(body);
    if (!raw) {
      throw new AppError(ErrorCode.EXTERNAL_CONTRACT, "Biquiti payload: could not locate candle array");
    }
    const candles = parseBiquitiCandles(raw, symbol, timeframe, this.fieldMap).slice(-limit);
    const series: CandleSeries = { symbol, timeframe, candles };
    validateCandleSeries(series);
    this.log.info("biquiti fetch ok", { ...seriesKeyStats(symbol, timeframe), bars: candles.length });
    return series;
  }

  async fetchQuote(symbol: Symbol): Promise<Quote> {
    // Quote endpoint is UNVERIFIED in the Biquiti contract — not implemented until documented.
    throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `Biquiti quote endpoint not specified for ${symbol}`);
  }
}

/** Tolerates common payload wrappers ({data:[...]}, {candles:[...]}, or bare array). */
function extractCandleArray(body: unknown): readonly RawCandle[] | null {
  if (Array.isArray(body)) return body as RawCandle[];
  if (body && typeof body === "object") {
    for (const key of ["candles", "data", "bars", "klines", "result"]) {
      const v = (body as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as RawCandle[];
    }
  }
  return null;
}

function seriesKeyStats(symbol: string, timeframe: string): Record<string, string> {
  return { series: `${symbol}:${timeframe}` };
}
