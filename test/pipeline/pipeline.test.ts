import { describe, expect, it, beforeEach } from "vitest";
import { EventBus } from "../../src/core/events/EventBus.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { AiRouter, DEFAULT_AI_ROUTER_CONFIG } from "../../src/ai/AiRouter.js";
import { BudgetGuard } from "../../src/ai/BudgetGuard.js";
import { CircuitBreaker } from "../../src/ai/CircuitBreaker.js";
import { ContextBuilder } from "../../src/ai/ContextBuilder.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { buildSignal, buildTradePlan, resetSignalCounter } from "../../src/pipeline/Signal.js";
import { collectClosedBarEvents } from "../../src/pipeline/barEvents.js";
import { isExecutionMode, isSimulated, requiresConfirmation, MODES } from "../../src/pipeline/types.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { IdempotencyGuard } from "../../src/safety/IdempotencyGuard.js";
import type { RiskConfig } from "../../src/risk/RiskEngine.js";
import type { AiProvider, AiProviderResult } from "../../src/ai/types.js";
import type { Candle } from "../../src/core/types/Candle.js";
import type { Setup } from "../../src/core/types/Setup.js";

const log = createConsoleLogger("test");
const TF = 300_000;

function bar(i: number, open: number, high: number, low: number, close: number): Candle {
  const o = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime: o, open, high, low, close, volume: 100, closeTime: o + TF - 1 };
}

/** Bullish HH/HL sequence ending in a strong bull candle (from confluence tests). */
function bullishCandles(): Candle[] {
  return [
    bar(0, 2000, 2010, 1998, 2008),
    bar(1, 2008, 2018, 2006, 2016),
    bar(2, 2016, 2022, 2014, 2020),
    bar(3, 2020, 2021, 2005, 2008),
    bar(4, 2008, 2009, 1996, 2002),
    bar(5, 2002, 2013, 2000, 2010),
    bar(6, 2010, 2026, 2008, 2024),
    bar(7, 2024, 2030, 2022, 2028),
    bar(8, 2028, 2029, 2012, 2016),
    bar(9, 2016, 2017, 2004, 2010),
    bar(10, 2010, 2026, 2008, 2024),
    bar(11, 2024, 2040, 2023, 2038),
  ];
}

const RISK: RiskConfig = {
  perTradePct: 0.5,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.5,
  marginCeilingPct: 50,
  accountEquity: 10_000,
};

function aiApproves(): AiProvider {
  return {
    name: "approve",
    complete: async (): Promise<AiProviderResult> => ({
      content: JSON.stringify({
        decision: "TRADE_CANDIDATE",
        direction: "LONG",
        confidence: 0.75,
        evidence: [{ source: "test", detail: "ok" }],
        risk_notes: [],
        management_plan: "hold",
        reassessment_conditions: [],
        reason_codes: [],
      }),
      usage: { prompt: 100, completion: 50 },
      model: "test",
    }),
  };
}

function aiBlocks(): AiProvider {
  return {
    name: "block",
    complete: async (): Promise<AiProviderResult> => ({
      content: JSON.stringify({
        decision: "NO_TRADE",
        confidence: 0.6,
        evidence: [],
        risk_notes: [],
        reassessment_conditions: [],
        reason_codes: [],
      }),
      usage: { prompt: 100, completion: 50 },
      model: "test",
    }),
  };
}

function aiFails(): AiProvider {
  return {
    name: "fails",
    complete: async () => {
      throw new Error("provider exploded");
    },
  };
}

function makePipeline(provider: AiProvider, mode: (typeof MODES)[number], riskState = { openTrades: 0 }, opts: { killSwitch?: KillSwitch; idempotency?: IdempotencyGuard } = {}) {
  resetSignalCounter();
  const bus = new EventBus();
  const cache = new CandleCache();
  const events: string[] = [];
  for (const name of ["scan.completed", "setup.created", "ai.completed", "risk.approved", "risk.rejected", "signal.generated", "trade.planned", "trade.submitted"] as const) {
    bus.on(name, "test-recorder", (e) => {
      events.push(e.name);
    });
  }
  const confluence = new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]);
  const ai = new AiRouter(
    provider,
    new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 }),
    new CircuitBreaker(5, 60_000, () => 0),
    new ContextBuilder(),
    log,
    { ...DEFAULT_AI_ROUTER_CONFIG, cacheTtlMs: 60_000 },
    () => 1_000_000
  );
  const telegram = new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log);
  const pipeline = new TradingPipeline({
    bus,
    cache,
    confluence,
    strategy: new StrongCandleStrategy(),
    setupStore: new SetupStore(),
    ai,
    riskConfig: RISK,
    riskEnv: () => ({
      equity: RISK.accountEquity,
      state: {
        openTrades: riskState.openTrades,
        netExposureLots: 0,
        marginUsedPct: 0,
        dailyLossPct: 0,
        weeklyLossPct: 0,
        maxDrawdownPct: 0,
      },
      killSwitch: "NONE",
    }),
    repo: new NullRepository(),
    telegram,
    mode,
    log,
    now: () => 1_000_000,
    idempotency: opts.idempotency,
    killSwitch: opts.killSwitch,
  });
  return { pipeline, cache, events };
}

describe("mode helpers", () => {
  it("classifies modes correctly", () => {
    expect(isExecutionMode("AUTO_TRADING")).toBe(true);
    expect(isExecutionMode("PAPER_TRADING")).toBe(true);
    expect(isExecutionMode("ANALYSIS_ONLY")).toBe(false);
    expect(isSimulated("PAPER_TRADING")).toBe(true);
    expect(isSimulated("AUTO_TRADING")).toBe(false);
    expect(requiresConfirmation("MANUAL_CONFIRMATION")).toBe(true);
    expect(requiresConfirmation("AUTO_TRADING")).toBe(false);
  });
});

describe("collectClosedBarEvents", () => {
  it("deduplicates repeated bars", () => {
    const tick = {
      newBars: [
        { symbol: "XAUUSD" as const, timeframe: "M5" as const, openTime: 1 },
        { symbol: "XAUUSD" as const, timeframe: "M5" as const, openTime: 1 },
        { symbol: "XAUUSD" as const, timeframe: "M5" as const, openTime: 2 },
      ],
      fetched: 1,
      errors: [],
    };
    const evts = collectClosedBarEvents(tick);
    expect(evts).toHaveLength(2);
  });
});

describe("TradingPipeline", () => {
  beforeEach(() => {
    resetSignalCounter();
  });

  it("ANALYSIS_ONLY: full flow stops before order origination", async () => {
    const { pipeline, cache, events } = makePipeline(aiApproves(), "ANALYSIS_ONLY");
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.setup).not.toBeNull();
    expect(out.ai?.ok).toBe(true);
    expect(out.risk?.verdict).toBe("APPROVED");
    expect(out.action.kind).toBe("ANALYSIS");
    expect(events).toContain("risk.approved");
    expect(events).toContain("signal.generated");
    expect(events).not.toContain("trade.submitted");
  });

  it("PAPER_TRADING: approved setup results in a simulated fill", async () => {
    const { pipeline, cache, events } = makePipeline(aiApproves(), "PAPER_TRADING");
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("EXECUTED_SIMULATED");
    expect(events).toContain("trade.submitted");
    if (out.action.kind === "EXECUTED_SIMULATED") expect(out.action.lotSize).toBeGreaterThan(0);
  });

  it("MANUAL_CONFIRMATION: approved setup awaits confirmation", async () => {
    const { pipeline, cache } = makePipeline(aiApproves(), "MANUAL_CONFIRMATION");
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("AWAITING_CONFIRMATION");
  });

  it("AI NO_TRADE blocks the cycle before risk", async () => {
    const { pipeline, cache, events } = makePipeline(aiBlocks(), "PAPER_TRADING");
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("AI_BLOCKED");
    expect(out.risk).toBeNull();
    expect(events).not.toContain("risk.approved");
  });

  it("AI failure blocks execution modes but not ANALYSIS_ONLY", async () => {
    const failExec = makePipeline(aiFails(), "PAPER_TRADING");
    failExec.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const blocked = await failExec.pipeline.onBarClosed("XAUUSD", "M5");
    expect(blocked.action.kind).toBe("AI_BLOCKED");

    const failAnalysis = makePipeline(aiFails(), "ANALYSIS_ONLY");
    failAnalysis.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const continued = await failAnalysis.pipeline.onBarClosed("XAUUSD", "M5");
    expect(continued.risk?.verdict).toBe("APPROVED");
    expect(continued.action.kind).toBe("ANALYSIS");
  });

  it("risk rejection caps the cycle", async () => {
    const { pipeline, cache } = makePipeline(aiApproves(), "PAPER_TRADING", { openTrades: 2 });
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("RISK_REJECTED");
    expect(out.risk?.verdict).toBe("REJECTED");
    expect(out.reasons.join(" ")).toMatch(/max open trades/);
  });

  it("duplicate bars are idempotent — no second setup", async () => {
    const { pipeline, cache } = makePipeline(aiApproves(), "ANALYSIS_ONLY");
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const first = await pipeline.onBarClosed("XAUUSD", "M5");
    const second = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(first.setup).not.toBeNull();
    expect(second.action.kind).toBe("NO_SETUP");
    expect(second.reasons[0]).toMatch(/duplicate/);
  });

  it("no setup when confluence has no direction", async () => {
    const { pipeline, cache } = makePipeline(aiApproves(), "ANALYSIS_ONLY");
    const flat = [0, 1, 2, 3, 4, 5].map((i) => bar(i, 2000, 2002, 1998, 2000));
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: flat });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("NO_SETUP");
  });

  it("kill switch L3 blocks all order origination", async () => {
    const ks = new KillSwitch(async () => {});
    await ks.escalate("L3", "daily loss cap");
    const { pipeline, cache, events } = makePipeline(aiApproves(), "PAPER_TRADING", { openTrades: 0 }, { killSwitch: ks });
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const out = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(out.action.kind).toBe("RISK_REJECTED");
    expect(out.reasons[0]).toMatch(/L3/);
    expect(events).not.toContain("risk.approved");
    expect(events).toContain("risk.rejected");
  });

  it("kill switch L2 blocks simulated entries and auto trading, but allows ANALYSIS_ONLY", async () => {
    const ks = new KillSwitch(async () => {});
    await ks.escalate("L2", "max open trades");

    // PAPER_TRADING is blocked
    const paper = makePipeline(aiApproves(), "PAPER_TRADING", { openTrades: 0 }, { killSwitch: ks });
    paper.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const paperOut = await paper.pipeline.onBarClosed("XAUUSD", "M5");
    expect(paperOut.action.kind).toBe("RISK_REJECTED");
    expect(paperOut.reasons[0]).toMatch(/L2/);
    expect(paper.events).not.toContain("risk.approved");
    expect(paper.events).toContain("risk.rejected");

    // AUTO_TRADING is blocked
    const auto = makePipeline(aiApproves(), "AUTO_TRADING", { openTrades: 0 }, { killSwitch: ks });
    auto.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const autoOut = await auto.pipeline.onBarClosed("XAUUSD", "M5");
    expect(autoOut.action.kind).toBe("RISK_REJECTED");
    expect(autoOut.reasons[0]).toMatch(/L2/);

    // MANUAL_CONFIRMATION is blocked
    const manual = makePipeline(aiApproves(), "MANUAL_CONFIRMATION", { openTrades: 0 }, { killSwitch: ks });
    manual.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const manualOut = await manual.pipeline.onBarClosed("XAUUSD", "M5");
    expect(manualOut.action.kind).toBe("RISK_REJECTED");
    expect(manualOut.reasons[0]).toMatch(/L2/);

    // ANALYSIS_ONLY is NOT blocked
    const analysis = makePipeline(aiApproves(), "ANALYSIS_ONLY", { openTrades: 0 }, { killSwitch: ks });
    analysis.cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const analysisOut = await analysis.pipeline.onBarClosed("XAUUSD", "M5");
    expect(analysisOut.action.kind).toBe("ANALYSIS");
    expect(analysis.events).toContain("risk.approved");
  });

  it("idempotency guard blocks duplicate bar processing", async () => {
    const guard = new IdempotencyGuard();
    const { pipeline, cache } = makePipeline(aiApproves(), "ANALYSIS_ONLY", { openTrades: 0 }, { idempotency: guard });
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: bullishCandles() });
    const first = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(first.setup).not.toBeNull();
    const second = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(second.action.kind).toBe("NO_SETUP");
    expect(second.reasons[0]).toMatch(/idempotency guard/);
  });
});

describe("Signal / TradePlan builders", () => {
  it("builds an immutable signal and plan with consistent ids", () => {
    const setup: Setup = {
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
      rationale: "r",
      evidence: [],
    };
    const risk = {
      verdict: "APPROVED" as const,
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.05,
      riskAmount: 50,
      reasons: [],
      killSwitchLevel: "NONE" as const,
    };
    const sig = buildSignal(setup, risk, "PAPER_TRADING", 123);
    const plan = buildTradePlan(sig, 456);
    expect(sig.lotSize).toBe(0.05);
    expect(sig.setupId).toBe(setup.id);
    expect(plan.signalId).toBe(sig.id);
    expect(plan.lotSize).toBe(sig.lotSize);
    expect(plan.mode).toBe("PAPER_TRADING");
  });
});
