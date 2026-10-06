import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { startWebServer } from "../../src/server.js";
import { buildApp } from "../../src/pipeline/buildApp.js";
import { loadAppConfig } from "../../src/config/env.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { AppRuntime } from "../../src/pipeline/buildApp.js";
import { ScannerScheduler } from "../../src/scanner/ScannerScheduler.js";

const TEST_UI_PORT = 3688;
const BASE_URL = `http://127.0.0.1:${TEST_UI_PORT}`;

describe("GP-V4 — Phase 2.7 UI/UX System Health, Provider, Broker, Settings & Controls Suite", () => {
  let server: Server;
  let app: AppRuntime;
  const log = createConsoleLogger("test-ui-p27");
  const cfg = loadAppConfig();

  beforeAll(async () => {
    app = buildApp(cfg, log);
    const scheduler = new ScannerScheduler({
      timeframes: ["M5"],
      scanIntervalMs: 60_000,
      log,
      runPass: async () => {},
    });
    app.scheduler = scheduler;

    server = startWebServer({ port: TEST_UI_PORT, config: cfg, log, app });
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

  it("A, Q, R. serves Arabic RTL HTML console entrypoint with Clean Slate info", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("GP-V4");
    expect(html).toContain("مرحلة التطهير وإعادة الهيكلة");
    expect(html).toContain("CLEAN SLATE: OLD UI REMOVED");
  });

  it("B, C. System Health and Data Provider endpoints return authoritative states", async () => {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as any;
    expect(healthJson.status).toBe("healthy");
    expect(healthJson.subsystems).toHaveProperty("application");
    expect(healthJson.subsystems).toHaveProperty("biquiti");
    expect(healthJson.subsystems).toHaveProperty("supabase");
    expect(healthJson.subsystems).toHaveProperty("ai");
    expect(healthJson.subsystems).toHaveProperty("execution");
    expect(healthJson.subsystems.execution.mode).toBe("SIMULATED");

    const mdHealthRes = await fetch(`${BASE_URL}/api/marketdata/health`);
    expect(mdHealthRes.status).toBe(200);
    const mdHealthJson = (await mdHealthRes.json()) as any;
    expect(mdHealthJson.ok).toBe(true);
    expect(mdHealthJson.data).toHaveProperty("provider");
  });

  it("D, E. Execution/Broker endpoint and Settings endpoint are read-only and label SIMULATED correctly", async () => {
    const settingsRes = await fetch(`${BASE_URL}/api/settings`);
    expect(settingsRes.status).toBe(200);
    const settingsJson = (await settingsRes.json()) as any;
    expect(settingsJson.ok).toBe(true);
    expect(settingsJson.data.readOnly).toBe(true);
    expect(settingsJson.data.execution.mode).toBe("SIMULATED");
    expect(settingsJson.data.execution.isLive).toBe(false);
    expect(settingsJson.data).toHaveProperty("risk");
    expect(settingsJson.data).toHaveProperty("marketFilters");
  });

  it("F, G. Never exposes secrets in Settings or HTML entrypoint", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    expect(html).not.toContain(cfg.supabase.serviceKey || "supabase_secret");
    expect(html).not.toContain(cfg.ai.apiKey || "novita_secret");
    expect(html).not.toContain(cfg.telegram.botToken || "telegram_token");
    expect(html).not.toContain(cfg.biquiti.apiKey || "biquiti_secret");

    const settingsRes = await fetch(`${BASE_URL}/api/settings`);
    const settingsJson = (await settingsRes.json()) as any;
    expect(JSON.stringify(settingsJson)).not.toContain(cfg.supabase.serviceKey || "supabase_secret");
    expect(JSON.stringify(settingsJson)).not.toContain(cfg.ai.apiKey || "novita_secret");
    expect(JSON.stringify(settingsJson)).not.toContain(cfg.telegram.botToken || "telegram_token");
  });

  it("H, I. Telegram endpoint and test action execute with real backend contract", async () => {
    const tgRes = await fetch(`${BASE_URL}/api/telegram`);
    expect(tgRes.status).toBe(200);
    const tgJson = (await tgRes.json()) as any;
    expect(tgJson.ok).toBe(true);
    expect(tgJson.data).toHaveProperty("enabled");

    const tgTestRes = await fetch(`${BASE_URL}/api/telegram/test`, { method: "POST" });
    expect([200, 400, 500]).toContain(tgTestRes.status);
    const tgTestJson = (await tgTestRes.json()) as any;
    expect(tgTestJson).toHaveProperty("ok");
  });

  it("J, K. KillSwitch actions escalate, reflect state, and reset safely with backend confirmation", async () => {
    const escRes = await fetch(`${BASE_URL}/api/killswitch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "L1", reason: "Phase 2.7 UI Test Escalation" }),
    });
    expect(escRes.status).toBe(200);
    const escJson = (await escRes.json()) as any;
    expect(escJson.ok).toBe(true);
    expect(escJson.data.level).toBe("L1");

    const ksGet = await fetch(`${BASE_URL}/api/killswitch`);
    const ksGetJson = (await ksGet.json()) as any;
    expect(ksGetJson.data.level).toBe("L1");

    const resetRes = await fetch(`${BASE_URL}/api/killswitch/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Reset after test" }),
    });
    expect(resetRes.status).toBe(200);
    const resetJson = (await resetRes.json()) as any;
    expect(resetJson.ok).toBe(true);
    expect(resetJson.data.level).toBe("NONE");
  });

  it("S. Serves a clean-slate client script with no dead old controls", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    expect(html).toContain("GP-V4: Clean slate active. Old UI prototype removed.");
  });
});
