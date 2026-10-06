import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config/AppConfig.js";
import { calculateR, calculateTradeR, type Trade } from "./core/types/Trade.js";
import { FixtureLoader } from "./marketdata/replay/FixtureLoader.js";
import { BacktestRunner, BacktestStore } from "./backtest/BacktestRunner.js";
import { ReplayRunner } from "./replay/ReplayRunner.js";
import { SpreadSlippageModel, calculatePnl } from "./execution/TradeLifecycle.js";
import { evaluateBreaches } from "./risk/RiskEngine.js";
import type { Logger } from "./core/logging/Logger.js";
import type { AppRuntime } from "./pipeline/buildApp.js";
import { getActiveSessions } from "./filters/SessionFilter.js";
import { EVENT_NAMES, type SystemEvent } from "./core/types/Events.js";
import type { KillSwitchLevel } from "./core/types/Risk.js";
import type { Symbol, Timeframe } from "./core/types/MarketTypes.js";
import { collectClosedBarEvents } from "./pipeline/barEvents.js";

import { renderAppHtml } from "./ui/renderAppHtml.js";
import { RuntimeConfigStore } from "./config/RuntimeConfigStore.js";

export interface ServerOptions {
  port?: number;
  config: AppConfig;
  log: Logger;
  app?: AppRuntime;
}

/** Explicit permissions boundary for API endpoints */
export type PermissionRole = "VIEW" | "OPERATOR" | "ADMIN";

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

function sendSuccess<T>(res: http.ServerResponse, data: T, statusCode = 200): void {
  sendJson(res, statusCode, { ok: true, data });
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown
): void {
  sendJson(res, statusCode, {
    ok: false,
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  });
}

async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          reject(new Error("JSON body must be an object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

export function startWebServer(opts: ServerOptions): http.Server {
  const port = opts.port ?? Number(process.env.DEFAULT_APP_PORT || 3000);
  const { config, log, app } = opts;

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    // Global CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    try {
      // 1. Health Endpoints (GET /health & GET /api/health)
      if ((url.pathname === "/health" || url.pathname === "/api/health") && method === "GET") {
        const isBiquitiConfigured = Boolean(app?.adapter.isConfigured());
        const isSupabaseConfigured = Boolean(config.features.persistenceEnabled && config.supabase.url && config.supabase.serviceKey);
        const isAiConfigured = Boolean(config.features.aiEnabled && config.ai.apiKey);
        const isTelegramConfigured = Boolean(config.features.telegramEnabled && config.telegram.botToken);
        const isKillSwitchActive = app ? app.killSwitch.level !== "NONE" : false;

        const subsystems = {
          application: {
            status: "RUNNING",
            mode: config.mode,
            version: "0.1.0",
            source: "AppRuntime",
            updatedAt: Date.now(),
          },
          biquiti: {
            name: "biquiti",
            status: isBiquitiConfigured ? "READY" : "NOT_CONFIGURED",
            configured: isBiquitiConfigured,
            baseUrl: config.biquiti.baseUrl || "NOT_CONFIGURED",
            detail: isBiquitiConfigured ? "Biquiti adapter configured" : "Missing BIQUITI_BASE_URL / API key",
            lastError: app?.scanner.lastScanStats?.errors ? "Provider reported errors during scan" : null,
            source: "BiquitiAdapter",
            updatedAt: Date.now(),
          },
          supabase: {
            status: config.features.persistenceEnabled ? (isSupabaseConfigured ? "READY" : "NOT_CONFIGURED (IN_MEMORY)") : "DISABLED",
            configured: isSupabaseConfigured,
            mode: config.features.persistenceEnabled ? (isSupabaseConfigured ? "SUPABASE_PERSISTENCE" : "IN_MEMORY") : "DISABLED",
            source: "PersistenceRepository",
            updatedAt: Date.now(),
          },
          ai: {
            status: config.features.aiEnabled ? (isAiConfigured ? "READY" : "NOT_CONFIGURED") : "DISABLED",
            configured: isAiConfigured,
            model: config.ai.model,
            m5Model: config.ai.m5Model,
            usageCount: app?.ai.getUsageLog().length ?? 0,
            source: "AiDecisionRouter",
            updatedAt: Date.now(),
          },
          telegram: {
            status: config.features.telegramEnabled ? (isTelegramConfigured ? "READY" : "NOT_CONFIGURED") : "DISABLED",
            configured: isTelegramConfigured,
            enabled: config.features.telegramEnabled,
            source: "TelegramNotifier",
            updatedAt: Date.now(),
          },
          execution: {
            venue: config.execution.venue,
            status: "READY (SIMULATED)",
            isLive: false,
            mode: "SIMULATED",
            openPositionsCount: app?.positionManager.openCount ?? 0,
            protectionVenue: "SimulatedProtection",
            source: "SimulatedPositionManager",
            updatedAt: Date.now(),
          },
          killSwitch: {
            level: app ? app.killSwitch.level : "NONE",
            active: isKillSwitchActive,
            reason: app?.killSwitch.current.reason || null,
            source: "KillSwitch",
            updatedAt: Date.now(),
          },
          scanner: {
            status: app?.scheduler?.running ? "RUNNING" : (app ? "STOPPED" : "NOT_CONFIGURED"),
            running: Boolean(app?.scheduler?.running),
            stopped: Boolean(app?.scheduler?.stopped),
            scanning: Boolean(app?.scanner.scanning),
            singleFlight: Boolean(app?.scanner.scanning),
            intervalMs: config.scanIntervalMs,
            lastScan: app?.scanner.lastScanStats ?? null,
            source: "ScannerScheduler",
            updatedAt: Date.now(),
          },
          reconciliation: {
            status: "READY",
            source: "ReconciliationService",
            updatedAt: Date.now(),
          },
          sse: {
            status: "READY",
            source: "EventBusBridge",
            updatedAt: Date.now(),
          },
        };

        const overallHealthy = !isKillSwitchActive;

        sendJson(res, 200, {
          status: overallHealthy ? "healthy" : "degraded",
          app: "GP-V4",
          mode: config.mode,
          timestamp: Date.now(),
          subsystems,
        });
        return;
      }

      // 2. Legacy API Status endpoint (GET /api/status)
      if (url.pathname === "/api/status" && method === "GET") {
        sendJson(res, 200, {
          app: "GP-V4",
          version: "0.1.0",
          mode: config.mode,
          symbols: config.symbols,
          timeframes: config.timeframes,
          scanIntervalMs: config.scanIntervalMs,
          features: config.features,
          risk: config.risk,
          p1_1_confluence_independence: "ACTIVE (min 2 independent engines required)",
          p1_2_canonical_r_multiple: "ACTIVE (R = |TP - Entry| / |Entry - SL|)",
        });
        return;
      }

      // 3. Composite Dashboard / State endpoint (GET /api/dashboard or GET /api/state)
      if ((url.pathname === "/api/dashboard" || url.pathname === "/api/state") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }

        const now = Date.now();
        const activeSessions = getActiveSessions(now);

        const data = {
          mode: config.mode,
          timestamp: now,
          killSwitch: app.killSwitch.current,
          risk: app.riskTracker.state,
          equity: {
            current: app.riskTracker.currentEquity,
            peak: app.riskTracker.peakEquity,
            initial: config.risk.accountEquity,
          },
          scanner: {
            running: Boolean(app.scheduler?.running),
            stopped: Boolean(app.scheduler?.stopped),
            scanning: app.scanner.scanning,
            symbols: config.symbols,
            timeframes: config.timeframes,
            scanIntervalMs: config.scanIntervalMs,
          },
          positions: {
            openCount: app.positionManager.openCount,
            openPositions: app.positionManager.openPositions,
          },
          setups: {
            activeCount: app.setupStore.count,
            activeSetups: app.setupStore.all(),
          },
          features: config.features,
          executionVenue: {
            venue: config.execution.venue,
            spreadPoints: app.spreadModel.spread,
            slippagePoints: app.spreadModel.slippage,
            latencyMs: app.spreadModel.latency,
          },
          marketFilters: {
            session: {
              activeSessions,
              allowedSessions: config.marketFilters.allowedSessions,
              enabled: config.marketFilters.sessionFilterEnabled,
            },
            spread: {
              currentSpread: app.spreadModel.spread,
              maxSpread: config.marketFilters.maxSpreadPoints,
              enabled: config.marketFilters.spreadFilterEnabled,
            },
            news: {
              enabled: config.marketFilters.newsFilterEnabled,
              status: config.marketFilters.newsFilterEnabled ? "UNAVAILABLE" : "DISABLED",
              windowMinutes: config.marketFilters.newsWindowMinutes,
            },
          },
        };

        sendSuccess(res, data);
        return;
      }

      // 4. Kill Switch Endpoints
      if ((url.pathname === "/api/killswitch" || url.pathname === "/api/risk/kill-switch" || url.pathname === "/api/risk/killswitch") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        sendSuccess(res, app.killSwitch.current);
        return;
      }

      if ((url.pathname === "/api/killswitch" || url.pathname === "/api/risk/kill-switch" || url.pathname === "/api/risk/killswitch") && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const body = await parseJsonBody(req);
        const level = body.level as string | undefined;
        const reason = typeof body.reason === "string" ? body.reason.trim() : "Operator action via UI";
        const updatedBy = typeof body.updatedBy === "string" ? body.updatedBy.trim() : (typeof body.by === "string" ? body.by.trim() : "operator");

        if (level === "NONE") {
          const state = await app.killSwitch.reset(reason || "Reset via operator UI", updatedBy);
          sendSuccess(res, state);
          return;
        } else if (level === "L1" || level === "L2" || level === "L3") {
          const state = await app.killSwitch.escalate(level, reason || "Escalation via operator UI", updatedBy);
          sendSuccess(res, state);
          return;
        } else {
          sendError(res, 400, "INVALID_KILL_SWITCH_LEVEL", "Level must be one of 'NONE', 'L1', 'L2', 'L3'", requestId);
          return;
        }
      }

      if (url.pathname === "/api/killswitch/escalate" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const body = await parseJsonBody(req);
        const level = body.level as KillSwitchLevel | undefined;
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        const updatedBy = typeof body.updatedBy === "string" ? body.updatedBy.trim() : "operator";

        if (!level || (level !== "L1" && level !== "L2" && level !== "L3")) {
          sendError(res, 400, "INVALID_KILL_SWITCH_LEVEL", "Level must be one of 'L1', 'L2', 'L3'", requestId);
          return;
        }
        if (!reason) {
          sendError(res, 400, "MISSING_REASON", "A non-empty reason is required to escalate KillSwitch", requestId);
          return;
        }

        const state = await app.killSwitch.escalate(level, reason, updatedBy);
        sendSuccess(res, state);
        return;
      }

      if (url.pathname === "/api/killswitch/reset" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const body = await parseJsonBody(req);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        const updatedBy = typeof body.updatedBy === "string" ? body.updatedBy.trim() : "admin";

        if (!reason) {
          sendError(res, 400, "MISSING_REASON", "A non-empty reason is required to reset KillSwitch", requestId);
          return;
        }

        const state = await app.killSwitch.reset(reason, updatedBy);
        sendSuccess(res, state);
        return;
      }

      // 5. Scanner Endpoints
      if ((url.pathname === "/api/scanner" || url.pathname === "/api/scanner/status") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        sendSuccess(res, {
          running: Boolean(app.scheduler?.running),
          stopped: Boolean(app.scheduler?.stopped),
          scanning: app.scanner.scanning,
          singleFlight: app.scanner.scanning,
          symbols: config.symbols,
          timeframes: config.timeframes,
          scanIntervalMs: config.scanIntervalMs,
          lastScan: app.scanner.lastScanStats,
          activeSetupsCount: app.setupStore.count,
          history: app.scannerActivityStore?.getRecent(30) || [],
        });
        return;
      }

      if (url.pathname === "/api/scanner/start" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        if (!app.scheduler) {
          sendError(res, 400, "SCANNER_NOT_AVAILABLE", "Scanner scheduler is not available in the current mode", requestId);
          return;
        }
        await app.scheduler.start();
        sendSuccess(res, { running: app.scheduler.running, stopped: app.scheduler.stopped });
        return;
      }

      if (url.pathname === "/api/scanner/stop" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        if (!app.scheduler) {
          sendError(res, 400, "SCANNER_NOT_AVAILABLE", "Scanner scheduler is not available in the current mode", requestId);
          return;
        }
        app.scheduler.stop();
        sendSuccess(res, { running: app.scheduler.running, stopped: app.scheduler.stopped });
        return;
      }

      if (url.pathname === "/api/scanner/tick" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        let setupsFound = 0;
        let signalsGenerated = 0;
        const subSetup = () => { setupsFound++; };
        const subSignal = () => { signalsGenerated++; };
        app.bus.on("setup.created", "api-tick-tracker", subSetup);
        app.bus.on("signal.generated", "api-tick-tracker", subSignal);

        const startTime = Date.now();
        try {
          const tickResult = await app.scanner.tick();
          for (const evt of collectClosedBarEvents(tickResult)) {
            await app.bus.publish({ name: "candle.closed", timestamp: Date.now(), payload: evt });
            await app.pipeline.onBarClosed(evt.symbol, evt.timeframe).catch(() => {});
          }
          const durationMs = Date.now() - startTime;
          await app.scannerActivityStore?.record({
            symbol: config.symbols.join(", "),
            timeframe: config.timeframes.join(", "),
            durationMs,
            status: tickResult.errors.length > 0 ? "WARNING" : "SUCCESS",
            candlesFetched: tickResult.fetched,
            newBars: tickResult.newBars.length,
            setupsFound,
            signalsGenerated,
            errorCount: tickResult.errors.length,
            errorMessage: tickResult.errors.length > 0 ? tickResult.errors.join("; ") : null,
          });
          sendSuccess(res, tickResult);
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          await app.scannerActivityStore?.record({
            symbol: config.symbols.join(", "),
            timeframe: config.timeframes.join(", "),
            durationMs,
            status: "ERROR",
            candlesFetched: 0,
            newBars: 0,
            setupsFound: 0,
            signalsGenerated: 0,
            errorCount: 1,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          sendError(res, 500, "TICK_FAILED", err.message, requestId);
        } finally {
          app.bus.off("setup.created", "api-tick-tracker");
          app.bus.off("signal.generated", "api-tick-tracker");
        }
        return;
      }

      // 6. Setups Endpoints (GET /api/setups, GET /api/setups/:id)
      if (url.pathname === "/api/setups" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const symbolFilter = url.searchParams.get("symbol");
        const tfFilter = url.searchParams.get("timeframe");
        const stateFilter = url.searchParams.get("state");

        let setups = app.setupStore.all();
        if (symbolFilter) {
          setups = setups.filter((s) => s.symbol === symbolFilter);
        }
        if (tfFilter) {
          setups = setups.filter((s) => s.timeframe === tfFilter);
        }
        if (stateFilter) {
          setups = setups.filter((s) => s.state === stateFilter);
        }

        sendSuccess(res, { count: setups.length, setups });
        return;
      }

      if (url.pathname.startsWith("/api/setups/") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const setupId = decodeURIComponent(url.pathname.slice("/api/setups/".length));
        const setup = app.setupStore.get(setupId);
        if (!setup) {
          sendError(res, 404, "SETUP_NOT_FOUND", `Setup with id '${setupId}' was not found in setup store`, requestId);
          return;
        }
        sendSuccess(res, setup);
        return;
      }

      // 7. Signals Endpoint (GET /api/signals)
      if (url.pathname === "/api/signals" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const limitParam = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 50;
        const symbolFilter = url.searchParams.get("symbol");

        let signals = await app.repo.getSignals(limit);
        if (symbolFilter) {
          signals = signals.filter((s) => s.symbol === symbolFilter);
        }

        sendSuccess(res, { count: signals.length, signals });
        return;
      }

      // 8. Trades & Positions Endpoints (GET /api/trades, GET /api/trades/:id, GET /api/positions)
      if (url.pathname === "/api/trades" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const sinceParam = Number(url.searchParams.get("since"));
        const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : undefined;
        const stateFilter = url.searchParams.get("state");
        const symbolFilter = url.searchParams.get("symbol");

        let open = await app.repo.getOpenTrades();
        let closed = await app.repo.getClosedTrades(since);

        if (symbolFilter) {
          open = open.filter((t) => t.symbol === symbolFilter);
          closed = closed.filter((t) => t.symbol === symbolFilter);
        }
        if (stateFilter) {
          open = open.filter((t) => t.state === stateFilter);
          closed = closed.filter((t) => t.state === stateFilter);
        }

        const mapTrade = (t: Trade) => {
          const r = calculateTradeR(t);
          return {
            ...t,
            rTp1: r.rTp1,
            rTp2: r.rTp2,
          };
        };

        sendSuccess(res, {
          openCount: open.length,
          closedCount: closed.length,
          totalCount: open.length + closed.length,
          open: open.map(mapTrade),
          closed: closed.map(mapTrade),
        });
        return;
      }

      if (url.pathname.startsWith("/api/trades/") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const tradeId = decodeURIComponent(url.pathname.slice("/api/trades/".length));
        const open = await app.repo.getOpenTrades();
        const closed = await app.repo.getClosedTrades();
        const trade = open.find((t) => t.id === tradeId) ?? closed.find((t) => t.id === tradeId);
        if (!trade) {
          sendError(res, 404, "TRADE_NOT_FOUND", `Trade '${tradeId}' not found`, requestId);
          return;
        }
        const r = calculateTradeR(trade);
        sendSuccess(res, { ...trade, rTp1: r.rTp1, rTp2: r.rTp2 });
        return;
      }

      if (url.pathname === "/api/positions" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const protections = app.protection ? await app.protection.list() : [];
        const protectedSet = new Set(protections.map((p) => p.tradeId));

        const rawPositions = app.positionManager.openPositions;
        const positions = rawPositions.map((pos) => {
          const sym = (pos.symbol ?? "XAUUSD") as Symbol;
          const candlesM1 = app.cache.get(sym, "M1");
          const candles = candlesM1.length > 0 ? candlesM1 : app.cache.get(sym, "M5");
          const latestCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
          const currentPrice = latestCandle ? latestCandle.close : null;

          const effectiveLot = pos.state === "TP1_HIT" ? pos.lotSize * 0.5 : pos.lotSize;
          const unrealizedPnl = currentPrice !== null
            ? calculatePnl({ direction: pos.direction, entry: pos.entry, lotSize: effectiveLot }, currentPrice)
            : null;

          const totalPnl = (pos.realizedPnl ?? 0) + (unrealizedPnl ?? 0);
          const rMultiples = calculateTradeR(pos);

          return {
            ...pos,
            currentPrice,
            unrealizedPnl,
            totalPnl,
            effectiveLot,
            exposureLots: effectiveLot,
            exposureUsd: pos.entry * 100 * effectiveLot,
            isProtected: protectedSet.has(pos.planId),
            rTp1: rMultiples.rTp1,
            rTp2: rMultiples.rTp2,
          };
        });

        sendSuccess(res, {
          openCount: positions.length,
          positions,
        });
        return;
      }

      // 9. Risk Endpoint (GET /api/risk)
      if ((url.pathname === "/api/risk" || url.pathname === "/api/risk/state") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const protections = app.protection ? await app.protection.list() : [];
        const breaches = evaluateBreaches(config.risk, app.riskTracker.state);
        sendSuccess(res, {
          state: app.riskTracker.state,
          currentEquity: app.riskTracker.currentEquity,
          peakEquity: app.riskTracker.peakEquity,
          dailyRealizedPnl: app.riskTracker.dailyRealizedPnl,
          weeklyRealizedPnl: app.riskTracker.weeklyRealizedPnl,
          openPositionsCount: app.riskTracker.openPositionsCount,
          config: config.risk,
          breaches,
          killSwitchLevel: app.killSwitch.level,
          protections,
        });
        return;
      }

      // 10. AI Status & Decisions Endpoints (GET /api/ai/status, GET /api/ai/decisions)
      if (url.pathname === "/api/ai/status" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const usageLog = app.ai.getUsageLog();
        const status = !config.features.aiEnabled
          ? "DISABLED"
          : config.ai.apiKey !== ""
          ? "READY"
          : "NOT_CONFIGURED";

        sendSuccess(res, {
          status,
          enabled: config.features.aiEnabled,
          model: config.ai.model,
          m5Model: config.ai.m5Model,
          minConfidence: config.ai.minConfidence,
          usageCount: usageLog.length,
        });
        return;
      }

      if (url.pathname === "/api/ai/decisions" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const limitParam = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
        const setupIdParam = url.searchParams.get("setupId");

        let decisions = app.ai.getDecisionLog();
        if (setupIdParam) {
          decisions = decisions.filter((d) => d.setupId === setupIdParam);
        }
        const sliced = [...decisions].slice(-limit);

        sendSuccess(res, { count: sliced.length, decisions: sliced });
        return;
      }

      if (url.pathname.startsWith("/api/ai/decisions/") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const id = decodeURIComponent(url.pathname.slice("/api/ai/decisions/".length));
        const decision = app.ai.getDecisionLog().find((d) => d.id === id || d.setupId === id);
        if (!decision) {
          sendError(res, 404, "NOT_FOUND", `AI decision '${id}' not found`, requestId);
          return;
        }
        sendSuccess(res, decision);
        return;
      }

      // 11. Market Filters Endpoint (GET /api/market/filters)
      if (url.pathname === "/api/market/filters" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const now = Date.now();
        const activeSessions = getActiveSessions(now);
        const filterResult = await app.marketFilterEngine.evaluate("XAUUSD", now);

        sendSuccess(res, {
          timestamp: now,
          activeSessions,
          filterResult,
          config: config.marketFilters,
        });
        return;
      }

      // 12. Market Data Endpoints (GET /api/marketdata/health, GET /api/marketdata/candles)
      if (url.pathname === "/api/marketdata/health" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const health = await app.adapter.health();
        sendSuccess(res, health);
        return;
      }

      if ((url.pathname === "/api/marketdata/candles" || url.pathname === "/api/market/candles") && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const symbol = (url.searchParams.get("symbol") ?? "XAUUSD") as Symbol;
        const timeframe = (url.searchParams.get("timeframe") ?? "M1") as Timeframe;
        const limitParam = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;

        let candles = app.cache.get(symbol, timeframe).slice(-limit);
        if (candles.length === 0 && config.fixturesDir) {
          try {
            if (!fs.existsSync(config.fixturesDir)) {
              try {
                fs.mkdirSync(config.fixturesDir, { recursive: true });
              } catch {}
            }
            const loaded = await FixtureLoader.loadFromDir(config.fixturesDir);
            if (loaded.candles.length > 0) {
              app.cache.append({ symbol, timeframe, candles: loaded.candles });
              candles = app.cache.get(symbol, timeframe).slice(-limit);
            }
          } catch {}
        }
        sendSuccess(res, { symbol, timeframe, count: candles.length, candles });
        return;
      }

      // 13. Reconciliation Endpoints
      if (url.pathname === "/api/reconciliation" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const openTrades = await app.repo.getOpenTrades();
        const mismatches = await app.reconciliation.reconcile(openTrades, 0.5);
        sendSuccess(res, {
          openTradesCount: openTrades.length,
          mismatchesCount: mismatches.length,
          mismatches,
          killSwitchLevel: app.killSwitch.level,
        });
        return;
      }

      if (url.pathname === "/api/reconciliation/run" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const openTrades = await app.repo.getOpenTrades();
        const mismatches = await app.reconciliation.reconcile(openTrades, 0.5);
        sendSuccess(res, {
          openTradesCount: openTrades.length,
          mismatchesCount: mismatches.length,
          mismatches,
        });
        return;
      }

      if (url.pathname === "/api/reconciliation/repair" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const openTrades = await app.repo.getOpenTrades();
        const repairedCount = await app.reconciliation.repair(openTrades);
        const remainingMismatches = await app.reconciliation.reconcile(openTrades, 0.5);
        sendSuccess(res, {
          repairedCount,
          remainingMismatchesCount: remainingMismatches.length,
          remainingMismatches,
        });
        return;
      }

      // 14. Server-Sent Events (SSE) Event Bridge (GET /api/events)
      if (url.pathname === "/api/events" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        // Send initial connection handshake
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: Date.now() })}\n\n`);

        const subscriberId = `sse-${requestId}`;

        const handler = (evt: SystemEvent<unknown>): void => {
          try {
            res.write(`event: ${evt.name}\ndata: ${JSON.stringify({ event: evt.name, timestamp: evt.timestamp, payload: evt.payload })}\n\n`);
          } catch {
            // Socket closed during write
          }
        };

        // Attach listener across all system events
        for (const eventName of EVENT_NAMES) {
          app.bus.on(eventName, subscriberId, handler);
        }

        // Clean unsubscription on client disconnect
        req.on("close", () => {
          for (const eventName of EVENT_NAMES) {
            app.bus.off(eventName, subscriberId);
          }
        });

        return;
      }

      // 15. API Backtest Runner endpoints (GET /api/backtest, POST /api/backtest/run)
      if (url.pathname === "/api/backtest" || url.pathname === "/api/backtest/run") {
        try {
          if (config.fixturesDir && !fs.existsSync(config.fixturesDir)) {
            try {
              fs.mkdirSync(config.fixturesDir, { recursive: true });
            } catch {}
          }
          const { candles } = await FixtureLoader.loadFromDir(config.fixturesDir, {
            symbols: config.symbols,
            timeframes: config.timeframes,
          });
          const store = new BacktestStore();
          const spreadModel = new SpreadSlippageModel(
            config.execution.spreadPoints,
            config.execution.slippagePoints,
            config.execution.latencyMs
          );
          const runner = new BacktestRunner(candles, store, spreadModel, config.risk, 5);
          const result = await runner.run();

          const plansWithR = store.plans.map((p) => {
            const r = calculateTradeR(p);
            return {
              ...p,
              rTp1: r.rTp1,
              rTp2: r.rTp2,
            };
          });

          sendJson(res, 200, {
            ok: true,
            data: {
              dataset: "fixtures/XAUUSD_M5.json (بيانات اختبارية / Test Fixture)",
              symbol: config.symbols[0] ?? "XAUUSD",
              timeframe: "M5",
              isTestData: true,
              candlesSeen: candles.length,
              cycles: result.cycles.length,
              plansGenerated: store.plans.length,
              simulatedFills: result.simulatedFills.length,
              tradesClosed: store.closed.length,
              metrics: result.metrics,
              plans: plansWithR,
              closedTrades: store.closed,
              timestamp: Date.now(),
            },
            // Legacy top-level fields for backward compatibility
            cycles: result.cycles.length,
            candlesSeen: candles.length,
            plansGenerated: store.plans.length,
            simulatedFills: result.simulatedFills.length,
            plans: plansWithR,
            tradesClosed: store.closed.length,
          });
        } catch (err) {
          sendError(res, 500, "BACKTEST_FAILED", err instanceof Error ? err.message : String(err), requestId);
        }
        return;
      }

      // 16. API Replay Runner endpoints (GET /api/replay, POST /api/replay/run)
      if (url.pathname === "/api/replay" || url.pathname === "/api/replay/run") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        try {
          if (config.fixturesDir && !fs.existsSync(config.fixturesDir)) {
            try {
              fs.mkdirSync(config.fixturesDir, { recursive: true });
            } catch {}
          }
          const { candles } = await FixtureLoader.loadFromDir(config.fixturesDir, {
            symbols: config.symbols,
            timeframes: config.timeframes,
          });
          const replayRunner = new ReplayRunner(app.pipeline, app.cache, { warmupBars: 5 });
          const result = await replayRunner.run(candles);
          sendSuccess(res, {
            dataset: "fixtures/XAUUSD_M5.json (بيانات اختبارية / Test Fixture)",
            symbol: config.symbols[0] ?? "XAUUSD",
            timeframe: "M5",
            isTestData: true,
            candlesProcessed: result.candlesProcessed,
            cyclesCount: result.cycles.length,
            cycles: result.cycles,
            executedCount: result.cycles.filter((c) => c.action.kind === "EXECUTED_SIMULATED").length,
            timestamp: Date.now(),
          });
        } catch (err) {
          sendError(res, 500, "REPLAY_FAILED", err instanceof Error ? err.message : String(err), requestId);
        }
        return;
      }

      // 16. API Canonical R calculation endpoint (GET /api/calc-r)
      if (url.pathname === "/api/calc-r") {
        const entry = Number(url.searchParams.get("entry"));
        const sl = Number(url.searchParams.get("sl"));
        const tp = Number(url.searchParams.get("tp"));
        const r = calculateR(entry, sl, tp);
        sendJson(res, 200, { entry, sl, tp, r });
        return;
      }

      // 17. API Settings Endpoints (GET /api/settings, GET /api/settings/audit, POST/PATCH /api/settings, POST /api/settings/update)
      if (url.pathname === "/api/settings" && method === "GET") {
        if (app?.configStore) {
          sendSuccess(res, app.configStore.getSanitized());
          return;
        }

        const isBiquitiConfigured = Boolean(app?.adapter.isConfigured());
        const isSupabaseConfigured = Boolean(config.features.persistenceEnabled && config.supabase.url && config.supabase.serviceKey);
        const isAiConfigured = Boolean(config.features.aiEnabled && config.ai.apiKey);
        const isTelegramConfigured = Boolean(config.features.telegramEnabled && config.telegram.botToken);

        sendSuccess(res, {
          mode: config.mode,
          symbols: config.symbols,
          timeframes: config.timeframes,
          scanIntervalMs: config.scanIntervalMs,
          strategyExpiryBars: config.strategyExpiryBars,
          features: config.features,
          risk: config.risk,
          execution: {
            ...config.execution,
            mode: "SIMULATED",
            isLive: false,
          },
          marketFilters: config.marketFilters,
          ai: {
            model: config.ai.model,
            m5Model: config.ai.m5Model,
            minConfidence: config.ai.minConfidence,
            timeoutMs: config.ai.timeoutMs,
            m5TimeoutMs: config.ai.m5TimeoutMs,
            levelTolerancePts: config.ai.levelTolerancePts,
            maxRetries: config.ai.maxRetries,
            isConfigured: isAiConfigured,
          },
          biquiti: {
            baseUrl: config.biquiti.baseUrl,
            candlesPath: config.biquiti.candlesPath,
            authHeader: config.biquiti.authHeader,
            timeoutMs: config.biquiti.timeoutMs,
            isConfigured: isBiquitiConfigured,
          },
          supabase: {
            isConfigured: isSupabaseConfigured,
            persistenceEnabled: config.features.persistenceEnabled,
            maxRetries: config.persistenceMaxRetries,
          },
          telegram: {
            enabled: config.features.telegramEnabled,
            chatId: config.telegram.chatId,
            chatIdConfigured: Boolean(config.telegram.chatId),
            isConfigured: isTelegramConfigured,
          },
          mt5: {
            enabled: config.mt5.enabled,
            bridgeUrl: config.mt5.bridgeUrl,
            brokerSymbolXauusd: config.mt5.brokerSymbolXauusd,
            accountId: config.mt5.accountId,
            server: config.mt5.server,
          },
          readOnly: true,
          timestamp: Date.now(),
        });
        return;
      }

      if (url.pathname === "/api/settings/audit" && method === "GET") {
        sendSuccess(res, {
          audit: app?.configStore?.getAuditHistory() || [],
          timestamp: Date.now(),
        });
        return;
      }

      if (
        (url.pathname === "/api/settings" && (method === "POST" || method === "PATCH")) ||
        (url.pathname === "/api/settings/update" && method === "POST")
      ) {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const updatedBy = typeof body.updatedBy === "string" ? body.updatedBy.trim() : "operator";

          if (!app.configStore) {
            app.configStore = new RuntimeConfigStore(config);
          }

          const patch: Record<string, unknown> = { ...body };
          delete patch.updatedBy;

          const { config: updatedConfig, audit } = await app.configStore.update(patch, updatedBy);

          // Hot-update all active runtime dependencies without server restart
          app.configStore.applyToAppRuntime(app);

          // Keep in-memory config object synchronized
          Object.assign(config, updatedConfig);

          sendSuccess(res, {
            ...app.configStore.getSanitized(),
            audit,
            message: "Runtime configuration updated successfully without restart",
            timestamp: Date.now(),
          });
        } catch (err: any) {
          sendError(res, 400, "INVALID_SETTINGS", err.message, requestId);
        }
        return;
      }

      // 18. API Telegram Endpoints (GET /api/telegram, POST /api/telegram/test)
      if (url.pathname === "/api/telegram" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        sendSuccess(res, {
          enabled: config.features.telegramEnabled,
          configured: app.telegram.isOn,
          chatIdConfigured: Boolean(config.telegram.chatId),
          status: config.features.telegramEnabled ? (app.telegram.isOn ? "READY" : "NOT_CONFIGURED") : "DISABLED",
          timestamp: Date.now(),
        });
        return;
      }

      if (url.pathname === "/api/telegram/test" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        if (!config.features.telegramEnabled || !app.telegram.isOn) {
          sendError(
            res,
            400,
            "TELEGRAM_NOT_CONFIGURED",
            "خدمة تيليجرام غير مُهيأة أو معطلة — يجب توفير TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID",
            requestId
          );
          return;
        }
        try {
          const sent = await app.telegram.notify("🔔 GP-V4: رسالة اختبار تشغيلية ناجحة من لوحة التحكم والعمليات.");
          sendSuccess(res, {
            sent,
            detail: sent ? "تم تسليم رسالة الاختبار بنجاح" : "فشل تسليم الرسالة عبر ناقل تيليجرام",
            timestamp: Date.now(),
          });
        } catch (err) {
          sendError(res, 500, "TELEGRAM_SEND_FAILED", err instanceof Error ? err.message : String(err), requestId);
        }
        return;
      }

      // 19. API Broker Status Endpoint (GET /api/broker/status)
      if (url.pathname === "/api/broker/status" && method === "GET") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        try {
          const health = await app.broker.getHealth();
          const account = await app.broker.getAccountInfo();
          const positions = await app.broker.getOpenPositions();
          const orders = await app.broker.getPendingOrders();
          sendSuccess(res, {
            health,
            account,
            positionsCount: positions.length,
            positions,
            pendingOrdersCount: orders.length,
            pendingOrders: orders,
            timestamp: Date.now(),
          });
        } catch (err) {
          sendError(res, 500, "BROKER_STATUS_FAILED", err instanceof Error ? err.message : String(err), requestId);
        }
        return;
      }

      // 20. MT5 Real Broker Account Endpoints
      if ((url.pathname === "/api/mt5" || url.pathname === "/api/mt5/status") && method === "GET") {
        if (!app?.mt5Service) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "MT5 Service is not available", requestId);
          return;
        }
        const status = await app.mt5Service.getSanitizedStatus();
        sendSuccess(res, status);
        return;
      }

      if ((url.pathname === "/api/mt5" || url.pathname === "/api/mt5/config") && method === "POST") {
        if (!app?.mt5Service) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "MT5 Service is not available", requestId);
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const saved = await app.mt5Service.saveAccount(body);
          const newAdapter = app.mt5Service.getAdapter();
          if (newAdapter) {
            app.broker = newAdapter;
          }
          sendSuccess(res, saved);
        } catch (err: any) {
          sendError(res, 400, "MT5_CONFIG_ERROR", err.message || String(err), requestId);
        }
        return;
      }

      if ((url.pathname === "/api/mt5" || url.pathname === "/api/mt5/config") && method === "DELETE") {
        if (!app?.mt5Service) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "MT5 Service is not available", requestId);
          return;
        }
        await app.mt5Service.deleteAccount();
        sendSuccess(res, { deleted: true, status: "NOT_CONFIGURED" });
        return;
      }

      if (url.pathname === "/api/mt5/connect" && method === "POST") {
        if (!app?.mt5Service) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "MT5 Service is not available", requestId);
          return;
        }
        const testRes = await app.mt5Service.testConnection();
        sendSuccess(res, testRes);
        return;
      }

      if (url.pathname === "/api/mt5/disconnect" && method === "POST") {
        if (!app?.mt5Service) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "MT5 Service is not available", requestId);
          return;
        }
        await app.mt5Service.disconnect();
        sendSuccess(res, { disconnected: true, status: "DISCONNECTED" });
        return;
      }

      if (url.pathname === "/api/mt5/reconcile" && method === "POST") {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        const mt5Status = await app.mt5Service?.getSanitizedStatus();
        if (!mt5Status?.isConfigured || mt5Status.status !== "CONNECTED") {
          const openTrades = await app.repo.getOpenTrades();
          sendSuccess(res, {
            reconciled: false,
            status: "BROKER_NOT_CONNECTED",
            detail: mt5Status?.healthDetail || "MT5 Broker is not connected — reconciliation requires active broker connection",
            openTradesCount: openTrades.length,
            mismatchesCount: 0,
            mismatches: [],
            timestamp: Date.now(),
          });
          return;
        }
        const openTrades = await app.repo.getOpenTrades();
        const mismatches = await app.reconciliation.reconcile(openTrades, 0.5);
        sendSuccess(res, {
          reconciled: mismatches.length === 0,
          status: mismatches.length === 0 ? "RECONCILED" : "MISMATCH_DETECTED",
          openTradesCount: openTrades.length,
          mismatchesCount: mismatches.length,
          mismatches,
          timestamp: Date.now(),
        });
        return;
      }

      // 21. API Promotion Gates Endpoints (GET /api/promotion, POST /api/promotion/evaluate)
      if ((url.pathname === "/api/promotion" || url.pathname === "/api/promotion/evaluate") && (method === "GET" || method === "POST")) {
        if (!app) {
          sendError(res, 503, "RUNTIME_UNAVAILABLE", "Application runtime graph is not available", requestId);
          return;
        }
        try {
          const report = await app.promotionEngine.evaluateAll();
          sendSuccess(res, report);
        } catch (err) {
          sendError(res, 500, "PROMOTION_EVAL_FAILED", err instanceof Error ? err.message : String(err), requestId);
        }
        return;
      }

      // 19. Main HTML Operations Console (GET / or GET /index.html)
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderAppHtml(config));
        return;
      }

      // 18. Unknown Route Fallback
      sendError(res, 404, "NOT_FOUND", `Route '${method} ${url.pathname}' not found`, requestId);
    } catch (err) {
      log.error(`API unhandled error: ${url.pathname}`, err);
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        err instanceof Error ? err.message : String(err),
        requestId
      );
    }
  });

  server.listen(port, "0.0.0.0", () => {
    log.info(`GP-V4 web server listening on http://0.0.0.0:${port}`);
  });

  return server;
}
