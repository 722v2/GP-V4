import { describe, expect, it } from "vitest";
import { PromotionGateEngine } from "../../src/safety/PromotionGates.js";
import { PaperBrokerAdapter } from "../../src/execution/broker/PaperBrokerAdapter.js";
import { NullBrokerAdapter } from "../../src/execution/broker/NullBrokerAdapter.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { InMemoryRepository } from "../../src/persistence/Persistence.js";
import type { AppConfig } from "../../src/config/AppConfig.js";

describe("Promotion Gate Engine & Safety Suite", () => {
  function makeAppConfig(mode = "ANALYSIS_ONLY"): AppConfig {
    return {
      mode: mode as any,
      symbols: ["XAUUSD"],
      timeframes: ["M5"],
      scanIntervalMs: 60000,
      biquiti: { baseUrl: "", apiKey: "", candlesPath: "/v1/candles", authHeader: "Authorization", symbolMap: {}, timeoutMs: 10000 },
      ai: {
        provider: "novita",
        baseUrl: "https://api.novita.ai/v3/openai",
        apiKey: "",
        model: "deepseek/deepseek-r1",
        m5Model: "",
        timeoutMs: 45000,
        m5TimeoutMs: 15000,
        maxRetries: 1,
        retryInitialDelayMs: 500,
        retryMaxDelayMs: 4000,
        minConfidence: 0.6,
        levelTolerancePts: 1.0,
        hourlyBudgetUsd: 1.0,
        dailyBudgetUsd: 10.0,
        cacheTtlMs: 120000,
      },
      supabase: { url: "", serviceKey: "" },
      telegram: { botToken: "", chatId: "", enabled: false },
      risk: {
        perTradePct: 0.5,
        minRiskPerTradePct: 0.01,
        maxRiskPerTradePct: 5.0,
        dailyLossCapPct: 3.0,
        weeklyLossCapPct: 6.0,
        maxDrawdownPct: 10.0,
        maxOpenTrades: 2,
        netExposureMax: 1.5,
        marginCeilingPct: 50.0,
        accountEquity: 10000,
        minStopDistancePts: 1.0,
        maxStopDistancePts: 50.0,
        maxLot: 10.0,
      },
      execution: { venue: "SIMULATED", spreadPoints: 0.35, slippagePoints: 0.2, latencyMs: 250 },
      strategyExpiryBars: 6,
      persistenceMaxRetries: 3,
      persistenceInitialRetryDelayMs: 500,
      persistenceMaxRetryDelayMs: 4000,
      persistenceAlertCooldownMs: 60000,
      marketFilters: { sessionFilterEnabled: false, allowedSessions: ["LONDON", "NEW_YORK"], spreadFilterEnabled: false, maxSpreadPoints: 1.0, newsFilterEnabled: false, newsWindowMinutes: 30 },
      fixturesDir: "./fixtures",
      features: { aiEnabled: true, persistenceEnabled: true, telegramEnabled: false, experienceMemoryEnabled: false, strongCandleStrategy: true, dashboardEnabled: false },
      mt5: {
        enabled: false,
        bridgeUrl: "",
        brokerSymbolXauusd: "XAUUSD",
        accountId: "",
        server: "",
      },
    };
  }

  it("evaluates all 8 promotion gates and keeps AUTO_TRADING blocked when gates are unfulfilled", async () => {
    const config = makeAppConfig("ANALYSIS_ONLY");
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    const broker = new PaperBrokerAdapter();

    const engine = new PromotionGateEngine(config, repo, killSwitch, broker);
    const report = await engine.evaluateAll();

    expect(report.gates).toHaveLength(8);
    expect(report.autoTradingAllowed).toBe(false);
    expect(report.overallState).toBe("PAPER_READY");

    const gate0 = report.gates.find((g) => g.gateId === "GATE_0_CODE_READY");
    expect(gate0?.status).toBe("PASS");

    const gate3 = report.gates.find((g) => g.gateId === "GATE_3_PAPER_VALIDATION");
    expect(gate3?.status).toBe("NOT_READY"); // Insufficient paper trades

    const gate4 = report.gates.find((g) => g.gateId === "GATE_4_HISTORICAL_VALIDATION");
    expect(gate4?.status).toBe("NOT_EXECUTED"); // Real 1-2yr broker data not executed

    const gate5 = report.gates.find((g) => g.gateId === "GATE_5_BROKER_VALIDATED");
    expect(gate5?.status).toBe("BLOCKED"); // Live broker not connected

    const gate7 = report.gates.find((g) => g.gateId === "GATE_7_AUTO_TRADING");
    expect(gate7?.status).toBe("BLOCKED");
  });

  it("blocks GATE 1 ANALYSIS_READY when KillSwitch is escalated", async () => {
    const config = makeAppConfig("ANALYSIS_ONLY");
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    await killSwitch.escalate("L2", "Emergency Lock Test");
    const broker = new PaperBrokerAdapter();

    const engine = new PromotionGateEngine(config, repo, killSwitch, broker);
    const report = await engine.evaluateAll();

    const gate1 = report.gates.find((g) => g.gateId === "GATE_1_ANALYSIS_READY");
    expect(gate1?.status).toBe("BLOCKED");
  });

  it("strictly prohibits AUTO_TRADING when using NullBrokerAdapter", async () => {
    const config = makeAppConfig("AUTO_TRADING");
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    const broker = new NullBrokerAdapter();

    const engine = new PromotionGateEngine(config, repo, killSwitch, broker);
    const report = await engine.evaluateAll();

    expect(report.autoTradingAllowed).toBe(false);
    const gate5 = report.gates.find((g) => g.gateId === "GATE_5_BROKER_VALIDATED");
    expect(gate5?.status).toBe("BLOCKED");
    expect(gate5?.reason).toContain("Live Broker Adapter is NOT connected");
  });
});
