import { loadAppConfig } from "./config/env.js";
import { createConsoleLogger } from "./core/logging/Logger.js";
import { buildApp } from "./pipeline/buildApp.js";
import { TradingPipeline } from "./pipeline/TradingPipeline.js";
import { collectClosedBarEvents } from "./pipeline/barEvents.js";

/**
 * GP-V4 entrypoint. Loads config, wires the graph, and runs the scan loop.
 * In ANALYSIS_ONLY (default) the process analyses and reports but never trades.
 */
async function main(): Promise<void> {
  const log = createConsoleLogger("gp");
  let cfg;
  try {
    cfg = loadAppConfig();
  } catch (err) {
    log.error("failed to load configuration", err);
    process.exitCode = 1;
    return;
  }

  log.info("GP-V4 starting", { mode: cfg.mode, symbols: cfg.symbols, timeframes: cfg.timeframes });

  const app = buildApp(cfg, log);

  // Each scan pass publishes candle.closed for every newly appended bar, then
  // runs the trading pipeline for that symbol×timeframe.
  const runPass = async (): Promise<void> => {
    const tick = await app.scanner.tick();
    for (const evt of collectClosedBarEvents(tick)) {
      await app.bus.publish({ name: "candle.closed", timestamp: Date.now(), payload: evt });
      await app.pipeline.onBarClosed(evt.symbol, evt.timeframe).catch((err) => {
        log.error("pipeline cycle failed", err);
      });
    }
  };

  await runPass();
  const timer = setInterval(() => {
    void runPass();
  }, cfg.scanIntervalMs);

  const shutdown = (sig: string): void => {
    log.info(`received ${sig}, shutting down`);
    clearInterval(timer);
    process.exitCode = 0;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export { main, TradingPipeline };

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
