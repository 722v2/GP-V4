import fs from "node:fs";
import path from "node:path";
import type { Candle } from "../../core/types/Candle.js";
import type { Symbol, Timeframe } from "../../core/types/MarketTypes.js";
import { TIMEFRAME_MS, isTimeframe } from "../../core/types/MarketTypes.js";
import { CandleSchema } from "../validation.js";
import { AppError, ErrorCode } from "../../core/logging/Logger.js";

export interface CsvLoaderOptions {
  readonly symbol?: Symbol | string;
  readonly timeframe?: Timeframe | string;
  readonly defaultVolume?: number;
}

export class CsvLoader {
  /**
   * Parses a CSV string containing candle data.
   * Auto-detects headers or positional columns (time, open, high, low, close, volume).
   * Validates each candle and returns them sorted chronologically ascending by openTime.
   */
  static parseCsv(csvContent: string, opts: CsvLoaderOptions = {}): Candle[] {
    const symbol = (opts.symbol as string) ?? "XAUUSD";
    const tf = (opts.timeframe as string) ?? "M5";
    if (!isTimeframe(tf)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Invalid timeframe: ${tf}`);
    }
    const tfMs = TIMEFRAME_MS[tf as Timeframe];
    const defaultVol = opts.defaultVolume ?? 100;

    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length === 0) return [];

    let headerCols: string[] | null = null;
    let startIndex = 0;

    const firstLineCols = lines[0]!.split(",").map((c) => c.trim().toLowerCase());
    const isHeader = firstLineCols.some((c) =>
      ["open", "high", "low", "close", "time", "date", "timestamp", "opentime", "vol", "volume"].includes(c)
    );

    if (isHeader) {
      headerCols = firstLineCols;
      startIndex = 1;
    }

    let timeIdx = 0;
    let openIdx = 1;
    let highIdx = 2;
    let lowIdx = 3;
    let closeIdx = 4;
    let volIdx = 5;

    if (headerCols) {
      timeIdx = headerCols.findIndex((c) => ["opentime", "timestamp", "time", "date", "datetime"].includes(c));
      openIdx = headerCols.findIndex((c) => ["open", "o"].includes(c));
      highIdx = headerCols.findIndex((c) => ["high", "h"].includes(c));
      lowIdx = headerCols.findIndex((c) => ["low", "l"].includes(c));
      closeIdx = headerCols.findIndex((c) => ["close", "c"].includes(c));
      volIdx = headerCols.findIndex((c) => ["volume", "vol", "v"].includes(c));

      if (timeIdx === -1) timeIdx = 0;
      if (openIdx === -1) openIdx = 1;
      if (highIdx === -1) highIdx = 2;
      if (lowIdx === -1) lowIdx = 3;
      if (closeIdx === -1) closeIdx = 4;
    }

    const candles: Candle[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i]!;
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      if (cols.length < 5) continue;

      const rawTime = cols[timeIdx];
      const rawOpen = cols[openIdx];
      const rawHigh = cols[highIdx];
      const rawLow = cols[lowIdx];
      const rawClose = cols[closeIdx];
      const rawVol = volIdx !== -1 && cols[volIdx] ? cols[volIdx] : String(defaultVol);

      if (!rawTime || !rawOpen || !rawHigh || !rawLow || !rawClose) continue;

      const openTime = parseTimestamp(rawTime);
      if (!Number.isFinite(openTime) || openTime <= 0) continue;

      const open = Number(rawOpen);
      const high = Number(rawHigh);
      const low = Number(rawLow);
      const close = Number(rawClose);
      const volume = Number(rawVol) || defaultVol;

      const normalized = {
        symbol,
        timeframe: tf,
        openTime,
        open,
        high,
        low,
        close,
        volume,
        closeTime: openTime + tfMs - 1,
      };

      const parseResult = CandleSchema.safeParse(normalized);
      if (!parseResult.success) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `CSV row ${i + 1} failed validation: ${parseResult.error.message}`
        );
      }

      candles.push(parseResult.data as Candle);
    }

    // Sort chronologically ascending
    candles.sort((a, b) => a.openTime - b.openTime);
    return candles;
  }

  static loadFromCsvFile(filePath: string, opts: CsvLoaderOptions = {}): Candle[] {
    if (!fs.existsSync(filePath)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `CSV file does not exist: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return CsvLoader.parseCsv(content, opts);
  }

  static loadFromCsvDir(dirPath: string, opts: CsvLoaderOptions = {}): Candle[] {
    if (!fs.existsSync(dirPath)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `CSV directory does not exist: ${dirPath}`);
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const csvFiles = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".csv"))
      .map((e) => e.name)
      .sort();

    const allCandles: Candle[] = [];
    for (const filename of csvFiles) {
      const fullPath = path.join(dirPath, filename);
      const candles = CsvLoader.loadFromCsvFile(fullPath, opts);
      allCandles.push(...candles);
    }

    allCandles.sort((a, b) => a.openTime - b.openTime);
    return allCandles;
  }
}

function parseTimestamp(raw: string): number {
  if (!raw) return NaN;
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    return num < 1e11 ? num * 1000 : num;
  }
  const normalizedStr = raw.replace(/\./g, "-");
  const parsed = Date.parse(normalizedStr);
  return Number.isFinite(parsed) ? parsed : NaN;
}
