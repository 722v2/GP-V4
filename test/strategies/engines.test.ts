import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { StructureEngine, detectSwings, lastBreakOfStructure, trendBias } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine, equalLevels, detectEqualLevelClusters, detectSweep, averageTrueRange } from "../../src/strategies/engines/LiquidityEngine.js";
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

describe("P1-3: Liquidity Engine Correction", () => {
  it("A: An upside liquidity level below current price is rejected", () => {
    // Equal highs near 2010.05, but current price closes at 2020.0
    const candles: Candle[] = [
      bar(0, 2000, 2005, 1995, 2002),
      bar(1, 2002, 2010.0, 2000, 2004), // swing high 2010.0
      bar(2, 2004, 2006, 1998, 2000),   // valley
      bar(3, 2000, 2010.1, 1999, 2005), // swing high 2010.1
      bar(4, 2005, 2007, 2001, 2003),   // valley
      bar(5, 2003, 2022, 2002, 2020),   // close at 2020.0 (above equal highs)
    ];
    const engine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 1.5 });
    const out = engine.analyze(ctx(candles));

    // The equal-high was detected structurally in levels...
    expect(out.levels!.some((l) => l.kind === "equal-high")).toBe(true);
    // ...but rejected as overhead resting liquidity because it is BELOW current price 2020
    expect(out.evidence.some((e) => e.kind === "equal-highs-overhead")).toBe(false);
  });

  it("B: A downside liquidity level above current price is rejected", () => {
    // Equal lows near 2002.05, but current price closes at 1995.0
    const candles: Candle[] = [
      bar(0, 2010, 2015, 2008, 2012),
      bar(1, 2012, 2014, 2002.0, 2010), // swing low 2002.0
      bar(2, 2010, 2018, 2006, 2015),   // peak
      bar(3, 2015, 2016, 2002.1, 2011), // swing low 2002.1
      bar(4, 2011, 2019, 2008, 2016),   // peak
      bar(5, 2016, 2017, 1992, 1995),   // close at 1995.0 (below equal lows)
    ];
    const engine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 1.5 });
    const out = engine.analyze(ctx(candles));

    // The equal-low was detected structurally in levels...
    expect(out.levels!.some((l) => l.kind === "equal-low")).toBe(true);
    // ...but rejected as downside resting liquidity because it is ABOVE current price 1995
    expect(out.evidence.some((e) => e.kind === "equal-lows-below")).toBe(false);
  });

  it("C: Multiple valid upside levels exist → newest valid level is selected", () => {
    // Older equal highs at 2015 (bars 1 & 3), newer equal highs at 2025 (bars 5 & 7)
    // Current price closes at 2010 (both 2015 and 2025 are above price and within ATR proximity)
    const candles: Candle[] = [
      bar(0, 2005, 2008, 2004, 2006),
      bar(1, 2006, 2015.0, 2005, 2010), // swing high 2015.0 (t=1)
      bar(2, 2010, 2012, 2002, 2009),   // valley (low 2002 < 2005 & 2008)
      bar(3, 2009, 2015.1, 2008, 2011), // swing high 2015.1 (t=3) -> Cluster 1 ~ 2015.05, touchedAt=3
      bar(4, 2011, 2014, 2004, 2012),   // valley (low 2004 < 2008 & 2011)
      bar(5, 2012, 2025.0, 2011, 2018), // swing high 2025.0 (t=5)
      bar(6, 2018, 2020, 2007, 2016),   // valley (low 2007 < 2011 & 2015)
      bar(7, 2016, 2025.1, 2015, 2020), // swing high 2025.1 (t=7) -> Cluster 2 ~ 2025.05, touchedAt=7
      bar(8, 2020, 2022, 2012, 2014),
      bar(9, 2014, 2016, 2008, 2010),   // close at 2010 (below both 2015 and 2025)
    ];
    const engine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 2.0 });
    const out = engine.analyze(ctx(candles));

    const ev = out.evidence.find((e) => e.kind === "equal-highs-overhead");
    expect(ev).toBeDefined();
    // Newest valid level (2025.05) must be selected, NOT older level (2015.05)
    expect(ev!.detail).toContain("2025.05");
  });

  it("D: Multiple valid downside levels exist → newest valid level is selected", () => {
    // Older equal lows at 2005 (bars 1 & 3), newer equal lows at 1995 (bars 5 & 7)
    // Current price closes at 2010 (both 2005 and 1995 are below price and within ATR proximity)
    const candles: Candle[] = [
      bar(0, 2012, 2015, 2010, 2014),
      bar(1, 2014, 2018, 2005.0, 2012), // swing low 2005.0 (t=1)
      bar(2, 2012, 2020, 2011, 2017),
      bar(3, 2017, 2022, 2005.1, 2016), // swing low 2005.1 (t=3) -> Cluster 1 ~ 2005.05, touchedAt=3
      bar(4, 2016, 2024, 2013, 2020),
      bar(5, 2020, 2022, 1995.0, 2015), // swing low 1995.0 (t=5)
      bar(6, 2015, 2025, 2012, 2018),
      bar(7, 2018, 2026, 1995.1, 2017), // swing low 1995.1 (t=7) -> Cluster 2 ~ 1995.05, touchedAt=7
      bar(8, 2017, 2024, 2014, 2020),
      bar(9, 2020, 2022, 2008, 2010),   // close at 2010 (above both 2005 and 1995)
    ];
    const engine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 2.0 });
    const out = engine.analyze(ctx(candles));

    const ev = out.evidence.find((e) => e.kind === "equal-lows-below");
    expect(ev).toBeDefined();
    // Newest valid level (1995.05) must be selected, NOT older level (2005.05)
    expect(ev!.detail).toContain("1995.05");
  });

  it("E: A newer but invalid level does not override an older valid level", () => {
    // Older equal highs at 2020 (bars 1 & 3, t=3) -> VALID (> 2015)
    // Newer equal highs at 2010 (bars 5 & 7, t=7) -> INVALID (< 2015, crossed below)
    // Current price closes at 2015
    const candles: Candle[] = [
      bar(0, 2010, 2014, 2008, 2012),
      bar(1, 2012, 2020.0, 2010, 2015), // swing high 2020.0
      bar(2, 2015, 2017, 2006, 2013),   // valley (low 2006 < 2010 & 2012)
      bar(3, 2013, 2020.1, 2012, 2016), // swing high 2020.1 -> Older Cluster ~ 2020.05, touchedAt=3
      bar(4, 2016, 2018, 2002, 2008),   // valley (low 2002 < 2012 & 2004)
      bar(5, 2008, 2010.0, 2004, 2007), // swing high 2010.0
      bar(6, 2007, 2009, 2001, 2006),   // valley (low 2001 < 2004 & 2005)
      bar(7, 2006, 2010.1, 2005, 2008), // swing high 2010.1 -> Newer Cluster ~ 2010.05, touchedAt=7
      bar(8, 2008, 2012, 2007, 2010),
      bar(9, 2010, 2017, 2009, 2015),   // close at 2015
    ];
    const engine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 2.0 });
    const out = engine.analyze(ctx(candles));

    const ev = out.evidence.find((e) => e.kind === "equal-highs-overhead");
    expect(ev).toBeDefined();
    // The newer invalid level at 2010.05 must NOT override the older valid level at 2020.05
    expect(ev!.detail).toContain("2020.05");
  });

  it("F: ATR proximity/tolerance correctly filters distant levels", () => {
    // Equal highs at 2025.05. Current price = 2000. Distance = 25.05.
    const candles: Candle[] = [
      bar(0, 2000, 2005, 1995, 2002),
      bar(1, 2002, 2025.0, 2000, 2008), // swing high 2025.0
      bar(2, 2008, 2010, 1992, 2006),   // valley (low 1992 < 2000 & 2005)
      bar(3, 2006, 2025.1, 2005, 2010), // swing high 2025.1 -> Cluster ~ 2025.05
      bar(4, 2010, 2012, 2002, 2005),
      bar(5, 2005, 2008, 1998, 2000),   // close at 2000
    ];
    // With narrow ATR multiple 0.5 -> max distance is too small -> rejected
    const strictEngine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 0.5 });
    const strictOut = strictEngine.analyze(ctx(candles));
    expect(strictOut.evidence.some((e) => e.kind === "equal-highs-overhead")).toBe(false);

    // With wide ATR multiple 5.0 -> distance is within proximity -> accepted
    const lenientEngine = new LiquidityEngine({ swingLookbackBars: 1, equalLevelTolerance: 0.5, nearLevelAtrMultiple: 5.0 });
    const lenientOut = lenientEngine.analyze(ctx(candles));
    expect(lenientOut.evidence.some((e) => e.kind === "equal-highs-overhead")).toBe(true);
  });

  it("G: detectEqualLevelClusters accurately computes cluster prices, timestamps, and swings", () => {
    const swings = [
      { openTime: 100, price: 2010.0, kind: "swing-high" as const },
      { openTime: 200, price: 2010.2, kind: "swing-high" as const },
      { openTime: 300, price: 2030.0, kind: "swing-high" as const },
      { openTime: 400, price: 2030.1, kind: "swing-high" as const },
    ];
    const clusters = detectEqualLevelClusters(swings, 0.3);
    expect(clusters).toHaveLength(2);

    expect(clusters[0]!.price).toBeCloseTo(2010.1, 2);
    expect(clusters[0]!.timestamp).toBe(200);

    expect(clusters[1]!.price).toBeCloseTo(2030.05, 2);
    expect(clusters[1]!.timestamp).toBe(400);

    // Legacy equalLevels still returns prices array
    const prices = equalLevels(swings, 0.3);
    expect(prices).toHaveLength(2);
    expect(prices[0]).toBeCloseTo(2010.1, 2);
    expect(prices[1]).toBeCloseTo(2030.05, 2);
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
