import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  RuntimeConfigStore,
  DEFAULT_RUNTIME_CONFIG,
  InMemoryConfigPersistence,
} from "../../src/config/RuntimeConfigStore.js";
import { loadAppConfig } from "../../src/config/env.js";
import { buildApp } from "../../src/pipeline/buildApp.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";

describe("GP-V4 Phase 1 — Zero-Config & Runtime Configuration Architecture", () => {
  const log = createConsoleLogger("test-p1");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-v4-p1-test-"));
  const isolatedConfigFile = path.join(tempDir, "runtime-config.json");
  let prevConfigPath: string | undefined;

  beforeAll(() => {
    prevConfigPath = process.env.GP_RUNTIME_CONFIG_PATH;
    process.env.GP_RUNTIME_CONFIG_PATH = isolatedConfigFile;
  });

  afterAll(() => {
    if (prevConfigPath !== undefined) {
      process.env.GP_RUNTIME_CONFIG_PATH = prevConfigPath;
    } else {
      delete process.env.GP_RUNTIME_CONFIG_PATH;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. Application boots with zero external environment variables and loads safe defaults", () => {
    // Clear relevant process.env temporarily
    const savedEnv = { ...process.env };
    delete process.env.BIQUITI_API_KEY;
    delete process.env.NOVITA_API_KEY;
    delete process.env.AI_API_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;

    try {
      const cfg = loadAppConfig();
      expect(cfg).toBeDefined();
      expect(cfg.mode).toBe("ANALYSIS_ONLY");
      expect(cfg.symbols).toContain("XAUUSD");
      expect(cfg.risk.accountEquity).toBe(10_000);
      expect(cfg.risk.perTradePct).toBe(0.5);
      expect(cfg.scanIntervalMs).toBe(60_000);
      expect(cfg.strategyExpiryBars).toBe(6);
    } finally {
      process.env = savedEnv;
    }
  });

  it("2, 3, 4, 5. Missing external credentials do not crash application graph startup", () => {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    cfg.biquiti.apiKey = "";
    cfg.ai.apiKey = "";
    cfg.supabase.url = "";
    cfg.supabase.serviceKey = "";
    cfg.telegram.botToken = "";

    expect(() => {
      const app = buildApp(cfg, log);
      expect(app).toBeDefined();
      expect(app.adapter.isConfigured()).toBe(false);
      expect(app.ai).toBeDefined();
      expect(app.telegram.isOn).toBe(false);
      expect(app.broker).toBeDefined();
    }).not.toThrow();
  });

  it("6, 7, 8. RuntimeConfigStore loads safe defaults, saves updates, and reloads persisted state", async () => {
    const memoryPersistence = new InMemoryConfigPersistence();
    const store = new RuntimeConfigStore(undefined, memoryPersistence);

    const initial = await store.init();
    expect(initial.risk.accountEquity).toBe(10_000);
    expect(initial.risk.perTradePct).toBe(0.5);

    // Save an update
    const { config: updated, audit } = await store.update(
      {
        risk: {
          accountEquity: 50_000,
          perTradePct: 1.0,
        },
        scanIntervalMs: 30_000,
      },
      "lead-trader"
    );

    expect(updated.risk.accountEquity).toBe(50_000);
    expect(updated.risk.perTradePct).toBe(1.0);
    expect(updated.scanIntervalMs).toBe(30_000);
    expect(audit.updatedBy).toBe("lead-trader");

    // Initialize another store sharing the same persistence provider to verify load persistence
    const reloadedStore = new RuntimeConfigStore(undefined, memoryPersistence);
    const restored = await reloadedStore.init();

    expect(restored.risk.accountEquity).toBe(50_000);
    expect(restored.risk.perTradePct).toBe(1.0);
    expect(restored.scanIntervalMs).toBe(30_000);
  });

  it("9, 10, 11. Account Capital and Risk changes hot-update Risk Tracker and Risk Engine without restart", async () => {
    const memoryPersistence = new InMemoryConfigPersistence();
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const store = new RuntimeConfigStore(cfg, memoryPersistence);
    const app = buildApp(cfg, log, store);

    expect(app.riskTracker.currentEquity).toBe(10_000);

    // Change Account Capital from 10000 to 75000 and Risk to 1.5%
    await store.update({
      risk: {
        accountEquity: 75_000,
        perTradePct: 1.5,
        maxDrawdownPct: 15.0,
      },
    });
    store.applyToAppRuntime(app);

    // Verify RiskTracker consumed new equity immediately
    expect(app.riskTracker.currentEquity).toBe(75_000);
    expect(store.get().risk.accountEquity).toBe(75_000);
    expect(store.get().risk.perTradePct).toBe(1.5);
    expect(store.get().risk.maxDrawdownPct).toBe(15.0);
  });

  it("12. Scanner interval hot-updates Scheduler without restart", async () => {
    const memoryPersistence = new InMemoryConfigPersistence();
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const store = new RuntimeConfigStore(cfg, memoryPersistence);
    const app = buildApp(cfg, log, store);

    // Mock scheduler attached
    let updatedInterval = 0;
    app.scheduler = {
      updateInterval: (ms: number) => {
        updatedInterval = ms;
      },
    } as any;

    await store.update({ scanIntervalMs: 15_000 });
    store.applyToAppRuntime(app);

    expect(updatedInterval).toBe(15_000);
    expect(store.get().scanIntervalMs).toBe(15_000);
  });

  it("13. Market filter settings reach MarketFilterEngine without restart", async () => {
    const memoryPersistence = new InMemoryConfigPersistence();
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const store = new RuntimeConfigStore(cfg, memoryPersistence);
    const app = buildApp(cfg, log, store);

    await store.update({
      marketFilters: {
        spreadFilterEnabled: true,
        maxSpreadPoints: 2.5,
        sessionFilterEnabled: true,
        allowedSessions: ["LONDON"],
      },
    });
    store.applyToAppRuntime(app);

    const filterCfg = app.marketFilterEngine.getConfig();
    expect(filterCfg.spreadFilterEnabled).toBe(true);
    expect(filterCfg.maxSpreadPoints).toBe(2.5);
    expect(filterCfg.sessionFilterEnabled).toBe(true);
    expect(filterCfg.allowedSessions).toEqual(["LONDON"]);
  });

  it("14. AI non-secret settings reach AiRouter without restart", async () => {
    const memoryPersistence = new InMemoryConfigPersistence();
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const store = new RuntimeConfigStore(cfg, memoryPersistence);
    const app = buildApp(cfg, log, store);

    await store.update({
      features: { aiEnabled: false },
      ai: {
        minConfidence: 0.85,
        timeoutMs: 25_000,
        levelTolerancePts: 2.0,
      },
    });
    store.applyToAppRuntime(app);

    const aiCfg = app.ai.getConfig();
    expect(aiCfg.enabled).toBe(false);
    expect(aiCfg.minConfidence).toBe(0.85);
    expect(aiCfg.timeoutMs).toBe(25_000);
    expect(aiCfg.levelTolerancePts).toBe(2.0);
  });

  it("15. Settings API sanitization strictly NEVER exposes secrets", () => {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    cfg.biquiti.apiKey = "SECRET_BIQUITI_KEY";
    cfg.ai.apiKey = "SECRET_AI_KEY";
    cfg.supabase.serviceKey = "SECRET_SUPABASE_KEY";
    cfg.telegram.botToken = "SECRET_TELEGRAM_TOKEN";

    const store = new RuntimeConfigStore(cfg, new InMemoryConfigPersistence());
    const sanitized = store.getSanitized() as any;

    expect(sanitized.biquiti.apiKey).toBeUndefined();
    expect(sanitized.ai.apiKey).toBeUndefined();
    expect(sanitized.supabase.serviceKey).toBeUndefined();
    expect(sanitized.telegram.botToken).toBeUndefined();

    // Verify boolean flags correctly indicate whether credentials exist without exposing them
    expect(sanitized.biquiti.isConfigured).toBe(false); // BaseUrl is empty
    expect(sanitized.ai.isConfigured).toBe(true);
    expect(sanitized.telegram.isConfigured).toBe(false); // Enabled is false
  });

  it("16, 17. No operational setting requires environment variables; legacy env vars are optional", () => {
    const legacy = loadAppConfig({
      risk: { accountEquity: 25_000 },
      scanIntervalMs: 45_000,
    });

    expect(legacy.risk.accountEquity).toBe(25_000);
    expect(legacy.scanIntervalMs).toBe(45_000);
  });

  it("18, 19. External integrations gracefully report NOT_CONNECTED / DEFERRED when credentials are absent", () => {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const store = new RuntimeConfigStore(cfg, new InMemoryConfigPersistence());
    const sanitized = store.getSanitized() as any;

    expect(sanitized.biquiti.isConfigured).toBe(false);
    expect(sanitized.supabase.isConfigured).toBe(false);
    expect(sanitized.ai.isConfigured).toBe(false);
    expect(sanitized.telegram.isConfigured).toBe(false);
    expect(sanitized.mt5.enabled).toBe(false);
  });
});
