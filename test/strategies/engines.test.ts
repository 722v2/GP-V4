import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { StructureEngine, detectSwings, lastBreakOfStructure, trendBias } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine, equalLevels, detectSweep, averageTrueRange } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine, strongCandle, engulfing, wickRejection } from "../../src/strategies/engines/PriceActionEngine.js";
import type { EngineContext } from "../../src/strategies/Engine.js";

const TF = 300_000;

function bar(openTimeIdx: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  const openTime = openTimeIdx * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime, open, high, low, close, volume, closeTime: openTime + TF - 1 };
}

function ctx(candles: Candle[]): EngineContext {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

function makeSwingSequence(): Candle[] {
  // Rising zigzag with unique extremes: HH (2022, 2030) and HL (1996, 2004).
  return [
    bar(0, 2000, 2010, 1998, 2008),
    bar(1, 2008, 2018, 2006, 2016),
    bar(2, 2016, 2022, 2014, 2020), // swing high 2022
    bar(3, 2020, 2021, 2005, 2008),
    bar(4, 2008, 2009, 1996, 2002), // swing low 1996
    bar(5, 2002, 2013, 2000, 2010),
    bar(6, 2010, 2026, 2008, 2024),
    bar(7, 2024, 2030, 2022, 2028), // higher swing high
    bar(8, 2028, 2029, 2012, 2016),
    bar(9, 2016, 2017, 2004, 2010), // higher swing low
    bar(10, 2010, 2026, 2008, 2024),
    bar(11, 2024, 2036, 2022, 2034), // higher swing high
  ];
}

describe("StructureEngine", () => {
  it("detects fractal swing highs and lows", () => {
    const candles = makeSwingSequence();
    const swings = detectSwings(candles, { lookbackBars: 2, minSwingSeparation: 0.5 });
    const highs = swings.filter((s) => s.kind === "swing-high");
    const lows = swings.filter((s) => s.kind === "swing-low");
    expect(highs.length).toBeGreaterThanOrEqual(2);
    expect(lows.length).toBeGreaterThanOrEqual(2);
  });

  it("classifies trend bias as bullish for HH/HL", () => {
    const candles = makeSwingSequence();
    const swings = detectSwings(candles, { lookbackBars: 2, minSwingSeparation: 0.5 });
    expect(trendBias(candles, swings)).toBeGreaterThan(0);
  });

  it("detects break of structure on close through a swing", () => {
    // Build a sequence with a swing high, then a bar that closes above it.
    const candles: Candle[] = [
      bar(0, 2000, 2006, 1998, 2004),
      bar(1, 2004, 2012, 2002, 2010),
      bar(2, 2010, 2018, 2008, 2014), // local top ~2018
      bar(3, 2014, 2008, 2010, 2012),
      bar(4, 2012, 2006, 2004, 2008),
      bar(5, 2008, 2014, 2006, 2012),
      bar(6, 2012, 2026, 2010, 2024), // closes above 2018
    ];
    const swings = detectSwings(candles, { lookbackBars: 2, minSwingSeparation: 0.5 });
    const bos = lastBreakOfStructure(candles, swings);
    expect(bos).not.toBeNull();
    expect(bos!.direction).toBe("LONG");
  });

  it("emits structure evidence from the full engine", () => {
    const engine = new StructureEngine({ lookbackBars: 2, minSwingSeparation: 0.5 });
    const out = engine.analyze(ctx(makeSwingSequence()));
    expect(out.engine).toBe("structure");
    expect(out.evidence.some((e) => e.source === "structure")).toBe(true);
    expect(out.levels!.length).toBeGreaterThan(0);
  });
});

describe("LiquidityEngine", () => {
  it("clusters equal levels within tolerance", () => {
    const levels = equalLevels(
      [
        { openTime: 0, price: 2010.0, kind: "swing-high" },
        { openTime: 1, price: 2010.1, kind: "swing-high" },
        { openTime: 2, price: 2050.0, kind: "swing-high" },
      ],
      0.3
    );
    expect(levels).toHaveLength(1);
    expect(levels[0]).toBeCloseTo(2010.05, 1);
  });

  it("detects a liquidity sweep of a swing low", () => {
    const candles: Candle[] = [
      bar(0, 2000, 2008, 1996, 2006),
      bar(1, 2006, 2010, 2002, 2008),
      bar(2, 2008, 2012, 1994, 2000), // swing low 1994
      bar(3, 2000, 2006, 1996, 2004),
      bar(4, 2004, 2010, 1992, 2006), // wick to 1992, close 2006 above 1994
    ];
    const swings = detectSwings(candles, { lookbackBars: 1, minSwingSeparation: 0.5 });
    const sweep = detectSweep(candles, swings);
    expect(sweep).not.toBeNull();
    expect(sweep!.direction).toBe("LONG");
    expect(sweep!.level).toBe(1994);
  });

  it("computes ATR", () => {
    const candles = [bar(0, 10, 12, 9, 11), bar(1, 11, 14, 10, 13)];
    expect(averageTrueRange(candles, 14)).toBeCloseTo((3 + 5) / 2, 5);
  });

  it("reports sweep evidence when a low is swept and reclaimed", () => {
    const candles: Candle[] = [
      bar(0, 2004, 2010, 2000, 2008),
      bar(1, 2008, 2012, 1998, 2010),
      bar(2, 2010, 2014, 1994, 1998), // swing low 1994 (k=2)
      bar(3, 1998, 2004, 1998, 2002),
      bar(4, 2002, 2008, 2000, 2006),
      bar(5, 2006, 2008, 1996, 2004),
      bar(6, 2004, 2006, 1990, 2002), // wick to 1990, closes back above 1994
    ];
    const engine = new LiquidityEngine({ equalLevelTolerance: 0.3, nearLevelAtrMultiple: 1.5 });
    const out = engine.analyze(ctx(candles));
    expect(out.evidence.some((e) => e.kind === "sell-side-sweep")).toBe(true);
  });
});

describe("PriceActionEngine", () => {
  it("flags a strong bullish candle with dominant body", () => {
    const atr = 5;
    const c = bar(0, 2000, 2012, 1999, 2011); // body 11, range 13, body 0.85, > 0.8*ATR
    expect(strongCandle(c, atr, { strongBodyRatio: 0.6, strongBodyAtrMultiple: 0.8 })).toBe("bullish");
  });

  it("rejects weak/doji candles", () => {
    const c = bar(0, 2000, 2010, 1990, 2000.5);
    expect(strongCandle(c, 5, { strongBodyRatio: 0.6, strongBodyAtrMultiple: 0.8 })).toBeNull();
  });

  it("detects bullish engulfing", () => {
    const candles = [bar(0, 2000, 2004, 1996, 1998), bar(1, 1997, 2010, 1995, 2008)];
    expect(engulfing(candles)).toBe("bullish");
  });

  it("detects lower-wick rejection", () => {
    const c = bar(0, 2000, 2002, 1990, 2001);
    expect(wickRejection(c, 5)).toBe("bullish");
  });

  it("emits price-action evidence for a strong bull close", () => {
    const lead: Candle[] = [bar(0, 2000, 2006, 1994, 2002), bar(1, 2002, 2004, 1996, 2000)];
    const strong = bar(2, 2000, 2014, 1999, 2012);
    const engine = new PriceActionEngine();
    const out = engine.analyze(ctx([...lead, strong]));
    expect(out.evidence.some((e) => e.kind === "strong-bull-candle")).toBe(true);
  });
});
