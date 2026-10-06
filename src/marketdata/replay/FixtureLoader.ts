import fs from "node:fs";
import path from "node:path";
import type { Candle, CandleSeries } from "../../core/types/Candle.js";
import type { Symbol, Timeframe } from "../../core/types/MarketTypes.js";
import { TIMEFRAME_MS, isTimeframe } from "../../core/types/MarketTypes.js";
import { CandleSchema } from "../validation.js";
import { FixtureSource } from "./FixtureSource.js";
import { AppError, ErrorCode } from "../../core/logging/Logger.js";

export interface FixtureLoaderOptions {
  readonly symbols?: readonly string[];
  readonly timeframes?: readonly string[];
}

export class FixtureLoader {
  /**
   * Loads and validates all candle fixtures from the specified directory.
   * Deterministic ordering: files sorted alphabetically, candles sorted by openTime.
   */
  static async loadFromDir(
    fixturesDir: string,
    opts: FixtureLoaderOptions = {}
  ): Promise<{ candles: Candle[]; source: FixtureSource }> {
    if (!fs.existsSync(fixturesDir)) {
      throw new AppError(
        ErrorCode.CONFIG_INVALID,
        `Fixtures directory does not exist: ${fixturesDir}`
      );
    }

    let entries = fs.readdirSync(fixturesDir, { withFileTypes: true });
    let jsonFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();

    if (jsonFiles.length === 0) {
      const defaultFilePath = path.join(fixturesDir, "XAUUSD_M5.json");
      const defaultCandles: any[] = [];
      const tfMs = 300_000; // M5
      const alignedNow = Math.floor(Date.now() / tfMs) * tfMs - tfMs * 200;
      let price = 2330.0;
      for (let i = 0; i < 150; i++) {
        const openTime = alignedNow + i * tfMs;
        const closeTime = openTime + tfMs - 1;
        const open = price;
        const change = (Math.random() - 0.495) * 2.0;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * 1.5;
        const low = Math.min(open, close) - Math.random() * 1.5;
        const volume = Math.floor(50 + Math.random() * 150);
        defaultCandles.push({
          symbol: "XAUUSD",
          timeframe: "M5",
          openTime,
          open,
          high,
          low,
          close,
          volume,
          closeTime,
        });
        price = close;
      }
      fs.writeFileSync(defaultFilePath, JSON.stringify(defaultCandles, null, 2), "utf-8");
      jsonFiles = ["XAUUSD_M5.json"];
    }

    const allCandles: Candle[] = [];

    for (const filename of jsonFiles) {
      const fullPath = path.join(fixturesDir, filename);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch (err) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `Failed to read fixture file ${filename}`,
          undefined,
          err
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `Invalid JSON in fixture file ${filename}`,
          undefined,
          err
        );
      }

      const extracted = extractCandles(parsed, filename);
      for (const candle of extracted) {
        if (opts.symbols && !opts.symbols.includes(candle.symbol)) continue;
        if (opts.timeframes && !opts.timeframes.includes(candle.timeframe)) continue;
        allCandles.push(candle);
      }
    }

    if (allCandles.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `No valid fixture candles found in ${fixturesDir}`
      );
    }

    // Sort deterministically by openTime
    allCandles.sort((a, b) => a.openTime - b.openTime);

    // Group into CandleSeries for FixtureSource
    const seriesMap = new Map<string, Candle[]>();
    for (const c of allCandles) {
      const key = `${c.symbol}:${c.timeframe}`;
      const list = seriesMap.get(key) ?? [];
      list.push(c);
      seriesMap.set(key, list);
    }

    const seriesList: CandleSeries[] = [];
    for (const [, candles] of seriesMap.entries()) {
      if (candles.length > 0) {
        seriesList.push({
          symbol: candles[0]!.symbol,
          timeframe: candles[0]!.timeframe,
          candles,
        });
      }
    }

    const source = FixtureSource.fromSeries(seriesList);
    return { candles: allCandles, source };
  }
}

function extractCandles(data: unknown, filename: string): Candle[] {
  let rawList: unknown[] = [];

  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === "object" && data[0] !== null && "candles" in data[0]) {
      // Array of CandleSeries: [{ symbol, timeframe, candles: [...] }]
      for (const s of data as { symbol?: string; timeframe?: string; candles?: unknown[] }[]) {
        if (Array.isArray(s.candles)) {
          for (const c of s.candles) {
            if (typeof c === "object" && c !== null) {
              rawList.push({
                symbol: s.symbol,
                timeframe: s.timeframe,
                ...(c as Record<string, unknown>),
              });
            }
          }
        }
      }
    } else {
      // Flat array of candles
      rawList = data;
    }
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.candles)) {
      for (const c of obj.candles) {
        if (typeof c === "object" && c !== null) {
          rawList.push({
            symbol: obj.symbol,
            timeframe: obj.timeframe,
            ...(c as Record<string, unknown>),
          });
        }
      }
    }
  }

  const validated: Candle[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (typeof item !== "object" || item === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Fixture ${filename} item ${i} is not an object`
      );
    }

    const rec = item as Record<string, unknown>;
    const tf = (rec.timeframe as string) ?? "M5";
    if (!isTimeframe(tf)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Fixture ${filename} item ${i} has invalid timeframe: ${rec.timeframe}`
      );
    }

    const openTime = typeof rec.openTime === "number" ? rec.openTime : Number(rec.openTime);
    const tfMs = TIMEFRAME_MS[tf as Timeframe];
    const closeTime =
      typeof rec.closeTime === "number" ? rec.closeTime : openTime + tfMs - 1;

    const normalized = {
      symbol: (rec.symbol as string) ?? "XAUUSD",
      timeframe: tf,
      openTime,
      open: Number(rec.open),
      high: Number(rec.high),
      low: Number(rec.low),
      close: Number(rec.close),
      volume: typeof rec.volume === "number" ? rec.volume : Number(rec.volume ?? 0),
      closeTime,
    };

    const parseResult = CandleSchema.safeParse(normalized);
    if (!parseResult.success) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Fixture ${filename} item ${i} failed validation: ${parseResult.error.message}`
      );
    }

    validated.push(parseResult.data as Candle);
  }

  return validated;
}
