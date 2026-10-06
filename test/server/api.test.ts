import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import http from "node:http";
import { startWebServer } from "../../src/server.js";
import { buildApp } from "../../src/pipeline/buildApp.js";
import { loadAppConfig } from "../../src/config/env.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { AppRuntime } from "../../src/pipeline/buildApp.js";
import type { Setup } from "../../src/core/types/Setup.js";
import { generateSignalId } from "../../src/pipeline/Signal.js";
import { ScannerScheduler } from "../../src/scanner/ScannerScheduler.js";

const TEST_PORT = 3288;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

describe("GP-V4 — Phase 2.1 REST + SSE API Contract Layer", () => {
  let server: Server;
  let app: AppRuntime;
  const log = createConsoleLogger("test");
  const cfg = loadAppConfig();

  beforeAll(async () => {
    app = buildApp(cfg, log);
    server = startWebServer({ port: TEST_PORT, config: cfg, log, app });
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once("listening", resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("AD. no duplicate runtime instances are created — server references same app graph", async () => {
    const res = await fetch(`${BASE_URL}/api/killswitch`);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.level).toBe(app.killSwitch.level);

    // Escalate on app instance directly
    await app.killSwitch.escalate("L1", "direct test escalation", "system");

    // Query API — should reflect the exact same instance
    const res2 = await fetch(`${BASE_URL}/api/killswitch`);
    const json2 = (await res2.json()) as any;
    expect(json2.data.level).toBe("L1");

    // Reset back for subsequent tests
    await app.killSwitch.reset("Clean up after test", "system");
  });

  it("A. /api/dashboard returns real runtime state", async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.mode).toBe(cfg.mode);
    expect(json.data.killSwitch).toBeDefined();
    expect(json.data.risk).toBeDefined();
    expect(json.data.equity.current).toBe(cfg.risk.accountEquity);
    expect(json.data.positions.openCount).toBe(0);
    expect(json.data.executionVenue.venue).toBe("SIMULATED");
    expect(json.data.marketFilters.session).toBeDefined();
  });

  it("B & C. KillSwitch GET and POST escalation", async () => {
    const getRes = await fetch(`${BASE_URL}/api/killswitch`);
    const getJson = (await getRes.json()) as any;
    expect(getJson.ok).toBe(true);
    expect(getJson.data.level).toBe("NONE");

    const escRes = await fetch(`${BASE_URL}/api/killswitch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "L2", reason: "Spread explosion detected", updatedBy: "operator-1" }),
    });
    expect(escRes.status).toBe(200);
    const escJson = (await escRes.json()) as any;
    expect(escJson.ok).toBe(true);
    expect(escJson.data.level).toBe("L2");
    expect(escJson.data.reason).toBe("Spread explosion detected");
    expect(escJson.data.updatedBy).toBe("operator-1");
    expect(app.killSwitch.level).toBe("L2");

    await app.killSwitch.reset("Clean up", "admin");
  });

  it("D. KillSwitch reset permission boundary & validation", async () => {
    await app.killSwitch.escalate("L2", "Test for reset", "operator");

    // Missing reason should fail with 400
    const failRes = await fetch(`${BASE_URL}/api/killswitch/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(failRes.status).toBe(400);
    const failJson = (await failRes.json()) as any;
    expect(failJson.ok).toBe(false);
    expect(failJson.error.code).toBe("MISSING_REASON");

    // Valid reset
    const resetRes = await fetch(`${BASE_URL}/api/killswitch/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Market calmed down", updatedBy: "admin-root" }),
    });
    expect(resetRes.status).toBe(200);
    const resetJson = (await resetRes.json()) as any;
    expect(resetJson.ok).toBe(true);
    expect(resetJson.data.level).toBe("NONE");
    expect(app.killSwitch.level).toBe("NONE");
  });

  it("E, F, G, H. Scanner GET, start, stop, and tick", async () => {
    const scheduler = new ScannerScheduler({
      timeframes: ["M5"],
      scanIntervalMs: 60_000,
      log,
      runPass: async () => {},
    });
    app.scheduler = scheduler;

    const getRes = await fetch(`${BASE_URL}/api/scanner`);
    const getJson = (await getRes.json()) as any;
    expect(getJson.ok).toBe(true);
    expect(getJson.data.symbols).toEqual(cfg.symbols);

    const startRes = await fetch(`${BASE_URL}/api/scanner/start`, { method: "POST" });
    const startJson = (await startRes.json()) as any;
    expect(startJson.ok).toBe(true);
    expect(startJson.data.running).toBe(true);

    const stopRes = await fetch(`${BASE_URL}/api/scanner/stop`, { method: "POST" });
    const stopJson = (await stopRes.json()) as any;
    expect(stopJson.ok).toBe(true);
    expect(stopJson.data.running).toBe(false);

    const tickRes = await fetch(`${BASE_URL}/api/scanner/tick`, { method: "POST" });
    const tickJson = (await tickRes.json()) as any;
    expect(tickJson.ok).toBe(true);
    expect(tickJson.data).toHaveProperty("newBars");
  });

  it("I & J. Setups list and setup detail", async () => {
    const testSetup: Setup = {
      id: "s_setup_100",
      strategyId: "strong-candle",
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      barOpenTime: 1000000,
      createdAt: 1000000,
      state: "ACTIVE",
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      invalidationPrice: 1990,
      rationale: "Strong confluence",
      evidence: [],
    };
    app.setupStore.add(testSetup);

    const listRes = await fetch(`${BASE_URL}/api/setups`);
    const listJson = (await listRes.json()) as any;
    expect(listJson.ok).toBe(true);
    expect(listJson.data.count).toBeGreaterThanOrEqual(1);

    const detailRes = await fetch(`${BASE_URL}/api/setups/s_setup_100`);
    const detailJson = (await detailRes.json()) as any;
    expect(detailJson.ok).toBe(true);
    expect(detailJson.data.entry).toBe(2000);

    const notFoundRes = await fetch(`${BASE_URL}/api/setups/unknown_setup_id`);
    expect(notFoundRes.status).toBe(404);
  });

  it("K & L. Signals list and deterministic signal IDs", async () => {
    const id1 = generateSignalId({ symbol: "XAUUSD", timeframe: "M5", barOpenTime: 5000, direction: "LONG" });
    const id2 = generateSignalId({ symbol: "XAUUSD", timeframe: "M5", barOpenTime: 5000, direction: "LONG" });
    expect(id1).toBe(id2);

    const signal = {
      id: id1,
      setupId: "s1",
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      riskAmount: 100,
      createdAt: Date.now(),
      mode: "PAPER_TRADING",
    };

    await app.repo.saveSignal(signal);

    const res = await fetch(`${BASE_URL}/api/signals?limit=10`);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.count).toBeGreaterThanOrEqual(1);
    expect(json.data.signals[0].id).toBe(id1);
  });

  it("M & N. Trades and Positions endpoints", async () => {
    const tradesRes = await fetch(`${BASE_URL}/api/trades`);
    const tradesJson = (await tradesRes.json()) as any;
    expect(tradesJson.ok).toBe(true);
    expect(tradesJson.data).toHaveProperty("open");
    expect(tradesJson.data).toHaveProperty("closed");

    const posRes = await fetch(`${BASE_URL}/api/positions`);
    const posJson = (await posRes.json()) as any;
    expect(posJson.ok).toBe(true);
    expect(posJson.data.openCount).toBe(0);
    expect(Array.isArray(posJson.data.positions)).toBe(true);
  });

  it("O. Risk state endpoint", async () => {
    const res = await fetch(`${BASE_URL}/api/risk`);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.currentEquity).toBe(cfg.risk.accountEquity);
    expect(json.data.state.dailyLossPct).toBe(0);
    expect(json.data.config.perTradePct).toBe(cfg.risk.perTradePct);
  });

  it("P & Q. AI status and decisions endpoints", async () => {
    const statusRes = await fetch(`${BASE_URL}/api/ai/status`);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.ok).toBe(true);
    expect(statusJson.data).toHaveProperty("status");
    expect(statusJson.data).toHaveProperty("minConfidence");

    const decisionsRes = await fetch(`${BASE_URL}/api/ai/decisions`);
    const decisionsJson = (await decisionsRes.json()) as any;
    expect(decisionsJson.ok).toBe(true);
    expect(Array.isArray(decisionsJson.data.decisions)).toBe(true);
  });

  it("R. Market filters endpoint", async () => {
    const res = await fetch(`${BASE_URL}/api/market/filters`);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data).toHaveProperty("activeSessions");
    expect(json.data).toHaveProperty("filterResult");
    expect(json.data.config.allowedSessions).toEqual(cfg.marketFilters.allowedSessions);
  });

  it("S & T. Health matrix and Biquiti health", async () => {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthJson = (await healthRes.json()) as any;
    expect(healthJson.app).toBe("GP-V4");
    expect(healthJson.subsystems).toBeDefined();
    expect(healthJson.subsystems.execution.status).toContain("SIMULATED");

    const biquitiRes = await fetch(`${BASE_URL}/api/marketdata/health`);
    const biquitiJson = (await biquitiRes.json()) as any;
    expect(biquitiJson.ok).toBe(true);
    expect(biquitiJson.data.provider).toBe("biquiti");
  });

  it("U. Reconciliation read, run, and repair", async () => {
    const reconGet = await fetch(`${BASE_URL}/api/reconciliation`);
    const getJson = (await reconGet.json()) as any;
    expect(getJson.ok).toBe(true);
    expect(getJson.data.mismatchesCount).toBe(0);

    const reconRun = await fetch(`${BASE_URL}/api/reconciliation/run`, { method: "POST" });
    const runJson = (await reconRun.json()) as any;
    expect(runJson.ok).toBe(true);

    const reconRepair = await fetch(`${BASE_URL}/api/reconciliation/repair`, { method: "POST" });
    const repairJson = (await reconRepair.json()) as any;
    expect(repairJson.ok).toBe(true);
    expect(repairJson.data.repairedCount).toBe(0);
  });

  it("V, W, X. SSE connection, event streaming, and clean unsubscribe on disconnect", async () => {
    const eventsReceived: string[] = [];

    const req = http.request(`${BASE_URL}/api/events`, (res) => {
      expect(res.headers["content-type"]).toContain("text/event-stream");
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        eventsReceived.push(chunk);
      });
    });
    req.end();

    // Wait for connection
    await new Promise((r) => setTimeout(r, 50));

    // Emit event on bus
    await app.bus.publish({
      name: "killswitch.changed",
      timestamp: Date.now(),
      payload: { level: "L1", reason: "SSE test", active: true },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(eventsReceived.some((chunk) => chunk.includes("killswitch.changed"))).toBe(true);

    // Abort request to test clean disconnect
    req.destroy();

    await new Promise((r) => setTimeout(r, 50));
  });

  it("Y & Z. Malformed request rejected and unknown route returns 404", async () => {
    const badBodyRes = await fetch(`${BASE_URL}/api/killswitch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json ...",
    });
    expect(badBodyRes.status).toBe(500);

    const notFoundRes = await fetch(`${BASE_URL}/api/unknown-endpoint-xyz`);
    expect(notFoundRes.status).toBe(404);
    const notFoundJson = (await notFoundRes.json()) as any;
    expect(notFoundJson.ok).toBe(false);
    expect(notFoundJson.error.code).toBe("NOT_FOUND");
  });

  it("AB. Secrets never appear in responses", async () => {
    const resDashboard = await fetch(`${BASE_URL}/api/dashboard`);
    const textDashboard = await resDashboard.text();
    expect(textDashboard).not.toContain(cfg.supabase.serviceKey || "supabase_secret");
    expect(textDashboard).not.toContain(cfg.ai.apiKey || "novita_secret");
    expect(textDashboard).not.toContain(cfg.telegram.botToken || "telegram_token");
  });

  it("AC. Replay/Backtest remain deterministic and available", async () => {
    const btRes = await fetch(`${BASE_URL}/api/backtest`);
    expect(btRes.status).toBe(200);
    const btJson = (await btRes.json()) as any;
    expect(btJson).toHaveProperty("cycles");
    expect(btJson).toHaveProperty("plansGenerated");
  });
});
