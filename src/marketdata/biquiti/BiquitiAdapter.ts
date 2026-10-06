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
 * Field mapping from Biquote.io payload to normalized candle.
 */
export interface BiquitiFieldMap {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  tickVolume?: string;
  isOpen?: string;
}

export const DEFAULT_FIELD_MAP: BiquitiFieldMap = {
  openTime: "openTime",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
  tickVolume: "tickVolume",
  isOpen: "isOpen",
};

/**
 * Biquote.io timeframe/interval mapping.
 * GP-V4 timeframes map to Biquote.io's explicit API intervals (1m, 5m, 15m, 1h, 4h, 1d).
 */
export const BIQUOTE_TIMEFRAME_MAP: Record<Timeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
};

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

function parseTimestamp(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ts = Date.parse(v);
    if (!Number.isNaN(ts)) return ts;
  }
  throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `Biquiti payload: field "${field}" missing or non-numeric`);
}

/**
 * Parses a raw Biquote candle array into normalized candles.
 * Tolerates both ISO 8601 strings ("2026-10-06T15:10:00Z") and numeric timestamps.
 * Filters out open/unfinished candles (`isOpen: true` or `closeTime >= now`).
 * Sorts candles ascending by openTime and deduplicates by bar timestamp.
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
  if (!tfMs) {
    throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `Unsupported timeframe: ${timeframe}`);
  }
  const candleMap = new Map<number, Candle>();

  for (const r of raw) {
    // Drop explicitly open bars
    if (r.isOpen === true || (fieldMap.isOpen && r[fieldMap.isOpen] === true)) {
      continue;
    }

    const openTime = parseTimestamp(r[fieldMap.openTime], fieldMap.openTime);
    const closeTime = openTime + tfMs - 1;

    // Drop bars that are still open
    if (closeTime >= now) continue;

    const baseVol = typeof r[fieldMap.volume] === "number" ? (r[fieldMap.volume] as number) : 0;
    const tickKey = fieldMap.tickVolume ?? "tickVolume";
    const tickVol = typeof r[tickKey] === "number" ? (r[tickKey] as number) : 0;
    const volume = baseVol > 0 ? baseVol : tickVol;

    const candle: Candle = {
      symbol,
      timeframe,
      openTime,
      open: numOrThrow(r[fieldMap.open], fieldMap.open),
      high: numOrThrow(r[fieldMap.high], fieldMap.high),
      low: numOrThrow(r[fieldMap.low], fieldMap.low),
      close: numOrThrow(r[fieldMap.close], fieldMap.close),
      volume,
      closeTime,
    };

    candleMap.set(openTime, candle);
  }

  const candles = Array.from(candleMap.values());
  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}

/**
 * Biquote market-data adapter.
 * Connects to Biquote.io API (/api/{symbol}/ohlc?interval=...&limit=...).
 * No API key is required by default.
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
    const symbolMapped = this.cfg.symbolMap["XAUUSD"] ?? "XAUUSD";
    return (
      Boolean(this.cfg.baseUrl) &&
      Boolean(this.cfg.candlesPath) &&
      Boolean(symbolMapped)
    );
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        ok: false,
        detail: "not configured (missing base URL, candles path, or symbol mapping)",
        checkedAt: Date.now(),
      };
    }
    try {
      await this.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 1 });
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
    const providerSymbol = this.cfg.symbolMap[symbol] ?? symbol;
    if (!providerSymbol) {
      throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `no Biquiti symbol mapping for ${symbol}`);
    }

    const biquoteInterval = BIQUOTE_TIMEFRAME_MAP[timeframe] ?? timeframe;

    let path = this.cfg.candlesPath || "/api/{symbol}/ohlc";
    if (path.includes("{symbol}")) {
      path = path.replace("{symbol}", providerSymbol);
    } else if (path.includes(":symbol")) {
      path = path.replace(":symbol", providerSymbol);
    } else if (path === "/v1/candles" || path === "/api/candles") {
      path = `/api/${providerSymbol}/ohlc`;
    } else if (!path.includes(providerSymbol) && !path.endsWith("/ohlc")) {
      path = `${path.replace(/\/$/, "")}/api/${providerSymbol}/ohlc`;
    }

    const baseUrl = this.cfg.baseUrl || "https://biquote.io";
    const url = new URL(path, baseUrl);
    url.searchParams.set("interval", biquoteInterval);
    url.searchParams.set("limit", String(limit));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cfg.apiKey) {
      headers[this.cfg.authHeader || "Authorization"] = this.cfg.apiKey;
    }

    this.log.debug("biquiti fetch", { url: url.toString() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { headers, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, `Biquiti request timed out after ${this.cfg.timeoutMs}ms`);
      }
      throw err;
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
    throw new AppError(ErrorCode.EXTERNAL_CONTRACT, `Biquiti quote endpoint not specified for ${symbol}`);
  }
}

/** Tolerates common payload wrappers ({bars:[...]}, {data:[...]}, {candles:[...]}, or bare array). */
function extractCandleArray(body: unknown): readonly RawCandle[] | null {
  if (Array.isArray(body)) return body as RawCandle[];
  if (body && typeof body === "object") {
    for (const key of ["bars", "candles", "data", "klines", "result"]) {
      const v = (body as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as RawCandle[];
    }
  }
  return null;
}

function seriesKeyStats(symbol: string, timeframe: string): Record<string, string> {
  return { series: `${symbol}:${timeframe}` };
}
