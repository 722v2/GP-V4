import { describe, expect, it } from "vitest";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import { evaluateRisk, type RiskConfig } from "../../src/risk/RiskEngine.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import type { Setup } from "../../src/core/types/Setup.js";

const CFG: RiskConfig = {
  perTradePct: 0.5,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.5,
  marginCeilingPct: 50,
  accountEquity: 10_000,
};

const LONG_SETUP: Setup = {
  id: "sc:XAUUSD:M5:1",
  strategyId: "strong-candle",
  symbol: "XAUUSD",
  timeframe: "M5",
  direction: "LONG",
  barOpenTime: 1000,
  createdAt: 1000,
  state: "NEW",
  entry: 2000,
  stopLoss: 1990,
  takeProfit1: 2010,
  takeProfit2: 2020,
  invalidationPrice: 1990,
  rationale: "test",
  evidence: [],
};

describe("RiskStateTracker", () => {
  it("initializes with zero open trades and clean loss/drawdown state", () => {
    const tracker = new RiskStateTracker(10_000);
    expect(tracker.currentEquity).toBe(10_000);
    expect(tracker.openPositionsCount).toBe(0);
    expect(tracker.state).toEqual({
      openTrades: 0,
      netExposureLots: 0,
      marginUsedPct: 0,
      dailyLossPct: 0,
      weeklyLossPct: 0,
      maxDrawdownPct: 0,
    });
  });

  it("updates openTrades and netExposureLots when positions open and close", () => {
    const tracker = new RiskStateTracker(10_000);

    // Open first trade (0.05 lots LONG)
    tracker.recordTradeOpened({
      id: "t1",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2000,
      lotSize: 0.05,
      openedAt: 1000,
    });

    expect(tracker.openPositionsCount).toBe(1);
    expect(tracker.state.openTrades).toBe(1);
    expect(tracker.state.netExposureLots).toBe(0.05);
    // Margin at 100 leverage: 2000 * 0.05 = $100. $100 / $10,000 = 1.0%
    expect(tracker.state.marginUsedPct).toBe(1.0);

    // Open second trade (0.07 lots LONG)
    tracker.recordTradeOpened({
      id: "t2",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2010,
      lotSize: 0.07,
      openedAt: 2000,
    });

    expect(tracker.openPositionsCount).toBe(2);
    expect(tracker.state.openTrades).toBe(2);
    expect(tracker.state.netExposureLots).toBe(0.12);

    // Close first trade
    tracker.recordTradeClosed("t1", 50, 3000);

    expect(tracker.openPositionsCount).toBe(1);
    expect(tracker.state.openTrades).toBe(1);
    expect(tracker.state.netExposureLots).toBe(0.07);

    // Close second trade
    tracker.recordTradeClosed("t2", -30, 4000);

    expect(tracker.openPositionsCount).toBe(0);
    expect(tracker.state.openTrades).toBe(0);
    expect(tracker.state.netExposureLots).toBe(0);
    expect(tracker.state.marginUsedPct).toBe(0);
  });

  it("calculates net exposure when long and short positions coexist", () => {
    const tracker = new RiskStateTracker(10_000);

    tracker.recordTradeOpened({
      id: "t1",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2000,
      lotSize: 0.10,
      openedAt: 1000,
    });
    tracker.recordTradeOpened({
      id: "t2",
      symbol: "XAUUSD",
      direction: "SHORT",
      entry: 2005,
      lotSize: 0.04,
      openedAt: 1100,
    });

    // Net exposure: |0.10 - 0.04| = 0.06 lots
    expect(tracker.state.netExposureLots).toBe(0.06);
  });

  it("updates daily and weekly loss pct when realized losses occur", () => {
    let mockTime = Date.UTC(2026, 9, 5, 10, 0, 0); // Monday Oct 5, 2026
    const tracker = new RiskStateTracker(10_000, { now: () => mockTime });

    // Profitable trade does not increase dailyLossPct
    tracker.recordRealizedPnl(100, mockTime);
    expect(tracker.state.dailyLossPct).toBe(0);
    expect(tracker.state.weeklyLossPct).toBe(0);
    expect(tracker.currentEquity).toBe(10_100);

    // Realized loss of $350 on $10,000 initial equity
    mockTime += 1000;
    tracker.recordRealizedPnl(-350, mockTime);

    // Net daily PnL = +100 - 350 = -250. 250 / 10,000 = 2.5%
    expect(tracker.state.dailyLossPct).toBe(2.5);
    expect(tracker.state.weeklyLossPct).toBe(2.5);
    expect(tracker.currentEquity).toBe(9_750);

    // Additional loss of $100 -> Net daily loss $350 -> 3.5%
    mockTime += 1000;
    tracker.recordRealizedPnl(-100, mockTime);
    expect(tracker.state.dailyLossPct).toBe(3.5);
    expect(tracker.state.weeklyLossPct).toBe(3.5);
  });

  it("resets daily loss on UTC day boundary but retains weekly loss", () => {
    let mockTime = Date.UTC(2026, 9, 5, 23, 0, 0); // Monday Oct 5, 2026
    const tracker = new RiskStateTracker(10_000, { now: () => mockTime });

    tracker.recordRealizedPnl(-200, mockTime);
    expect(tracker.state.dailyLossPct).toBe(2.0);
    expect(tracker.state.weeklyLossPct).toBe(2.0);

    // Advance to next day: Tuesday Oct 6, 2026
    mockTime = Date.UTC(2026, 9, 6, 1, 0, 0);
    expect(tracker.state.dailyLossPct).toBe(0); // Reset for new day
    expect(tracker.state.weeklyLossPct).toBe(2.0); // Preserved within same week
  });

  it("calculates peak-to-trough maxDrawdownPct correctly", () => {
    const tracker = new RiskStateTracker(10_000);

    // Loss of $500 -> Equity 9,500. Drawdown = 5.0%
    tracker.recordRealizedPnl(-500);
    expect(tracker.currentEquity).toBe(9_500);
    expect(tracker.state.maxDrawdownPct).toBe(5.0);

    // Profit of $200 -> Equity 9,700. Current DD = 3.0%, max DD remains 5.0%
    tracker.recordRealizedPnl(200);
    expect(tracker.currentEquity).toBe(9_700);
    expect(tracker.state.maxDrawdownPct).toBe(5.0);

    // Profit of $800 -> Equity 10,500. New peak! Current DD = 0, max DD still 5.0%
    tracker.recordRealizedPnl(800);
    expect(tracker.currentEquity).toBe(10_500);
    expect(tracker.peakEquity).toBe(10_500);
    expect(tracker.state.maxDrawdownPct).toBe(5.0);

    // Loss of $1,260 from 10,500 peak -> Equity 9,240. DD = (1,260 / 10,500) = 12.0%
    tracker.recordRealizedPnl(-1260);
    expect(tracker.currentEquity).toBe(9_240);
    expect(tracker.state.maxDrawdownPct).toBe(12.0);
  });

  it("updates state via EventBus when attached", async () => {
    let mockTime = Date.UTC(2026, 9, 5, 12, 0, 0);
    const bus = new EventBus();
    const tracker = new RiskStateTracker(10_000, { now: () => mockTime });
    tracker.attachToBus(bus);

    await bus.publish({
      name: "trade.submitted",
      timestamp: mockTime,
      payload: { tradeId: "tp:101", lotSize: 0.05, entry: 2000, symbol: "XAUUSD", direction: "LONG" },
    });

    expect(tracker.state.openTrades).toBe(1);
    expect(tracker.state.netExposureLots).toBe(0.05);

    mockTime += 1000;
    await bus.publish({
      name: "trade.closed",
      timestamp: mockTime,
      payload: { tradeId: "tp:101", realizedPnl: -150 },
    });

    expect(tracker.state.openTrades).toBe(0);
    expect(tracker.state.netExposureLots).toBe(0);
    expect(tracker.state.dailyLossPct).toBe(1.5);
  });

  it("causes evaluateRisk to reject trades when dynamic limits are breached", () => {
    const tracker = new RiskStateTracker(10_000);

    // Clean state approves setup
    const cleanEnv = { equity: tracker.currentEquity, state: tracker.state, killSwitch: "NONE" as const };
    const initialDecision = evaluateRisk(CFG, cleanEnv, LONG_SETUP, "LONG");
    expect(initialDecision.verdict).toBe("APPROVED");

    // Open 2 trades to reach maxOpenTrades capacity (limit is 2)
    tracker.recordTradeOpened({ id: "t1", symbol: "XAUUSD", direction: "LONG", entry: 2000, lotSize: 0.05, openedAt: 1 });
    tracker.recordTradeOpened({ id: "t2", symbol: "XAUUSD", direction: "LONG", entry: 2000, lotSize: 0.05, openedAt: 2 });

    const capacityEnv = { equity: tracker.currentEquity, state: tracker.state, killSwitch: "NONE" as const };
    const capacityDecision = evaluateRisk(CFG, capacityEnv, LONG_SETUP, "LONG");
    expect(capacityDecision.verdict).toBe("REJECTED");
    expect(capacityDecision.reasons.join(" ")).toMatch(/max open trades/);

    // Close trades and record a loss exceeding daily loss cap (cap is 3%, record 3.5%)
    tracker.recordTradeClosed("t1", -150);
    tracker.recordTradeClosed("t2", -200); // Total loss = -$350 -> 3.5%
    expect(tracker.state.openTrades).toBe(0);
    expect(tracker.state.dailyLossPct).toBe(3.5);

    const lossEnv = { equity: tracker.currentEquity, state: tracker.state, killSwitch: "NONE" as const };
    const lossDecision = evaluateRisk(CFG, lossEnv, LONG_SETUP, "LONG");
    expect(lossDecision.verdict).toBe("REJECTED");
    expect(lossDecision.killSwitchLevel).toBe("L3");
    expect(lossDecision.reasons.join(" ")).toMatch(/kill switch L3 active/);
  });
});
