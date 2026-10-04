import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StrongCandleStrategy, DEFAULT_STRONG_CANDLE_CONFIG } from "../../src/strategies/StrongCandleStrategy.js";
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

/** Bearish scenario: LH/LL structure + strong bear candle. */
function bearishSeries(): Candle[] {
  const lead = [
    bar(0, 2100, 2110, 2098, 2102),
    bar(1, 2102, 2092, 2094, 2096),
    bar(2, 2096, 2090, 2078, 2082), // swing low 2078
    bar(3, 2082, 2096, 2080, 2094),
    bar(4, 2094, 2106, 2092, 2102),
    bar(5, 2102, 2096, 2088, 2090),
    bar(6, 2090, 2080, 2072, 2076), // lower swing low
    bar(7, 2076, 2086, 2074, 2084),
    bar(8, 2084, 2092, 2082, 2090),
    bar(9, 2090, 2086, 2068, 2072), // lower swing low 2068
    bar(10, 2072, 2078, 2070, 2074),
  ];
  lead.push(bar(11, 2074, 2076, 2052, 2056)); // strong bear candle
  return lead;
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
