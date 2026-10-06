import { EventBus } from "../core/events/EventBus.js";
import { createConsoleLogger, type Logger } from "../core/logging/Logger.js";
import { CandleCache } from "../marketdata/CandleCache.js";
import { BiquitiAdapter } from "../marketdata/biquiti/BiquitiAdapter.js";
import { StructureEngine } from "../strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../strategies/engines/PriceActionEngine.js";
import { IndicatorEngine } from "../strategies/engines/IndicatorEngine.js";
import { ZoneEngine } from "../strategies/engines/ZoneEngine.js";
import { RegimeEngine } from "../strategies/engines/RegimeEngine.js";
import { SessionEngine } from "../strategies/engines/SessionEngine.js";
import { ConfluenceEngine } from "../strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../strategies/StrongCandleStrategy.js";
import { SetupStore } from "../strategies/SetupStore.js";
import { ExperienceMemory } from "../core/memory/ExperienceMemory.js";
import { NovitaProvider } from "../ai/NovitaProvider.js";
import { AiRouter, DEFAULT_AI_ROUTER_CONFIG } from "../ai/AiRouter.js";
import { BudgetGuard } from "../ai/BudgetGuard.js";
import { CircuitBreaker } from "../ai/CircuitBreaker.js";
import { ContextBuilder } from "../ai/ContextBuilder.js";
import { SupabaseRepository } from "../persistence/SupabaseRepository.js";
import { NullRepository, InMemoryRepository, type PersistenceRepository } from "../persistence/Persistence.js";
import { RetryingRepository } from "../persistence/PersistenceRetry.js";
import { TelegramNotifier } from "../telegram/TelegramNotifier.js";
import { Scanner } from "../scanner/Scanner.js";
import { TradingPipeline } from "./TradingPipeline.js";
import { IdempotencyGuard } from "../safety/IdempotencyGuard.js";
import { KillSwitch } from "../risk/KillSwitch.js";
import type { AppConfig } from "../config/AppConfig.js";
import type { RiskConfig, RiskEnvironment } from "../risk/RiskEngine.js";
import { RiskStateTracker } from "../risk/RiskStateTracker.js";
import type { Mode } from "./types.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { SpreadSlippageModel } from "../execution/TradeLifecycle.js";
import { SimulatedProtection, type BrokerProtection } from "../execution/BrokerProtection.js";
import { SimulatedPositionManager } from "../execution/SimulatedPositionManager.js";
import { ReconciliationService } from "../safety/Reconciliation.js";
import { MarketFilterEngine } from "../filters/MarketFilterEngine.js";
import type { BrokerAdapter } from "../execution/broker/BrokerAdapter.js";
import { PaperBrokerAdapter } from "../execution/broker/PaperBrokerAdapter.js";
import { NullBrokerAdapter } from "../execution/broker/NullBrokerAdapter.js";
import { JustMarketsMt5Adapter, HttpMt5BridgeClient } from "../execution/broker/JustMarketsMt5Adapter.js";
import { Mt5Service } from "../execution/broker/Mt5Service.js";
import { ExecutionEngine } from "../execution/ExecutionEngine.js";
import { PromotionGateEngine } from "../safety/PromotionGates.js";
import { DEFAULT_XAUUSD_SPEC } from "../risk/InstrumentSpec.js";
import { ScannerActivityStore } from "../scanner/ScannerActivity.js";
import { RuntimeConfigStore } from "../config/RuntimeConfigStore.js";

export interface AppRuntime {
  bus: EventBus;
  cache: CandleCache;
  scanner: Scanner;
  pipeline: TradingPipeline;
  killSwitch: KillSwitch;
  riskTracker: RiskStateTracker;
  positionManager: SimulatedPositionManager;
  protection: BrokerProtection;
  spreadModel: SpreadSlippageModel;
  repo: PersistenceRepository;
  setupStore: SetupStore;
  reconciliation: ReconciliationService;
  idempotency: IdempotencyGuard;
  adapter: BiquitiAdapter;
  ai: AiRouter;
  telegram: TelegramNotifier;
  marketFilterEngine: MarketFilterEngine;
  broker: BrokerAdapter;
  executionEngine: ExecutionEngine;
  promotionEngine: PromotionGateEngine;
  scannerActivityStore?: ScannerActivityStore;
  scheduler?: import("../scanner/ScannerScheduler.js").ScannerScheduler;
  configStore?: RuntimeConfigStore;
  experienceMemory?: ExperienceMemory;
  mt5Service?: Mt5Service;
}

/** Wires every module into a runnable graph. External credentials come from config. */
export function buildApp(
  cfg: AppConfig,
  log: Logger = createConsoleLogger("gp"),
  providedConfigStore?: RuntimeConfigStore
): AppRuntime {
  const bus = new EventBus((msg, err) => log.error(`event-bus: ${msg}`, err));

  const cache = new CandleCache();
  const adapter = new BiquitiAdapter(cfg.biquiti, log.child("biquiti"));
  if (!adapter.isConfigured()) {
    log.warn("Biquiti market data not configured — the scanner will report provider errors until credentials are set");
  }

  const confluence = new ConfluenceEngine([
    new StructureEngine(),
    new LiquidityEngine(),
    new PriceActionEngine(),
    new IndicatorEngine(),
    new ZoneEngine(),
    new RegimeEngine(),
    new SessionEngine(),
  ]);
  const strategy = new StrongCandleStrategy();
  const setupStore = new SetupStore();
  const experienceMemory = new ExperienceMemory();

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
    {
      ...DEFAULT_AI_ROUTER_CONFIG,
      enabled: cfg.features.aiEnabled,
      maxRetries: cfg.ai.maxRetries,
      retryInitialDelayMs: cfg.ai.retryInitialDelayMs,
      retryMaxDelayMs: cfg.ai.retryMaxDelayMs,
      minConfidence: cfg.ai.minConfidence,
      levelTolerancePts: cfg.ai.levelTolerancePts,
      timeoutMs: cfg.ai.timeoutMs,
      m5TimeoutMs: cfg.ai.m5TimeoutMs,
      m5Model: cfg.ai.m5Model,
      cacheTtlMs: cfg.ai.cacheTtlMs,
    }
  );

  const telegram = new TelegramNotifier(cfg.telegram, log.child("telegram"));
  const repo = buildRepository(cfg, log, bus, telegram);

  const idempotency = new IdempotencyGuard();
  const killSwitch = new KillSwitch(async (state) => {
    log.warn(`kill switch changed to ${state.level}`, { reason: state.reason, by: state.updatedBy });
    await repo.saveKillSwitchState(state).catch((err) => {
      log.error("failed to persist kill switch state", err);
    });
  });

  const riskConfig: RiskConfig = {
    get perTradePct() { return cfg.risk.perTradePct; },
    get minRiskPerTradePct() { return cfg.risk.minRiskPerTradePct; },
    get maxRiskPerTradePct() { return cfg.risk.maxRiskPerTradePct; },
    get dailyLossCapPct() { return cfg.risk.dailyLossCapPct; },
    get weeklyLossCapPct() { return cfg.risk.weeklyLossCapPct; },
    get maxDrawdownPct() { return cfg.risk.maxDrawdownPct; },
    get maxOpenTrades() { return cfg.risk.maxOpenTrades; },
    get netExposureMax() { return cfg.risk.netExposureMax; },
    get marginCeilingPct() { return cfg.risk.marginCeilingPct; },
    get accountEquity() { return cfg.risk.accountEquity; },
    get minStopDistancePts() { return cfg.risk.minStopDistancePts; },
    get maxStopDistancePts() { return cfg.risk.maxStopDistancePts; },
    get maxLot() { return cfg.risk.maxLot; },
  };
  const riskTracker = new RiskStateTracker(cfg.risk.accountEquity);
  riskTracker.attachToBus(bus);

  const riskEnv = (): RiskEnvironment => ({
    equity: riskTracker.currentEquity,
    state: riskTracker.state,
    killSwitch: killSwitch.level,
    mode: cfg.mode,
  });

  const spreadModel = new SpreadSlippageModel(
    cfg.execution.spreadPoints,
    cfg.execution.slippagePoints,
    cfg.execution.latencyMs
  );
  const protection = new SimulatedProtection();
  const positionManager = new SimulatedPositionManager({
    bus,
    repo,
    protection,
    spreadModel,
    cache,
    log: log.child("position-manager"),
  });
  positionManager.attachToBus();

  const marketFilterEngine = new MarketFilterEngine(cfg.marketFilters, spreadModel, null);

  const mt5Config = cfg.mt5 ?? {
    enabled: false,
    bridgeUrl: "",
    accountId: "",
    server: "",
    brokerSymbolXauusd: "XAUUSD",
  };

  const mt5Service = new Mt5Service({
    enabled: mt5Config.enabled,
    broker: "JustMarkets",
    bridgeUrl: mt5Config.bridgeUrl,
    accountId: mt5Config.accountId,
    server: mt5Config.server,
    brokerSymbolXauusd: mt5Config.brokerSymbolXauusd,
  }, log.child("mt5-service"));

  // Broker Adapter & Execution Engine Selection
  let broker: BrokerAdapter;
  if (cfg.execution.venue === "BROKER" || cfg.mode === "AUTO_TRADING") {
    if (mt5Service.isConfigured() && mt5Service.getAdapter()) {
      broker = mt5Service.getAdapter()!;
    } else if (mt5Config.enabled && mt5Config.bridgeUrl) {
      const bridgeClient = new HttpMt5BridgeClient(
        mt5Config.bridgeUrl,
        mt5Config.accountId,
        mt5Config.server,
        log.child("mt5-bridge")
      );
      broker = new JustMarketsMt5Adapter(
        bridgeClient,
        mt5Config.brokerSymbolXauusd,
        log.child("justmarkets-mt5")
      );
    } else {
      broker = new NullBrokerAdapter();
    }
  } else {
    broker = new PaperBrokerAdapter({
      initialBalance: cfg.risk.accountEquity,
      spreadModel,
      instrumentSpec: DEFAULT_XAUUSD_SPEC,
      log: log.child("paper-broker"),
    });
  }

  const executionEngine = new ExecutionEngine({
    broker,
    bus,
    repo,
    killSwitch,
    instrumentSpec: DEFAULT_XAUUSD_SPEC,
    log: log.child("execution-engine"),
  });

  const promotionEngine = new PromotionGateEngine(cfg, repo, killSwitch, broker);

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
    riskTracker,
    spreadModel,
    expiryBars: cfg.strategyExpiryBars,
    marketFilterEngine,
    experienceMemory,
    executionEngine,
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

  const reconciliation = new ReconciliationService(protection);
  const scannerActivityStore = new ScannerActivityStore(repo);
  scannerActivityStore.load().catch(() => {});

  return {
    bus,
    cache,
    scanner,
    pipeline,
    killSwitch,
    riskTracker,
    positionManager,
    protection,
    spreadModel,
    repo,
    setupStore,
    reconciliation,
    idempotency,
    adapter,
    ai,
    telegram,
    marketFilterEngine,
    broker,
    executionEngine,
    promotionEngine,
    scannerActivityStore,
    experienceMemory,
    mt5Service,
    configStore: providedConfigStore ?? new RuntimeConfigStore(cfg),
  };
}

function buildRepository(
  cfg: AppConfig,
  log: Logger,
  bus?: EventBus,
  telegram?: TelegramNotifier
): PersistenceRepository {
  if (!cfg.features.persistenceEnabled) return new InMemoryRepository();
  if (cfg.supabase.url === "" || cfg.supabase.serviceKey === "") {
    log.warn("persistence enabled but Supabase not configured — using in-memory repository");
    return new InMemoryRepository();
  }
  const inner = new SupabaseRepository({ url: cfg.supabase.url, serviceKey: cfg.supabase.serviceKey }, log.child("supabase"));
  return new RetryingRepository(inner, {
    maxRetries: cfg.persistenceMaxRetries,
    initialDelayMs: cfg.persistenceInitialRetryDelayMs,
    maxDelayMs: cfg.persistenceMaxRetryDelayMs,
    alertCooldownMs: cfg.persistenceAlertCooldownMs,
    bus,
    telegram,
    mode: cfg.mode,
    log: log.child("persistence-retry"),
  });
}
