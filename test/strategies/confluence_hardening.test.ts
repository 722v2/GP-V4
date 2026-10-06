import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { IndicatorEngine } from "../../src/strategies/engines/IndicatorEngine.js";
import { ZoneEngine } from "../../src/strategies/engines/ZoneEngine.js";
import { RegimeEngine } from "../../src/strategies/engines/RegimeEngine.js";
import { SessionEngine } from "../../src/strategies/engines/SessionEngine.js";
import type { EngineContext } from "../../src/strategies/Engine.js";

const TF = 300_000;

function bar(idx: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  const openTime = idx * TF;
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + TF - 1,
  };
}

function ctx(candles: Candle[]): EngineContext {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

describe("Part C — Strategy / Engine / Confluence Hardening Suite", () => {
  it("1. Confluence requires at least 2 independent engines by default (single engine cannot declare direction)", () => {
    // Engine that provides strong single-source signal
    const singleEngine = {
      id: "solo",
      analyze: () => ({
        engine: "solo",
        evidence: [{ source: "solo", kind: "big-move", detail: "huge momentum", weight: 1.0 }],
      }),
    };

    const confluence = new ConfluenceEngine([singleEngine], { minScore: 0.5, maxEngineWeight: 1.5, minSupportingEngines: 2 });
    const result = confluence.evaluate(ctx([bar(0, 10, 15, 9, 14)]));

    expect(result.score).toBeGreaterThanOrEqual(0.5);
    // Despite score >= 0.5, direction remains null because only 1 engine supported it
    expect(result.direction).toBeNull();
    expect(result.supportingEngines).toEqual(["solo"]);
  });

  it("2. Confluence resolves direction when 2 distinct independent engines agree", () => {
    const engine1 = {
      id: "structure",
      analyze: () => ({
        engine: "structure",
        evidence: [{ source: "structure", kind: "bullish-bos", detail: "break of structure", weight: 0.5 }],
      }),
    };
    const engine2 = {
      id: "price-action",
      analyze: () => ({
        engine: "price-action",
        evidence: [{ source: "price-action", kind: "strong-bull-candle", detail: "dominant bull body", weight: 0.6 }],
      }),
    };

    const confluence = new ConfluenceEngine([engine1, engine2], { minScore: 0.5, maxEngineWeight: 1.5, minSupportingEngines: 2 });
    const result = confluence.evaluate(ctx([bar(0, 10, 15, 9, 14)]));

    expect(result.score).toBeCloseTo(1.1, 2);
    expect(result.direction).toBe("LONG");
    expect(result.supportingEngines).toEqual(["structure", "price-action"]);
  });

  it("3. IndicatorEngine evaluates MACD & RSI as supporting momentum evidence", () => {
    const indicatorEngine = new IndicatorEngine({ macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9, rsiPeriod: 14 });
    // 40 rising bars to satisfy MACD and RSI lookbacks
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push(bar(i, 2000 + i * 2, 2003 + i * 2, 1999 + i * 2, 2002 + i * 2));
    }
    const out = indicatorEngine.analyze(ctx(candles));
    expect(out.engine).toBe("indicator");
    expect(out.evidence.length).toBeGreaterThan(0);
    expect(out.evidence.some((e) => e.kind.includes("macd") || e.kind.includes("rsi"))).toBe(true);
  });

  it("4. ZoneEngine detects demand/supply order block zones", () => {
    const zoneEngine = new ZoneEngine({ lookbackBars: 20, minImpulseAtrMultiple: 1.0, nearZoneAtrMultiple: 2.0 });
    // Base candle followed by strong bullish impulse
    const candles: Candle[] = [
      bar(0, 2000, 2002, 1995, 1996), // down base candle (demand zone)
      bar(1, 1996, 2015, 1996, 2012), // strong bullish impulse
      bar(2, 2012, 2018, 2010, 2015),
      bar(3, 2015, 2016, 2000, 2001), // pull back near demand zone
      bar(4, 2001, 2005, 1999, 2003),
    ];
    const out = zoneEngine.analyze(ctx(candles));
    expect(out.engine).toBe("zone");
    expect(out.levels!.some((l) => l.kind.includes("zone"))).toBe(true);
  });

  it("5. RegimeEngine & SessionEngine provide macro and session context", () => {
    const regime = new RegimeEngine({ fastEmaPeriod: 5, slowEmaPeriod: 10, atrPeriod: 5 });
    const session = new SessionEngine();

    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) {
      candles.push(bar(i, 2000 + i, 2002 + i, 1999 + i, 2001 + i));
    }
    const regimeOut = regime.analyze(ctx(candles));
    const sessionOut = session.analyze(ctx(candles));

    expect(regimeOut.engine).toBe("regime");
    expect(regimeOut.evidence.some((e) => e.kind.includes("regime"))).toBe(true);
    expect(sessionOut.engine).toBe("session");
    expect(sessionOut.evidence.some((e) => e.kind.includes("session"))).toBe(true);
  });
});
