import { EventBus } from "../core/events/EventBus.js";
import { createConsoleLogger, type Logger } from "../core/logging/Logger.js";
import { CandleCache } from "../marketdata/CandleCache.js";
import { BiquitiAdapter } from "../marketdata/biquiti/BiquitiAdapter.js";
import { StructureEngine } from "../strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../strategies/engines/PriceActionEngine.js";
import { ConfluenceEngine } from "../strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../strategies/StrongCandleStrategy.js";
import { SetupStore } from "../strategies/SetupStore.js";
import { NovitaProvider } from "../ai/NovitaProvider.js";
import { AiRouter, DEFAULT_AI_ROUTER_CONFIG } from "../ai/AiRouter.js";
import { BudgetGuard } from "../ai/BudgetGuard.js";
import { CircuitBreaker } from "../ai/CircuitBreaker.js";
import { ContextBuilder } from "../ai/ContextBuilder.js";
import { SupabaseRepository } from "../persistence/SupabaseRepository.js";
import { NullRepository, type PersistenceRepository } from "../persistence/Persistence.js";
import { TelegramNotifier } from "../telegram/TelegramNotifier.js";
import { Scanner } from "../scanner/Scanner.js";
import { TradingPipeline } from "./TradingPipeline.js";
import { IdempotencyGuard } from "../safety/IdempotencyGuard.js";
import { KillSwitch } from "../risk/KillSwitch.js";
import type { AppConfig } from "../config/AppConfig.js";
import type { RiskConfig, RiskEnvironment } from "../risk/RiskEngine.js";
import { DEFAULT_RISK_STATE } from "../risk/RiskEngine.js";
import type { Mode } from "./types.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";

/** Wires every module into a runnable graph. External credentials come from config. */
export function buildApp(cfg: AppConfig, log: Logger = createConsoleLogger("gp")): {
  bus: EventBus;
  cache: CandleCache;
  scanner: Scanner;
  pipeline: TradingPipeline;
  killSwitch: KillSwitch;
} {
  const bus = new EventBus((msg, err) => log.error(`event-bus: ${msg}`, err));

  const cache = new CandleCache();
  const adapter = new BiquitiAdapter(cfg.biquiti, log.child("biquiti"));
  if (!adapter.isConfigured()) {
    log.warn("Biquiti market data not configured — the scanner will report provider errors until credentials are set");
  }

  const confluence = new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]);
  const strategy = new StrongCandleStrategy();
  const setupStore = new SetupStore();

  const novita = new NovitaProvider(
    { baseUrl: cfg.ai.baseUrl, apiKey: cfg.ai.apiKey, model: cfg.ai.model, timeoutMs: cfg.ai.timeoutMs },
    log.child("novita")
  );
  const ai = new AiRouter(
    novita,
    new BudgetGuard({ hourlyBudgetUsd: cfg.ai.hourlyBudgetUsd, dailyBudgetUsd: cfg.ai.dailyBudgetUsd }),
    new CircuitBreaker(),
    new ContextBuilder(),
    log.child("ai"),
    { ...DEFAULT_AI_ROUTER_CONFIG, enabled: cfg.features.aiEnabled, maxRetries: cfg.ai.maxRetries, cacheTtlMs: cfg.ai.cacheTtlMs }
  );

  const repo = buildRepository(cfg, log);
  const telegram = new TelegramNotifier(cfg.telegram, log.child("telegram"));

  const idempotency = new IdempotencyGuard();
  const killSwitch = new KillSwitch(async (state) => {
    log.warn(`kill switch changed to ${state.level}`, { reason: state.reason, by: state.updatedBy });
  });

  const riskConfig: RiskConfig = {
    perTradePct: cfg.risk.perTradePct,
    dailyLossCapPct: cfg.risk.dailyLossCapPct,
    weeklyLossCapPct: cfg.risk.weeklyLossCapPct,
    maxDrawdownPct: cfg.risk.maxDrawdownPct,
    maxOpenTrades: cfg.risk.maxOpenTrades,
    netExposureMax: cfg.risk.netExposureMax,
    marginCeilingPct: cfg.risk.marginCeilingPct,
    accountEquity: cfg.risk.accountEquity,
  };
  const riskEnv = (): RiskEnvironment => ({
    equity: riskConfig.accountEquity,
    state: DEFAULT_RISK_STATE,
    killSwitch: killSwitch.level,
    mode: cfg.mode,
  });

  const pipeline = new TradingPipeline({
    bus,
    cache,
    confluence,
    strategy,
    setupStore,
    ai,
    riskConfig,
    riskEnv,
    repo,
    telegram,
    mode: cfg.mode as Mode,
    log,
    idempotency,
    killSwitch,
  });

  const scanner = new Scanner(
    adapter,
    cache,
    {
      symbols: cfg.symbols as Symbol[],
      timeframes: cfg.timeframes as Timeframe[],
      limit: 500,
      scanIntervalMs: cfg.scanIntervalMs,
    },
    log.child("scanner")
  );

  return { bus, cache, scanner, pipeline, killSwitch };
}

function buildRepository(cfg: AppConfig, log: Logger): PersistenceRepository {
  if (!cfg.features.persistenceEnabled) return new NullRepository();
  if (cfg.supabase.url === "" || cfg.supabase.serviceKey === "") {
    log.warn("persistence enabled but Supabase not configured — using no-op repository");
    return new NullRepository();
  }
  return new SupabaseRepository({ url: cfg.supabase.url, serviceKey: cfg.supabase.serviceKey }, log.child("supabase"));
}