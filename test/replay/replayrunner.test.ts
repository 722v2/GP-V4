import { describe, expect, it } from "vitest";
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
import { ReplayRunner } from "../../src/replay/ReplayRunner.js";
import { resetSignalCounter } from "../../src/pipeline/Signal.js";
import type { RiskConfig } from "../../src/risk/RiskEngine.js";
import type { AiProvider, AiProviderResult } from "../../src/ai/types.js";
import type { Candle } from "../../src/core/types/Candle.js";

const log = createConsoleLogger("test");
const TF = 300_000;
function bar(i: number, o: number, h: number, l: number, c: number): Candle {
  const openTime = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime, open: o, high: h, low: l, close: c, volume: 100, closeTime: openTime + TF - 1 };
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

const approvingAi: AiProvider = {
  name: "approve",
  complete: async (): Promise<AiProviderResult> => ({
    content: JSON.stringify({
      decision: "TRADE_CANDIDATE",
      direction: "LONG",
      confidence: 0.7,
      evidence: [],
      risk_notes: [],
      reassessment_conditions: [],
      reason_codes: [],
    }),
    usage: { prompt: 10, completion: 5 },
    model: "test",
  }),
};

function makeReplayPipeline() {
  resetSignalCounter();
  const bus = new EventBus();
  const cache = new CandleCache();
  const ai = new AiRouter(
    approvingAi,
    new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 }),
    new CircuitBreaker(5, 60_000, () => 0),
    new ContextBuilder(),
    log,
    { ...DEFAULT_AI_ROUTER_CONFIG, cacheTtlMs: 60_000 },
    () => 1_000_000
  );
  const pipeline = new TradingPipeline({
    bus,
    cache,
    confluence: new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]),
    strategy: new StrongCandleStrategy(),
    setupStore: new SetupStore(),
    ai,
    riskConfig: RISK,
    riskEnv: () => ({
      equity: RISK.accountEquity,
      state: { openTrades: 0, netExposureLots: 0, marginUsedPct: 0, dailyLossPct: 0, weeklyLossPct: 0, maxDrawdownPct: 0 },
      killSwitch: "NONE",
    }),
    repo: new NullRepository(),
    telegram: new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log),
    mode: "REPLAY",
    log,
    now: () => 1_000_000,
  });
  return new ReplayRunner(pipeline, cache, { warmupBars: 5 });
}

describe("ReplayRunner", () => {
  it("replays fixtures through the live pipeline deterministically", async () => {
    const fixtures = [
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
      bar(11, 2024, 2040, 2023, 2038), // strong bull trigger
      bar(12, 2038, 2052, 2034, 2048),
    ];
    const runner = makeReplayPipeline();
    const result = await runner.run(fixtures);
    expect(result.candlesProcessed).toBe(fixtures.length - 5);
    expect(result.cycles).toHaveLength(8);
    const executed = result.cycles.filter((c) => c.action.kind === "EXECUTED_SIMULATED");
    expect(executed.length).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic across runs", async () => {
    const fixtures = [
      bar(0, 2000, 2010, 1998, 2008),
      bar(1, 2008, 2018, 2006, 2016),
      bar(2, 2016, 2022, 2014, 2020),
      bar(3, 2020, 2021, 2005, 2008),
      bar(4, 2008, 2009, 1996, 2002),
      bar(5, 2002, 2013, 2000, 2010),
      bar(6, 2010, 2026, 2008, 2024),
      bar(7, 2024, 2030, 2022, 2028),
    ];
    const a = await makeReplayPipeline().run(fixtures);
    const b = await makeReplayPipeline().run(fixtures);
    const summary = (r: typeof a) => r.cycles.map((c) => `${c.action.kind}:${c.reasons.join("|")}`);
    expect(summary(a)).toEqual(summary(b));
  });

  it("throws on empty fixtures", async () => {
    await expect(makeReplayPipeline().run([])).rejects.toThrow(/at least one fixture/);
  });
});
