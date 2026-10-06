import { loadAppConfig } from "./config/env.js";
import { createConsoleLogger } from "./core/logging/Logger.js";
import type { Logger } from "./core/logging/Logger.js";
import { buildApp } from "./pipeline/buildApp.js";
import { TradingPipeline } from "./pipeline/TradingPipeline.js";
import { collectClosedBarEvents } from "./pipeline/barEvents.js";
import { ReplayRunner, type ReplayResult } from "./replay/ReplayRunner.js";
import { BacktestRunner, BacktestStore, type BacktestResult } from "./backtest/BacktestRunner.js";
import { SpreadSlippageModel } from "./execution/TradeLifecycle.js";
import { FixtureLoader } from "./marketdata/replay/FixtureLoader.js";
import { runStartupReconciliation, type StartupReconciliationResult } from "./safety/Reconciliation.js";
import { startWebServer } from "./server.js";
import { ScannerScheduler } from "./scanner/ScannerScheduler.js";
import type { Timeframe } from "./core/types/MarketTypes.js";
import type { AppConfig } from "./config/AppConfig.js";
import type { Candle } from "./core/types/Candle.js";

export type ModeDispatchResult =
  | { mode: "LIVE"; stop: () => void; reconciliation?: StartupReconciliationResult }
  | { mode: "REPLAY"; result: ReplayResult }
  | { mode: "BACKTEST"; result: BacktestResult };

export interface RuntimeDeps {
  readonly app?: ReturnType<typeof buildApp>;
  readonly fixtures?: readonly Candle[];
}

/**
 * Dispatches GP-V4 runtime based on the configured mode:
 * - Live modes (ANALYSIS_ONLY, MANUAL_CONFIRMATION, PAPER_TRADING, AUTO_TRADING) start the live scanner loop.
 * - REPLAY runs the ReplayRunner over offline fixtures and does NOT start the live scanner.
 * - BACKTEST runs the BacktestRunner over offline fixtures and does NOT start the live scanner.
 */
export async function dispatchRuntime(
  cfg: AppConfig,
  log: Logger,
  deps: RuntimeDeps = {}
): Promise<ModeDispatchResult> {
  log.info("GP-V4 mode dispatch", { mode: cfg.mode, symbols: cfg.symbols, timeframes: cfg.timeframes });

  switch (cfg.mode) {
    case "REPLAY": {
      log.info("dispatching to ReplayRunner", { fixturesDir: cfg.fixturesDir });
      const { candles } = deps.fixtures
        ? { candles: [...deps.fixtures] }
        : await FixtureLoader.loadFromDir(cfg.fixturesDir, {
            symbols: cfg.symbols,
            timeframes: cfg.timeframes,
          });

      const app = deps.app ?? buildApp(cfg, log);
      const runner = new ReplayRunner(app.pipeline, app.cache, { warmupBars: 5 });
      const result = await runner.run(candles);

      log.info("replay finished", {
        cycles: result.cycles.length,
        candlesProcessed: result.candlesProcessed,
      });
      return { mode: "REPLAY", result };
    }

    case "BACKTEST": {
      log.info("dispatching to BacktestRunner", { fixturesDir: cfg.fixturesDir });
      const { candles } = deps.fixtures
        ? { candles: [...deps.fixtures] }
        : await FixtureLoader.loadFromDir(cfg.fixturesDir, {
            symbols: cfg.symbols,
            timeframes: cfg.timeframes,
          });

      const store = new BacktestStore();
      const spreadModel =
        deps.app?.spreadModel ??
        new SpreadSlippageModel(cfg.execution.spreadPoints, cfg.execution.slippagePoints, cfg.execution.latencyMs);

      const runner = new BacktestRunner(candles, store, spreadModel, cfg.risk, 5);
      const result = await runner.run();

      log.info("backtest finished", {
        cycles: result.cycles.length,
        fills: result.simulatedFills.length,
      });
      return { mode: "BACKTEST", result };
    }

    case "ANALYSIS_ONLY":
    case "MANUAL_CONFIRMATION":
    case "PAPER_TRADING":
    case "AUTO_TRADING": {
      log.info("dispatching to live scanner runtime", { mode: cfg.mode });
      const app = deps.app ?? buildApp(cfg, log);

      // Startup restoration & reconciliation:
      // Restores KillSwitch, open trades, active setups, reconstructs RiskStateTracker,
      // and reconciles against venue protections. If inconsistent, escalates KillSwitch to L2 to block new orders.
      const reconResult = await runStartupReconciliation({
        repo: app.repo,
        killSwitch: app.killSwitch,
        riskTracker: app.riskTracker,
        setupStore: app.setupStore,
        positionManager: app.positionManager,
        protection: app.protection,
        reconciliation: app.reconciliation,
        idempotency: app.idempotency,
        log,
      });

      if (!reconResult.success) {
        log.error("startup reconciliation failed — state is inconsistent; order origination blocked", {
          mismatches: reconResult.remainingMismatches,
          killSwitchLevel: reconResult.killSwitchLevel,
        });
      }

      const runPass = async (): Promise<void> => {
        let setupsFound = 0;
        let signalsGenerated = 0;

        const subSetup = () => { setupsFound++; };
        const subSignal = () => { signalsGenerated++; };

        app.bus.on("setup.created", "scanner-activity-tracker", subSetup);
        app.bus.on("signal.generated", "scanner-activity-tracker", subSignal);

        const startTime = Date.now();
        try {
          const tick = await app.scanner.tick();
          for (const evt of collectClosedBarEvents(tick)) {
            await app.bus.publish({ name: "candle.closed", timestamp: Date.now(), payload: evt });
            await app.pipeline.onBarClosed(evt.symbol, evt.timeframe).catch((err) => {
              log.error("pipeline cycle failed", err);
            });
          }

          const durationMs = Date.now() - startTime;
          await app.scannerActivityStore?.record({
            symbol: cfg.symbols.join(", "),
            timeframe: cfg.timeframes.join(", "),
            durationMs,
            status: tick.errors.length > 0 ? "WARNING" : "SUCCESS",
            candlesFetched: tick.fetched,
            newBars: tick.newBars.length,
            setupsFound,
            signalsGenerated,
            errorCount: tick.errors.length,
            errorMessage: tick.errors.length > 0 ? tick.errors.join("; ") : null,
          });
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          await app.scannerActivityStore?.record({
            symbol: cfg.symbols.join(", "),
            timeframe: cfg.timeframes.join(", "),
            durationMs,
            status: "ERROR",
            candlesFetched: 0,
            newBars: 0,
            setupsFound,
            signalsGenerated,
            errorCount: 1,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          app.bus.off("setup.created", "scanner-activity-tracker");
          app.bus.off("signal.generated", "scanner-activity-tracker");
        }
      };

      const scheduler = new ScannerScheduler({
        timeframes: cfg.timeframes as Timeframe[],
        scanIntervalMs: cfg.scanIntervalMs,
        log: log.child("scanner-scheduler"),
        runPass,
      });

      app.scheduler = scheduler;
      await scheduler.start();

      return { mode: "LIVE", stop: () => scheduler.stop(), reconciliation: reconResult };
    }

    default: {
      const exhaustiveCheck: never = cfg.mode;
      throw new Error(`Unhandled runtime mode: ${exhaustiveCheck}`);
    }
  }
}

/**
 * GP-V4 entrypoint. Loads config, wires the graph, and dispatches to the selected runtime.
 */
async function main(): Promise<void> {
  const log = createConsoleLogger("gp");
  let cfg: AppConfig;
  try {
    cfg = loadAppConfig();
  } catch (err) {
    log.error("failed to load configuration", err);
    process.exitCode = 1;
    return;
  }

  // Instantiate the single authoritative application graph
  const app = buildApp(cfg, log);

  // Load and apply any persisted operational settings from DB
  try {
    const saved = app.repo.getSettings ? await app.repo.getSettings() : null;
    if (saved) {
      log.info("restoring saved runtime settings from database");
      if (saved.risk && typeof saved.risk === "object") {
        Object.assign(cfg.risk, saved.risk);
        app.riskTracker.updateInitialEquity(cfg.risk.accountEquity);
      }
      if (saved.marketFilters && typeof saved.marketFilters === "object") {
        Object.assign(cfg.marketFilters, saved.marketFilters);
      }
      if (typeof saved.strategyExpiryBars === "number") {
        cfg.strategyExpiryBars = saved.strategyExpiryBars;
      }
      if (typeof saved.scanIntervalMs === "number") {
        cfg.scanIntervalMs = saved.scanIntervalMs;
      }
      if (saved.ai && typeof (saved.ai as any).minConfidence === "number") {
        cfg.ai.minConfidence = (saved.ai as any).minConfidence;
      }
    }
  } catch (err: any) {
    log.warn(`failed to restore saved settings on startup, using default env values: ${err.message}`);
  }

  // Start the HTTP server on port 3000 sharing the exact same app runtime
  const server = startWebServer({ config: cfg, log, app });

  try {
    const runtime = await dispatchRuntime(cfg, log, { app });

    const shutdown = (sig: string): void => {
      log.info(`received ${sig}, shutting down`);
      if (runtime.mode === "LIVE") {
        runtime.stop();
      }
      server.close();
      process.exitCode = 0;
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    log.error("runtime execution failed", err);
  }
}

export { main, TradingPipeline };

if (!process.env.VITEST) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
