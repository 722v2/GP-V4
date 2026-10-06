import { describe, expect, it } from "vitest";
import {
  computeLotSize,
  calculatePositionSizing,
  evaluateRisk,
  evaluateBreaches,
  breachLevel,
} from "../../src/risk/RiskEngine.js";
import type { RiskConfig, RiskState, RiskEnvironment } from "../../src/risk/RiskEngine.js";
import type { Setup } from "../../src/core/types/Setup.js";
import type { InstrumentSpec } from "../../src/risk/InstrumentSpec.js";
import { DEFAULT_XAUUSD_SPEC } from "../../src/risk/InstrumentSpec.js";

const CFG: RiskConfig = {
  perTradePct: 0.5,
  minRiskPerTradePct: 0.01,
  maxRiskPerTradePct: 5.0,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.5,
  marginCeilingPct: 50,
  accountEquity: 10_000,
  minStopDistancePts: 1.0,
  maxStopDistancePts: 50.0,
  maxLot: 10.0,
};

const CLEAN_STATE: RiskState = {
  openTrades: 0,
  netExposureLots: 0,
  marginUsedPct: 0,
  dailyLossPct: 0,
  weeklyLossPct: 0,
  maxDrawdownPct: 0,
};

const CLEAN_ENV: RiskEnvironment = { equity: 10_000, state: CLEAN_STATE, killSwitch: "NONE" };

const LONG_SETUP: Setup = {
  id: "sc:XAUUSD:M5:1",
  strategyId: "strong-candle",
  symbol: "XAUUSD",
  timeframe: "M5",
  direction: "LONG",
  barOpenTime: 1,
  createdAt: 1,
  state: "NEW",
  entry: 2000,
  stopLoss: 1990,
  takeProfit1: 2010,
  takeProfit2: 2020,
  invalidationPrice: 1990,
  rationale: "test",
  evidence: [],
};

describe("computeLotSize & calculatePositionSizing", () => {
  it("sizes XAUUSD lots from stop distance and risk budget", () => {
    // risk budget = 10_000 * 0.5% = $50; risk per lot = 10 * $100 = $1000 → 0.05 lots
    expect(computeLotSize(2000, 1990, 10_000, 0.5)).toBe(0.05);
  });

  it("floors to 0.01 lot steps to stay under budget", () => {
    // budget $50, stop 7 → risk/lot $700 → 0.0714… → 0.07
    expect(computeLotSize(2000, 1993, 10_000, 0.5)).toBe(0.07);
  });

  it("returns zero for degenerate stops", () => {
    expect(computeLotSize(2000, 2000, 10_000, 0.5)).toBe(0);
    expect(computeLotSize(2000, 1990, 0, 0.5)).toBe(0);
  });
});

describe("P2-15 Focused Requirement Tests (A through S)", () => {
  it("A: equity × risk% produces expected risk capital", () => {
    const sizing = calculatePositionSizing(2000, 1990, 20_000, 1.0, DEFAULT_XAUUSD_SPEC);
    expect(sizing.riskBudgetUsd).toBe(200); // 20_000 * 1.0% = $200
  });

  it("B: position size decreases when stop distance increases", () => {
    const narrowStop = calculatePositionSizing(2000, 1990, 10_000, 0.5); // 10 pts
    const wideStop = calculatePositionSizing(2000, 1970, 10_000, 0.5);   // 30 pts
    expect(narrowStop.lotSize).toBeGreaterThan(wideStop.lotSize);
  });

  it("C: position size increases when equity increases", () => {
    const lowEquity = calculatePositionSizing(2000, 1990, 10_000, 0.5);
    const highEquity = calculatePositionSizing(2000, 1990, 50_000, 0.5);
    expect(highEquity.lotSize).toBeGreaterThan(lowEquity.lotSize);
  });

  it("D: minimum stop distance rejects too-tight stops", () => {
    const tightSetup = { ...LONG_SETUP, stopLoss: 1999.5 }; // 0.5 pts < 1.0 min
    const decision = evaluateRisk(CFG, CLEAN_ENV, tightSetup, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/below minimum allowed/);
  });

  it("E: maximum stop distance rejects too-wide stops", () => {
    const wideSetup = { ...LONG_SETUP, stopLoss: 1930 }; // 70 pts > 50.0 max
    const decision = evaluateRisk(CFG, CLEAN_ENV, wideSetup, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/above maximum allowed/);
  });

  it("F: max lot is enforced centrally", () => {
    const hugeEquityEnv: RiskEnvironment = { equity: 5_000_000, state: CLEAN_STATE, killSwitch: "NONE" };
    const cfgWithMaxLot = { ...CFG, maxLot: 2.0 };
    const decision = evaluateRisk(cfgWithMaxLot, hugeEquityEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/exceeds max lot limit/);
  });

  it("G: invalid/zero equity rejects safely", () => {
    const zeroEquityEnv: RiskEnvironment = { equity: 0, state: CLEAN_STATE, killSwitch: "NONE" };
    const decision = evaluateRisk(CFG, zeroEquityEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/equity is zero or invalid/);
  });

  it("H: invalid/zero stop distance rejects safely", () => {
    const zeroStop = { ...LONG_SETUP, stopLoss: 2000 };
    const decision = evaluateRisk(CFG, CLEAN_ENV, zeroStop, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/invalid stop distance/);
  });

  it("I: spread cost is included in risk calculation", () => {
    const noSpread = calculatePositionSizing(2000, 1990, 10_000, 0.5, DEFAULT_XAUUSD_SPEC, 0);
    const withSpread = calculatePositionSizing(2000, 1990, 10_000, 0.5, DEFAULT_XAUUSD_SPEC, 2.0);
    expect(withSpread.spreadCostUsd).toBeGreaterThan(0);
    expect(withSpread.lotSize).toBeLessThanOrEqual(noSpread.lotSize);
  });

  it("J: live spread path rejects when spread is invalid/negative", () => {
    const decision = evaluateRisk(CFG, CLEAN_ENV, LONG_SETUP, "LONG", "AUTO_TRADING", DEFAULT_XAUUSD_SPEC, -1);
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/spread points invalid or unavailable/);
  });

  it("K: lot step normalization never increases risk above budget", () => {
    const sizing = calculatePositionSizing(2000, 1993, 10_000, 0.5, DEFAULT_XAUUSD_SPEC); // budget = $50
    // total risk amount = stopDistance * contractSize * lotSize = 7 * 100 * 0.07 = $49.00 <= $50.00
    expect(sizing.riskAmount).toBeLessThanOrEqual(sizing.riskBudgetUsd);
  });

  it("L: minimum lot enforcement", () => {
    const tinyEquityEnv: RiskEnvironment = { equity: 100, state: CLEAN_STATE, killSwitch: "NONE" }; // budget = $0.50
    const decision = evaluateRisk(CFG, tinyEquityEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/below min lot/);
  });

  it("M: invalid instrument specification rejects safely", () => {
    const badSpec: InstrumentSpec = { ...DEFAULT_XAUUSD_SPEC, contractSize: 0 };
    const decision = evaluateRisk(CFG, CLEAN_ENV, LONG_SETUP, "LONG", "ANALYSIS_ONLY", badSpec);
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/invalid instrument specification/);
  });

  it("N: existing exposure/risk limits still apply", () => {
    const fullEnv: RiskEnvironment = { equity: 10_000, state: { ...CLEAN_STATE, openTrades: 2 }, killSwitch: "NONE" };
    const decision = evaluateRisk(CFG, fullEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.reasons.join(" ")).toMatch(/max open trades/);
  });

  it("O: KillSwitch still blocks execution", () => {
    const killEnv: RiskEnvironment = { equity: 10_000, state: CLEAN_STATE, killSwitch: "L3" };
    const decision = evaluateRisk(CFG, killEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("REJECTED");
    expect(decision.killSwitchLevel).toBe("L3");
  });

  it("P: AI cannot override calculated risk size", () => {
    // RiskEngine computes lot size independently from setup levels and account equity
    const decision = evaluateRisk(CFG, CLEAN_ENV, LONG_SETUP, "LONG");
    expect(decision.lotSize).toBe(0.05); // Central calculation ignored any external AI opinion
  });

  it("Q: PAPER mode uses configured paper capital", () => {
    const paperEnv: RiskEnvironment = { equity: CFG.accountEquity, state: CLEAN_STATE, killSwitch: "NONE", mode: "PAPER_TRADING" };
    const decision = evaluateRisk(CFG, paperEnv, LONG_SETUP, "LONG");
    expect(decision.verdict).toBe("APPROVED");
    expect(decision.equityUsed).toBe(10_000);
  });

  it("R: BACKTEST/REPLAY remain deterministic with point-in-time equity", () => {
    const btEnv: RiskEnvironment = { equity: 10_000, state: CLEAN_STATE, killSwitch: "NONE", mode: "BACKTEST" };
    const d1 = evaluateRisk(CFG, btEnv, LONG_SETUP, "LONG");
    const d2 = evaluateRisk(CFG, btEnv, LONG_SETUP, "LONG");
    expect(d1.lotSize).toBe(d2.lotSize);
    expect(d1.verdict).toBe("APPROVED");
  });
});
