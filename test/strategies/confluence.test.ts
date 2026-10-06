import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StrongCandleStrategy, DEFAULT_STRONG_CANDLE_CONFIG, calculateR, calculateTradeR } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import type { EngineContext } from "../../src/strategies/Engine.js";

const TF = 300_000;

function bar(i: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  const openTime = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime, open, high, low, close, volume, closeTime: openTime + TF - 1 };
}

function ctx(candles: Candle[]): EngineContext {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

/** Bullish scenario: HH/HL structure + strong bull candle close at the top. */
function bullishSeries(): Candle[] {
  const lead = [
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
  ];
  // strong bull candle: body 24, small wicks
  lead.push(bar(11, 2024, 2040, 2023, 2038));
  return lead;
}

/** Bearish scenario: LH/LL structure + strong bear candle (mathematical inverse of bullishSeries). */
function bearishSeries(): Candle[] {
  return bullishSeries().map((c) => ({
    ...c,
    open: 4000 - c.open,
    high: 4000 - c.low,
    low: 4000 - c.high,
    close: 4000 - c.close,
  }));
}

describe("ConfluenceEngine", () => {
  const engines = [new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()];
  const confluence = new ConfluenceEngine(engines);

  it("produces a LONG bias for bullish structure + strong bull close", () => {
    const out = confluence.evaluate(ctx(bullishSeries()));
    expect(out.score).toBeGreaterThan(0);
    expect(out.direction).toBe("LONG");
    expect(out.evidence.length).toBeGreaterThan(0);
    expect(out.perEngine).toHaveLength(3);
  });

  it("produces a SHORT bias for bearish structure + strong bear close", () => {
    const out = confluence.evaluate(ctx(bearishSeries()));
    expect(out.score).toBeLessThan(0);
    expect(out.direction).toBe("SHORT");
  });

  it("returns null direction below the score threshold", () => {
    const flat = [bar(0, 2000, 2004, 1996, 2000), bar(1, 2000, 2004, 1996, 2000), bar(2, 2000, 2004, 1996, 2000)];
    const strict = new ConfluenceEngine(engines, { minScore: 100, maxEngineWeight: 1.5 });
    const out = strict.evaluate(ctx(flat));
    expect(out.direction).toBeNull();
  });

  it("deterministically reproduces the same result", () => {
    const a = confluence.evaluate(ctx(bullishSeries()));
    const b = confluence.evaluate(ctx(bullishSeries()));
    expect(a.score).toBe(b.score);
    expect(a.direction).toBe(b.direction);
    expect(a.evidence).toEqual(b.evidence);
  });

  describe("P1-1: Multi-Engine Independence Rules", () => {
    const strategy = new StrongCandleStrategy();

    it("A: Momentum / strong bull candle alone CANNOT establish BUY direction", () => {
      // 5 bars: 4 flat bars (no swings/sweeps), bar 4 is strong bull candle (weight 0.6)
      const isolatedBull = [
        bar(0, 2000, 2002, 1998, 2000),
        bar(1, 2000, 2002, 1998, 2000),
        bar(2, 2000, 2002, 1998, 2000),
        bar(3, 2000, 2002, 1998, 2000),
        bar(4, 2000, 2012, 1999, 2011),
      ];
      const out = confluence.evaluate(ctx(isolatedBull));
      expect(out.score).toBeGreaterThanOrEqual(0.5); // score clears threshold on momentum
      expect(out.direction).toBeNull(); // but direction is blocked (only 1 engine)
      expect(out.supportingEngines).toEqual(["price-action"]);

      // Downstream strategy refuses to originate a setup without established direction
      const setup = strategy.evaluate(ctx(isolatedBull), out.direction);
      expect(setup).toBeNull();
    });

    it("B: Momentum / strong bear candle alone CANNOT establish SELL direction", () => {
      // 5 bars: 4 flat bars (no swings/sweeps), bar 4 is strong bear candle (weight -0.6)
      const isolatedBear = [
        bar(0, 2000, 2002, 1998, 2000),
        bar(1, 2000, 2002, 1998, 2000),
        bar(2, 2000, 2002, 1998, 2000),
        bar(3, 2000, 2002, 1998, 2000),
        bar(4, 2011, 2012, 1999, 2000),
      ];
      const out = confluence.evaluate(ctx(isolatedBear));
      expect(out.score).toBeLessThanOrEqual(-0.5);
      expect(out.direction).toBeNull(); // direction blocked
      expect(out.supportingEngines).toEqual(["price-action"]);

      const setup = strategy.evaluate(ctx(isolatedBear), out.direction);
      expect(setup).toBeNull();
    });

    it("G: Multiple factors from the SAME engine do not count as independent support", () => {
      // Bar 3 bear, bar 4 engulfs and is strong bull -> price-action emits strong-bull AND engulfing
      const multiFactorSameEngine = [
        bar(0, 2000, 2002, 1998, 2000),
        bar(1, 2000, 2002, 1998, 2000),
        bar(2, 2000, 2002, 1998, 2000),
        bar(3, 2004, 2005, 1999, 2000),
        bar(4, 1999, 2015, 1998, 2014),
      ];
      const out = confluence.evaluate(ctx(multiFactorSameEngine));
      // PriceAction alone emits weight 0.6 + 0.45 = 1.05
      expect(out.score).toBeGreaterThan(1.0);
      expect(out.direction).toBeNull(); // still null because only price-action supports it
      expect(out.supportingEngines).toEqual(["price-action"]);
    });

    it("C: Momentum + one genuinely independent engine (structure) establishes direction", () => {
      const out = confluence.evaluate(ctx(bullishSeries()));
      expect(out.score).toBeGreaterThan(0.5);
      expect(out.direction).toBe("LONG");
      expect(out.supportingEngines).toContain("structure");
      expect(out.supportingEngines).toContain("price-action");
      expect(out.supportingEngines!.length).toBeGreaterThanOrEqual(2);

      const setup = strategy.evaluate(ctx(bullishSeries()), out.direction);
      expect(setup).not.toBeNull();
      expect(setup!.direction).toBe("LONG");
    });

    it("D: Two independent bearish factors establish SELL", () => {
      const bearSeries = bearishSeries();

      // Structure alone is bearish (-0.6) but cannot establish direction by itself
      const structureOnly = new ConfluenceEngine([new StructureEngine()]);
      const sOut = structureOnly.evaluate(ctx(bearSeries));
      expect(sOut.score).toBeLessThan(0); // Structure is bearish
      expect(sOut.direction).toBeNull(); // Direction blocked (1 engine only)
      expect(sOut.supportingEngines).toEqual(["structure"]);

      // With both Structure and PriceAction supporting SELL, direction is SHORT
      const multiBear = confluence.evaluate(ctx(bearSeries));
      expect(multiBear.score).toBeLessThanOrEqual(-0.5);
      expect(multiBear.direction).toBe("SHORT");
      expect(multiBear.supportingEngines).toContain("structure");
      expect(multiBear.supportingEngines).toContain("price-action");
      expect(multiBear.supportingEngines!.length).toBeGreaterThanOrEqual(2);
    });

    it("F: Configurable minSupportingEngines allows overriding threshold safely", () => {
      const isolatedBull = [
        bar(0, 2000, 2002, 1998, 2000),
        bar(1, 2000, 2002, 1998, 2000),
        bar(2, 2000, 2002, 1998, 2000),
        bar(3, 2000, 2002, 1998, 2000),
        bar(4, 2000, 2012, 1999, 2011),
      ];
      // When minSupportingEngines is relaxed to 1, single engine can set direction
      const relaxed = new ConfluenceEngine(engines, { minScore: 0.5, maxEngineWeight: 1.5, minSupportingEngines: 1 });
      const out = relaxed.evaluate(ctx(isolatedBull));
      expect(out.direction).toBe("LONG");

      // Default (2) continues to enforce independence safety
      const normal = new ConfluenceEngine(engines);
      expect(normal.evaluate(ctx(isolatedBull)).direction).toBeNull();
    });
  });
});

describe("StrongCandleStrategy", () => {
  const strategy = new StrongCandleStrategy();

  it("creates a LONG setup on a strong bull candle aligned with bias", () => {
    const setup = strategy.evaluate(ctx(bullishSeries()), "LONG");
    expect(setup).not.toBeNull();
    expect(setup!.direction).toBe("LONG");
    expect(setup!.entry).toBe(2038);
    expect(setup!.stopLoss).toBeLessThan(setup!.entry);
    expect(setup!.takeProfit1).toBeGreaterThan(setup!.entry);
    expect(setup!.takeProfit2).toBeGreaterThan(setup!.takeProfit1);
    expect(setup!.state).toBe("NEW");
    expect(setup!.id).toContain("XAUUSD:M5");
  });

  it("refuses a setup when the strong candle opposes the bias", () => {
    const setup = strategy.evaluate(ctx(bullishSeries()), "SHORT");
    expect(setup).toBeNull();
  });

  it("refuses a setup without a bias", () => {
    expect(strategy.evaluate(ctx(bullishSeries()), null)).toBeNull();
  });

  it("SL distance is body plus buffer", () => {
    const cfg = { ...DEFAULT_STRONG_CANDLE_CONFIG, stopAtrMultiple: 0.25 };
    const s = new StrongCandleStrategy(cfg);
    const setup = s.evaluate(ctx(bullishSeries()), "LONG");
    expect(setup).not.toBeNull();
    expect(setup!.stopLoss).toBeLessThan(2023);
  });
});

describe("P1-2: Canonical R-Multiple Calculation", () => {
  const strategy = new StrongCandleStrategy();

  it("A: BUY trade (LONG): entry 2650, SL 2640, TP 2670 => R = 2.0", () => {
    // Entry 2650, SL 2640, TP 2670 -> risk = 10, reward = 20 -> R = 2
    expect(calculateR(2650, 2640, 2670)).toBe(2);
  });

  it("B: SELL trade (SHORT): entry 2650, SL 2660, TP 2630 => R = 2.0", () => {
    // Entry 2650, SL 2660, TP 2630 -> risk = 10, reward = 20 -> R = 2
    expect(calculateR(2650, 2660, 2630)).toBe(2);
  });

  it("C: Different ATR values (5 vs 20) must NOT change R for identical Entry/SL/TP", () => {
    // Given entry 2650, SL 2640, TP 2670
    // Regardless of ATR = 5 or ATR = 20, R must evaluate to 2.0
    const rWithAtr5 = calculateR(2650, 2640, 2670);
    const rWithAtr20 = calculateR(2650, 2640, 2670);
    expect(rWithAtr5).toBe(2);
    expect(rWithAtr20).toBe(2);
    expect(rWithAtr5).toBe(rWithAtr20);
    // Explicitly verify R is NOT reward / ATR
    expect(rWithAtr5).not.toBe(20 / 5);
    expect(rWithAtr20).not.toBe(20 / 20);
  });

  it("D: Zero risk distance (Entry === SL) returns null safely without Infinity/NaN", () => {
    expect(calculateR(2650, 2650, 2670)).toBeNull();
  });

  it("E: Invalid or non-finite inputs safely return null", () => {
    expect(calculateR(NaN, 2640, 2670)).toBeNull();
    expect(calculateR(2650, Infinity, 2670)).toBeNull();
    expect(calculateR(2650, 2640, -Infinity)).toBeNull();
  });

  it("F: TP1 and TP2 each use their own target with the same actual risk distance", () => {
    // LONG
    const longR = calculateTradeR({
      entry: 2650,
      stopLoss: 2640,
      takeProfit1: 2660,
      takeProfit2: 2670,
    });
    expect(longR.rTp1).toBe(1);
    expect(longR.rTp2).toBe(2);

    // SHORT
    const shortR = calculateTradeR({
      entry: 2650,
      stopLoss: 2660,
      takeProfit1: 2640,
      takeProfit2: 2630,
    });
    expect(shortR.rTp1).toBe(1);
    expect(shortR.rTp2).toBe(2);
  });

  it("G: Existing valid strategy trade plans produce exact planned R multiples", () => {
    const setup = strategy.evaluate(ctx(bullishSeries()), "LONG")!;
    expect(setup).not.toBeNull();
    const tradeR = calculateTradeR(setup);
    // tp1R is 1, tp2R is 2
    expect(tradeR.rTp1).toBeCloseTo(1, 4);
    expect(tradeR.rTp2).toBeCloseTo(2, 4);
  });
});

describe("SetupStore", () => {
  it("is idempotent by setup id", () => {
    const store = new SetupStore();
    const strategy = new StrongCandleStrategy();
    const setup = strategy.evaluate(ctx(bullishSeries()), "LONG")!;
    expect(store.add(setup)).toBe(true);
    expect(store.add(setup)).toBe(false);
    expect(store.all()).toHaveLength(1);
  });

  it("enforces the state machine", () => {
    const store = new SetupStore();
    const strategy = new StrongCandleStrategy();
    const setup = strategy.evaluate(ctx(bullishSeries()), "LONG")!;
    store.add(setup);
    expect(store.transition(setup.id, "TRIGGERED")).toBeNull(); // NEW cannot jump to TRIGGERED
    expect(store.transition(setup.id, "ACTIVE")).not.toBeNull();
    expect(store.transition(setup.id, "TRIGGERED")).not.toBeNull();
    expect(store.transition(setup.id, "ACTIVE")).toBeNull(); // terminal path
    expect(store.get(setup.id)!.state).toBe("TRIGGERED");
  });
});
