import { describe, expect, it } from "vitest";
import { ExperienceMemory, type TradeExperienceRecord } from "../../src/core/memory/ExperienceMemory.js";

describe("Part H — Experience Memory Layer Suite", () => {
  function makeRecord(id: string, closedAt: number, outcome: "WIN" | "LOSS", r: number, factors: string[]): TradeExperienceRecord {
    return {
      id,
      setupId: `setup-${id}`,
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      openedAt: closedAt - 300_000,
      closedAt,
      factors,
      confluenceScore: 1.0,
      outcome,
      realizedR: r,
      realizedPnl: r * 100,
    };
  }

  it("1. Sample size < 5 returns INSUFFICIENT_DATA with 0 advisory score modifier (no overfitting)", () => {
    const memory = new ExperienceMemory();
    // Add 3 winning trades
    memory.record(makeRecord("t1", 1000, "WIN", 1.5, ["bullish-bos", "strong-bull-candle"]));
    memory.record(makeRecord("t2", 2000, "WIN", 2.0, ["bullish-bos", "strong-bull-candle"]));
    memory.record(makeRecord("t3", 3000, "WIN", 1.0, ["bullish-bos", "strong-bull-candle"]));

    const insight = memory.query({
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      factors: ["bullish-bos", "strong-bull-candle"],
      asOfTimestamp: 4000,
    });

    expect(insight.sampleSize).toBe(3);
    expect(insight.recommendation).toBe("INSUFFICIENT_DATA");
    expect(insight.advisoryScoreModifier).toBe(0);
    expect(insight.confidenceModifier).toBe(0);
  });

  it("2. Sample size >= 5 computes bounded advisory modifiers (+/- 0.15 max)", () => {
    const memory = new ExperienceMemory();
    // Add 6 trades: 5 wins, 1 loss
    for (let i = 1; i <= 5; i++) {
      memory.record(makeRecord(`win-${i}`, i * 1000, "WIN", 1.5, ["bullish-bos", "equal-highs-overhead"]));
    }
    memory.record(makeRecord("loss-1", 6000, "LOSS", -1.0, ["bullish-bos", "equal-highs-overhead"]));

    const insight = memory.query({
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      factors: ["bullish-bos", "equal-highs-overhead"],
      asOfTimestamp: 7000,
    });

    expect(insight.sampleSize).toBe(6);
    expect(insight.winRate).toBeGreaterThan(0.7);
    expect(insight.recommendation).toBe("FAVORABLE");
    expect(insight.advisoryScoreModifier).toBeGreaterThan(0);
    expect(insight.advisoryScoreModifier).toBeLessThanOrEqual(0.15); // bounded
  });

  it("3. Enforces temporal isolation (point-in-time lookup prevents future outcome leakage)", () => {
    const memory = new ExperienceMemory();
    // Historical trades closed at t=1000..5000
    for (let i = 1; i <= 5; i++) {
      memory.record(makeRecord(`t-${i}`, i * 1000, "WIN", 1.5, ["bullish-bos", "strong-bull-candle"]));
    }
    // Future trade closed at t=10000
    memory.record(makeRecord("future-trade", 10000, "LOSS", -1.0, ["bullish-bos", "strong-bull-candle"]));

    // Query as of t=5000
    const insightPast = memory.query({
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      factors: ["bullish-bos", "strong-bull-candle"],
      asOfTimestamp: 5000,
    });

    // The future trade at t=10000 MUST NOT be visible at t=5000
    expect(insightPast.sampleSize).toBe(5);
    expect(insightPast.winRate).toBe(1.0);

    // Query as of t=10000
    const insightFuture = memory.query({
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      factors: ["bullish-bos", "strong-bull-candle"],
      asOfTimestamp: 10000,
    });
    expect(insightFuture.sampleSize).toBe(6);
  });
});
