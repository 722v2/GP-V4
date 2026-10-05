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
}

export interface SimulatedFill {
  readonly tradeId: string;
  readonly lotSize: number;
  readonly entry: number;
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

    const ctx = { symbol, timeframe, candles };
    const conf: ConfluenceResult = confluence.evaluate(ctx);
    await bus.publish({ name: "scan.completed", timestamp: this.now(), payload: { symbol, timeframe, score: conf.score } });

    const setup = strategy.evaluate(ctx, conf.direction);
    if (!setup) {
      return { ...base, setup: null, ai: null, risk: null, action: { kind: "NO_SETUP" }, reasons: ["no qualifying setup"] };
    }

    const isNew = setupStore.add(setup);
    if (!isNew) {
      return { ...base, setup, ai: null, risk: null, action: { kind: "NO_SETUP" }, reasons: ["duplicate setup (idempotent)"] };
    }
    setupStore.transition(setup.id, "ACTIVE");
    await bus.publish({ name: "setup.created", timestamp: this.now(), payload: { setupId: setup.id } });
    await safe(() => repo.saveSetup(setup), log, "saveSetup");

    // AI review — degradation never blocks the pipeline, only the trade.
    const aiResult = await ai.analyze(ctx, conf, setup, this.deps.riskConfig.accountEquity, mode);
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

    const risk = evaluateRisk(this.deps.riskConfig, env, setup, setup.direction, mode);
    await bus.publish({
      name: risk.verdict === "APPROVED" ? "risk.approved" : "risk.rejected",
      timestamp: this.now(),
      payload: { setupId: setup.id, reasons: risk.reasons },
    });

    if (risk.verdict !== "APPROVED") {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "RISK_REJECTED" }, reasons: [...risk.reasons] };
    }

    return this.handleApproved(setup, aiResult, risk, mode);
  }

  private async handleApproved(
    setup: Setup,
    aiResult: CycleOutcome["ai"],
    risk: NonNullable<CycleOutcome["risk"]>,
    mode: Mode
  ): Promise<CycleOutcome> {
    const { bus, repo, telegram, log } = this.deps;
    const base: Pick<CycleOutcome, "symbol" | "timeframe" | "barOpenTime"> = {
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      barOpenTime: setup.barOpenTime,
    };
    const signal = buildSignal(setup, risk, mode, this.now());
    await bus.publish({ name: "signal.generated", timestamp: this.now(), payload: { signalId: signal.id } });
    const plan = buildTradePlan(signal, this.now());
    await bus.publish({ name: "trade.planned", timestamp: this.now(), payload: { tradeId: plan.id } });
    await safe(
      () => repo.saveTradePlan(plan, { verdict: risk.verdict, lotSize: risk.lotSize, riskAmount: risk.riskAmount, reasons: risk.reasons }),
      log,
      "saveTradePlan"
    );
    await telegram.notify(
      TelegramNotifierClass.formatDecision(setup.symbol, setup.direction, risk.entry, risk.stopLoss, risk.takeProfit1, risk.takeProfit2, mode)
    );

    if (mode === "ANALYSIS_ONLY") {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "ANALYSIS", note: "analysis only — no order originated" }, reasons: ["analysis mode"] };
    }
    if (requiresConfirmation(mode)) {
      return { ...base, setup, ai: aiResult, risk, action: { kind: "AWAITING_CONFIRMATION" }, reasons: ["manual confirmation required"] };
    }
    if (isSimulated(mode)) {
      const fill: SimulatedFill = { tradeId: plan.id, lotSize: plan.lotSize, entry: plan.entry };
      await bus.publish({ name: "trade.submitted", timestamp: this.now(), payload: fill });
      return { ...base, setup, ai: aiResult, risk, action: { kind: "EXECUTED_SIMULATED", lotSize: risk.lotSize }, reasons: [`simulated fill ${mode}`] };
    }
    // AUTO_TRADING with a live venue is intentionally not wired to a broker here:
    // the broker venue contract is external. Surface a candidate for the execution layer.
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
