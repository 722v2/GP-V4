import { describe, expect, it } from "vitest";
import { AppConfigSchema, VersionedConfig, num, list } from "../../src/config/AppConfig.js";

const validBase = {
  mode: "ANALYSIS_ONLY",
  symbols: ["XAUUSD"],
  timeframes: ["M5", "H1"],
  scanIntervalMs: 60_000,
  biquiti: {
    baseUrl: "",
    apiKey: "",
    candlesPath: "",
    authHeader: "Authorization",
    symbolMap: { XAUUSD: "" },
    timeoutMs: 10_000,
  },
  ai: {
    provider: "novita",
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutMs: 45_000,
    maxRetries: 1,
    hourlyBudgetUsd: 1,
    dailyBudgetUsd: 10,
    cacheTtlMs: 120_000,
  },
  supabase: { url: "", serviceKey: "" },
  telegram: { botToken: "", chatId: "", enabled: false },
  risk: {
    perTradePct: 0.5,
    dailyLossCapPct: 3,
    weeklyLossCapPct: 6,
    maxDrawdownPct: 10,
    maxOpenTrades: 2,
    netExposureMax: 1.5,
    marginCeilingPct: 50,
    accountEquity: 10_000,
  },
  execution: { venue: "SIMULATED", spreadPoints: 0.35, slippagePoints: 0.2, latencyMs: 250 },
  fixturesDir: "./fixtures",
  features: {
    aiEnabled: true,
    persistenceEnabled: true,
    telegramEnabled: false,
    experienceMemoryEnabled: false,
    strongCandleStrategy: true,
    dashboardEnabled: false,
  },
};

describe("AppConfigSchema", () => {
  it("accepts a valid baseline config", () => {
    expect(() => AppConfigSchema.parse(validBase)).not.toThrow();
  });

  it("rejects invalid mode and empty symbols", () => {
    expect(AppConfigSchema.safeParse({ ...validBase, mode: "PARTY" }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...validBase, symbols: [] }).success).toBe(false);
  });
});

describe("VersionedConfig", () => {
  it("loads, applies validated overrides, keeps history, rolls back", () => {
    const cfg = new VersionedConfig(AppConfigSchema, [{ name: "static", load: () => validBase }], () => {});
    const v1 = cfg.load();
    expect(v1.scanIntervalMs).toBe(60_000);
    const v2 = cfg.applyOverrides({ scanIntervalMs: 30_000 }, "test");
    expect(v2.scanIntervalMs).toBe(30_000);
    expect(cfg.getVersion()).toBe(2);
    const v3 = cfg.rollback();
    expect(v3.scanIntervalMs).toBe(60_000);
    expect(cfg.getVersion()).toBe(3);
  });

  it("rejects overrides that would produce an invalid config", () => {
    const cfg = new VersionedConfig(AppConfigSchema, [{ name: "static", load: () => validBase }], () => {});
    cfg.load();
    expect(() => cfg.applyOverrides({ scanIntervalMs: -5 }, "test")).toThrow();
    // state unchanged after rejection
    expect(cfg.get().scanIntervalMs).toBe(60_000);
  });
});

describe("env helpers", () => {
  it("num/list fall back safely", () => {
    expect(num(undefined, 5)).toBe(5);
    expect(num("bad", 5)).toBe(5);
    expect(num("7", 5)).toBe(7);
    expect(list(undefined, ["A"])).toEqual(["A"]);
    expect(list("A, B ,", ["A"])).toEqual(["A", "B"]);
  });
});
