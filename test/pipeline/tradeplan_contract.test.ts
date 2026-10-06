import { describe, expect, it } from "vitest";
import { calculateR, calculateTradeR } from "../../src/core/types/Trade.js";
import { buildSignal, buildTradePlan, generateSignalId } from "../../src/pipeline/Signal.js";
import { calculatePositionSizing } from "../../src/risk/RiskEngine.js";
import { DEFAULT_XAUUSD_SPEC } from "../../src/risk/InstrumentSpec.js";
import type { Setup } from "../../src/core/types/Setup.js";
import type { RiskDecision } from "../../src/core/types/Risk.js";

describe("Part K & L — TradePlan Contract & Sizing Suite", () => {
  it("1. Canonical R-multiple calculation: R = |TP - Entry| / |Entry - SL|", () => {
    // LONG: Entry 2000, SL 1990 (Risk 10), TP1 2015 (Reward 15), TP2 2030 (Reward 30)
    const longR = calculateTradeR({ entry: 2000, stopLoss: 1990, takeProfit1: 2015, takeProfit2: 2030 });
    expect(longR.rTp1).toBe(1.5);
    expect(longR.rTp2).toBe(3.0);

    // SHORT: Entry 2000, SL 2010 (Risk 10), TP1 1980 (Reward 20)
    const shortR = calculateTradeR({ entry: 2000, stopLoss: 2010, takeProfit1: 1980 });
    expect(shortR.rTp1).toBe(2.0);
    expect(shortR.rTp2).toBeNull();
  });

  it("2. Returns null R if stop distance is 0 or non-finite", () => {
    expect(calculateR(2000, 2000, 2010)).toBeNull();
    expect(calculateR(2000, NaN, 2010)).toBeNull();
    expect(calculateR(Infinity, 2000, 2010)).toBeNull();
  });

  it("3. Deterministic Signal ID generation is stable across identical inputs", () => {
    const id1 = generateSignalId({ symbol: "XAUUSD", timeframe: "M5", barOpenTime: 1000000, direction: "LONG", strategyId: "strong-candle" });
    const id2 = generateSignalId({ symbol: "XAUUSD", timeframe: "M5", barOpenTime: 1000000, direction: "LONG", strategyId: "strong-candle" });
    expect(id1).toBe("sig:XAUUSD:M5:1000000:LONG:strong-candle");
    expect(id1).toBe(id2);
  });

  it("4. TradePlan contract includes canonical R multiples, risk percent, lotSize, and idempotencyKey", () => {
    const setup: Setup = {
      id: "sc:XAUUSD:M5:1000000",
      strategyId: "strong-candle",
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      barOpenTime: 1000000,
      createdAt: 1000000,
      state: "ACTIVE",
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      invalidationPrice: 1990,
      rationale: "Strong bull candle",
      evidence: [],
    };

    const risk: RiskDecision = {
      verdict: "APPROVED",
      direction: "LONG",
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      riskAmount: 100,
      reasons: [],
      killSwitchLevel: "NONE",
      equityUsed: 10000,
      riskPercent: 1.0,
      riskBudgetUsd: 100,
      stopDistance: 10,
      spreadCostUsd: 3.5,
      rawLotSize: 0.1,
      maxLot: 10.0,
    };

    const signal = buildSignal(setup, risk, "SIMULATED", 1000000);
    const plan = buildTradePlan(signal, 1000000, {
      strategyId: setup.strategyId,
      riskPercent: risk.riskPercent,
      spreadAssumptions: risk.spreadCostUsd,
      aiDecision: "TRADE_CANDIDATE",
      confidence: 0.8,
      riskVerdict: risk.verdict,
    });

    expect(plan.id).toBe(`tp:${signal.id}`);
    expect(plan.rTp1).toBe(1.0);
    expect(plan.rTp2).toBe(2.0);
    expect(plan.lotSize).toBe(0.1);
    expect(plan.riskPercent).toBe(1.0);
    expect(plan.idempotencyKey).toBe(`idem:${signal.id}`);
  });

  it("5. Position sizing incorporates stop distance, spread points, and lot step conservative rounding", () => {
    // Equity $10,000, 1% risk ($100 budget), Entry 2000, SL 1990 (10 pts), Spread 0.35 pts, ContractSize 100
    // Total risk price distance = 10.35 pts. Risk per lot = 10.35 * 100 = $1035.
    // Raw lots = 100 / 1035 = 0.0966... Lots rounded to 0.01 = 0.09.
    const sizing = calculatePositionSizing(2000, 1990, 10000, 1.0, DEFAULT_XAUUSD_SPEC, 0.35, 10.0);
    expect(sizing.error).toBeUndefined();
    expect(sizing.lotSize).toBe(0.09);
    expect(sizing.riskAmount).toBeCloseTo(10.35 * 100 * 0.09, 2);
    expect(sizing.riskAmount).toBeLessThanOrEqual(100); // Never exceeds budget
  });
});
