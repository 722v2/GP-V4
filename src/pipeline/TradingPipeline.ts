import type { Logger } from "../core/logging/Logger.js";
import type { EventBus } from "../core/events/EventBus.js";
import type { CandleCache } from "../marketdata/CandleCache.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { ConfluenceEngine, type ConfluenceResult } from "../strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../strategies/StrongCandleStrategy.js";
import { SetupStore } from "../strategies/SetupStore.js";
import { evaluateRisk, type RiskConfig, type RiskEnvironment } from "../risk/RiskEngine.js";
import type { PersistenceRepository } from "../persistence/Persistence.js";
import type { TelegramNotifier } from "../telegram/TelegramNotifier.js";
import { TelegramNotifier as TelegramNotifierClass } from "../telegram/TelegramNotifier.js";
import type { AiRouter } from "../ai/AiRouter.js";
import { buildSignal, buildTradePlan } from "./Signal.js";
import { isSimulated, requiresAiGate, requiresConfirmation, type CycleAction, type CycleOutcome, type Mode } from "./types.js";
import type { Setup } from "../core/types/Setup.js";
import { IdempotencyGuard } from "../safety/IdempotencyGuard.js";
import { KillSwitch } from "../risk/KillSwitch.js";
import type { RiskStateTracker } from "../risk/RiskStateTracker.js";
import type { Direction } from "../core/types/Setup.js";
import type { SpreadSlippageModel } from "../execution/TradeLifecycle.js";
import type { TradePlan } from "../core/types/Trade.js";
import type { InstrumentSpec } from "../risk/InstrumentSpec.js";
import { DEFAULT_XAUUSD_SPEC } from "../risk/InstrumentSpec.js";
import type { AccountCapitalSource } from "../risk/AccountCapital.js";
import type { MarketFilterEngine } from "../filters/MarketFilterEngine.js";
import type { ExperienceMemory } from "../core/memory/ExperienceMemory.js";
import type { ExecutionEngine } from "../execution/ExecutionEngine.js";

export interface PipelineDeps {
  readonly bus: EventBus;
  readonly cache: CandleCache;
  readonly confluence: ConfluenceEngine;
  readonly strategy: StrongCandleStrategy;
  readonly setupStore: SetupStore;
  readonly ai: AiRouter;
  readonly riskConfig: RiskConfig;
  readonly riskEnv: () => RiskEnvironment;
  readonly repo: PersistenceRepository;
  readonly telegram: TelegramNotifier;
  readonly mode: Mode;
  readonly log: Logger;
  readonly now?: () => number;
  /** Cross-restart duplicate-bar guard; optional (setup store covers in-run duplicates). */
  readonly idempotency?: IdempotencyGuard;
  /** Kill switch consulted before any order origination. */
  readonly killSwitch?: KillSwitch;
  /** Dynamic risk state tracker. */
  readonly riskTracker?: RiskStateTracker;
  /** Spread and slippage model for simulated execution. */
  readonly spreadModel?: SpreadSlippageModel;
  /** Instrument specification abstraction. */
  readonly instrumentSpec?: InstrumentSpec;
  /** Live account capital source. */
  readonly accountCapitalSource?: AccountCapitalSource;
  /** Number of completed bars before active setups expire (default 6). */
  readonly expiryBars?: number;
  /** Central market filter engine (session, spread, news). */
  readonly marketFilterEngine?: MarketFilterEngine;
  /** Advisory experience memory layer. */
  readonly experienceMemory?: ExperienceMemory;
  /** Real broker execution engine for AUTO_TRADING. */
  readonly executionEngine?: ExecutionEngine;
}

export interface SimulatedFill {
  readonly tradeId: string;
  readonly lotSize: number;
  readonly entry: number;
  readonly symbol?: Symbol;
  readonly direction?: Direction;
  readonly stopLoss?: number;
  readonly takeProfit1?: number;
  readonly takeProfit2?: number;
  readonly plan?: TradePlan;
}

/**
 * Trading pipeline for a single closed bar. Deterministic given the same cache
 * contents, AI result, and risk state. Order of gates:
 *   engines/confluence -> strategy setup -> AI review -> risk -> mode handling.
 * AI can only DOWNGRADE a setup (block or lower confidence); it never invents a
 * trade or a lot size.
 */
export class TradingPipeline {
  private readonly now: () => number;

  constructor(private readonly deps: PipelineDeps) {
    this.now = deps.now ?? Date.now;
  }

  async onBarClosed(symbol: Symbol, timeframe: Timeframe): Promise<CycleOutcome> {
    const { bus, cache, confluence, strategy, setupStore, ai, repo, telegram, log, mode } = this.deps;
    const candles = cache.get(symbol, timeframe);
    const last = candles[candles.length - 1];
    const barOpenTime = last ? last.openTime : 0;

    if (last && this.deps.idempotency) {
      if (!this.deps.idempotency.claimIfNewer(last)) {
        return { symbol, timeframe, barOpenTime, setup: null, ai: null, risk: null, action: { kind: "NO_SETUP" }, reasons: ["duplicate bar (idempotency guard)"] };
      }
    }
    const base: Pick<CycleOutcome, "symbol" | "timeframe" | "barOpenTime"> = {
      symbol,
      timeframe,
      barOpenTime,
    };

    // P2-16: Expire stale active setups for this symbol×timeframe and clean terminal setups
    if (barOpenTime > 0) {
      const expiryBars = this.deps.expiryBars ?? 6;
      const { expired } = setupStore.expireAndCleanup(symbol, timeframe, barOpenTime, expiryBars);
      for (const s of expired) {
        await bus.publish({ name: "setup.updated", timestamp: this.now(), payload: { setupId: s.id, state: "EXPIRED" } });
        await safe(() => repo.saveSetup(s), log, "saveSetup");
      }
    }

    const ctx = { symbol, timeframe, candles };
    const conf: ConfluenceResult = confluence.evaluate(ctx);
    await bus.publish({ name: "scan.completed", timestamp: this.now(), payload: { symbol, timeframe, score: conf.score } });

    const setup = strategy.evaluate(ctx, conf.direction);
    if (!setup) {
      return { ...base, setup: null, ai: null, risk: null, action: { kind: "NO_SETUP" }, reasons: ["no qualifying setup"] };
    }

    if (this.deps.marketFilterEngine) {
      const filterResult = await this.deps.marketFilterEngine.evaluate(symbol, barOpenTime);
      if (!filterResult.passed) {
        const primaryRejection = filterResult.rejections[0];
        const reasons = filterResult.rejections.map((r) => r.message);
        return {
          ...base,
          setup,
          ai: null,
          risk: null,
          action: { kind: "FILTER_BLOCKED", filterName: primaryRejection?.filterName ?? "MarketFilter" },
          reasons,
        };
      }
    }

    const isNew = setupStore.add(setup);
    if (!isNew) {
      return { ...base, setup, ai: null, risk: null, action: { kind: "NO_SETUP" }, reasons: ["duplicate setup (idempotent)"] };
    }
    setupStore.transition(setup.id, "ACTIVE");
    await bus.publish({ name: "setup.created", timestamp: this.now(), payload: { setupId: setup.id } });
    try {
      await repo.saveSetup(setup);
    } catch (err) {
      log.error("saveSetup failed", { err: err instanceof Error ? err.message : String(err) });
      return {
        ...base,
        setup,
        ai: null,
        risk: null,
        action: { kind: "NO_SETUP" },
        reasons: [`persistence failure saving setup: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    // Experience Memory advisory query (point-in-time isolated)
    let expInsight: import("../core/memory/ExperienceMemory.js").ExperienceInsight | undefined;
    if (this.deps.experienceMemory) {
      expInsight = this.deps.experienceMemory.query({
        symbol,
        timeframe,
        direction: setup.direction,
        factors: setup.evidence.map((e) => e.kind),
        asOfTimestamp: barOpenTime,
      });
      if (expInsight.recommendation !== "INSUFFICIENT_DATA") {
        log.debug("experience memory insight", { ...expInsight });
      }
    }

    // AI review — degradation never blocks the pipeline, only the trade.
    const aiResult = await ai.analyze(ctx, conf, setup, this.deps.riskConfig.accountEquity, mode, expInsight);
    await bus.publish({ name: "ai.completed", timestamp: this.now(), payload: { ok: aiResult.ok } });
    await safe(() => repo.saveAiDecision(setup.id, aiResult, mode), log, "saveAiDecision");

    if (aiResult.ok && aiResult.decision.decision !== "TRADE_CANDIDATE") {
      return { ...base, setup, ai: aiResult, risk: null, action: { kind: "AI_BLOCKED" }, reasons: [`AI decision: ${aiResult.decision.decision}`] };
    }
    // If AI failed entirely and the mode moves real or simulated funds, block.
    if (!aiResult.ok && requiresAiGate(mode)) {
      return { ...base, setup, ai: aiResult, risk: null, action: { kind: "AI_BLOCKED" }, reasons: [`AI unavailable: ${aiResult.failure.kind}`] };
    }

    const currentEnv = this.deps.riskEnv();
    const effectiveKillSwitch = this.deps.killSwitch ? this.deps.killSwitch.level : currentEnv.killSwitch;
    const env: RiskEnvironment = {
      ...currentEnv,
      killSwitch: effectiveKillSwitch,
      mode: currentEnv.mode ?? mode,
    };

    const spreadPoints = this.deps.spreadModel ? this.deps.spreadModel.spread : 0;
    const spec = this.deps.instrumentSpec ?? DEFAULT_XAUUSD_SPEC;
    const risk = evaluateRisk(this.deps.riskConfig, env, setup, setup.direction, mode, spec, spreadPoints);
    await bus.publish({
      name: risk.verdict === "APPROVED" ? "risk.approved" : "risk.rejected",
      timestamp: this.now(),
      payload: { setupId: setup.id, reasons: risk.reasons },
    });

    if (risk.verdict !== "APPROVED") {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "RISK_REJECTED" }, reasons: [...risk.reasons] };
    }

    return this.handleApproved(setup, aiResult, risk, mode, conf.score);
  }

  private async handleApproved(
    setup: Setup,
    aiResult: CycleOutcome["ai"],
    risk: NonNullable<CycleOutcome["risk"]>,
    mode: Mode,
    confluenceScore?: number
  ): Promise<CycleOutcome> {
    const { bus, repo, telegram, log } = this.deps;
    const base: Pick<CycleOutcome, "symbol" | "timeframe" | "barOpenTime"> = {
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      barOpenTime: setup.barOpenTime,
    };
    const signal = buildSignal(setup, risk, mode, this.now());

    let signalResult: { accepted: boolean; duplicate: boolean };
    try {
      signalResult = await repo.saveSignal(signal);
    } catch (err) {
      log.error("saveSignal failed", { err: err instanceof Error ? err.message : String(err) });
      return {
        ...base,
        setup,
        ai: aiResult,
        risk,
        action: { kind: "NO_SETUP" },
        reasons: [`persistence failure saving signal: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    if (signalResult.duplicate || !signalResult.accepted) {
      log.info("duplicate signal rejected by persistent idempotency guard", { signalId: signal.id });
      return {
        ...base,
        setup,
        ai: aiResult,
        risk,
        action: { kind: "NO_SETUP" },
        reasons: [`duplicate signal (persistent idempotency guard ${signal.id})`],
      };
    }

    await bus.publish({ name: "signal.generated", timestamp: this.now(), payload: { signalId: signal.id } });
    const plan = buildTradePlan(signal, this.now(), {
      strategyId: setup.strategyId,
      riskPercent: risk.riskPercent,
      spreadAssumptions: risk.spreadCostUsd,
      aiDecision: aiResult?.ok ? aiResult.decision.decision : undefined,
      confidence: aiResult?.ok ? aiResult.decision.confidence : undefined,
      confluenceScore,
      riskVerdict: risk.verdict,
    });
    await bus.publish({ name: "trade.planned", timestamp: this.now(), payload: { tradeId: plan.id } });
    try {
      await repo.saveTradePlan(plan, { verdict: risk.verdict, lotSize: risk.lotSize, riskAmount: risk.riskAmount, reasons: risk.reasons });
    } catch (err) {
      log.error("saveTradePlan failed", { err: err instanceof Error ? err.message : String(err) });
      return {
        ...base,
        setup,
        ai: aiResult,
        risk,
        action: { kind: "RISK_REJECTED" },
        reasons: [`persistence failure saving trade plan: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
    await telegram.notify(
      TelegramNotifierClass.formatDecision(setup.symbol, setup.direction, risk.entry, risk.stopLoss, risk.takeProfit1, risk.takeProfit2, mode)
    );

    if (mode === "ANALYSIS_ONLY") {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "ANALYSIS", note: "analysis only — no order originated" }, reasons: ["analysis mode"] };
    }
    if (requiresConfirmation(mode)) {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "AWAITING_CONFIRMATION" }, reasons: ["manual confirmation required"] };
    }
    if (mode === "AUTO_TRADING" && this.deps.executionEngine) {
      const execResult = await this.deps.executionEngine.executePlan(plan, mode);
      if (execResult.success) {
        await telegram.notify(
          `🚀 <b>MT5 REAL ORDER FILLED</b>\n` +
          `Order ID: <code>${execResult.orderId}</code>\n` +
          `Symbol: ${plan.symbol} | Direction: ${plan.direction}\n` +
          `Lots: ${execResult.filledLot} @ ${execResult.fillPrice}\n` +
          `SL: ${plan.stopLoss} | TP1: ${plan.takeProfit1} | TP2: ${plan.takeProfit2}`
        );
        return {
          ...base,
          setup,
          ai: aiResult,
          risk,
          action: { kind: "EXECUTED_BROKER", orderId: execResult.orderId, lotSize: execResult.filledLot },
          reasons: [`MT5 broker order filled: ${execResult.orderId}`],
        };
      } else {
        await telegram.notify(
          `⚠️ <b>MT5 ORDER REJECTED</b>\n` +
          `Symbol: ${plan.symbol} | Direction: ${plan.direction}\n` +
          `Reason: ${execResult.rejectionReason || "Broker rejected order"}`
        );
        return {
          ...base,
          setup,
          ai: aiResult,
          risk,
          action: { kind: "EXECUTION_REJECTED", reason: execResult.rejectionReason },
          reasons: [execResult.rejectionReason || "MT5 execution rejected"],
        };
      }
    }
    if (isSimulated(mode)) {
      const adjustedEntry = this.deps.spreadModel
        ? this.deps.spreadModel.adjustedFill(plan.direction, plan.entry)
        : plan.entry;
      const fill: SimulatedFill = {
        tradeId: plan.id,
        lotSize: plan.lotSize,
        entry: adjustedEntry,
        symbol: plan.symbol,
        direction: plan.direction,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        plan,
      };
      await bus.publish({ name: "trade.submitted", timestamp: this.now(), payload: fill });
      return { ...base, setup, ai: aiResult, risk, action: { kind: "EXECUTED_SIMULATED", lotSize: risk.lotSize }, reasons: [`simulated fill ${mode}`] };
    }
    // AUTO_TRADING without configured execution engine surfaces candidate
    return { ...base, setup, ai: aiResult, risk, action: { kind: "CANDIDATE" }, reasons: ["auto mode — execution venue boundary not configured"] };
  }
}

async function safe(fn: () => Promise<void>, log: Logger, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn(`pipeline ${label} failed (continuing)`, { err: err instanceof Error ? err.message : String(err) });
  }
}
