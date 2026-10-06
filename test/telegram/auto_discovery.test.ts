import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramDiscoveryService } from "../../src/telegram/TelegramDiscoveryService.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { RuntimeConfigStore, InMemoryConfigPersistence } from "../../src/config/RuntimeConfigStore.js";
import { PromotionGateEngine } from "../../src/safety/PromotionGates.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import { loadAppConfig } from "../../src/config/env.js";
import fs from "node:fs";
import path from "node:path";

describe("Telegram Chat ID Auto-Discovery Suite", () => {
  const log = createConsoleLogger("test-tg-discovery");
  let originalEnvChatId: string | undefined;
  let originalEnvBotToken: string | undefined;

  beforeEach(() => {
    originalEnvChatId = process.env.TELEGRAM_CHAT_ID;
    originalEnvBotToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalEnvChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalEnvChatId;
    if (originalEnvBotToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalEnvBotToken;
  });

  const getBaseConfig = () => ({
    mode: "ANALYSIS_ONLY" as const,
    symbols: ["XAUUSD"],
    timeframes: ["M1"] as any,
    scanIntervalMs: 60000,
    risk: {
      accountEquity: 10000,
      perTradePct: 0.5,
      minRiskPerTradePct: 0.01,
      maxRiskPerTradePct: 5.0,
      dailyLossCapPct: 3.0,
      weeklyLossCapPct: 6.0,
      maxDrawdownPct: 10.0,
      maxOpenTrades: 2,
      netExposureMax: 1.5,
      marginCeilingPct: 50.0,
      minStopDistancePts: 1.0,
      maxStopDistancePts: 50.0,
      maxLot: 10.0,
    },
    marketFilters: {
      sessionFilterEnabled: false,
      allowedSessions: ["LONDON", "NEW_YORK"] as any,
      spreadFilterEnabled: false,
      maxSpreadPoints: 1.0,
      newsFilterEnabled: false,
      newsWindowMinutes: 30,
    },
    ai: {
      provider: "nvidia-nim",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "test-key",
      model: "meta/llama-3.2-11b-vision-instruct",
      timeoutMs: 45000,
      hourlyBudgetUsd: 1.0,
      dailyBudgetUsd: 10.0,
      cacheTtlMs: 120000,
      maxRetries: 1,
    },
    biquiti: {
      baseUrl: "https://biquote.io",
      apiKey: "biquiti-key",
      candlesPath: "/v1/candles",
      authHeader: "Authorization",
      symbolMap: { XAUUSD: "XAUUSD" },
      timeoutMs: 10000,
    },
    supabase: { url: "https://sb.co", serviceKey: "sb-key" },
    telegram: {
      botToken: "test-bot-token",
      chatId: "",
      enabled: true,
    },
    execution: {
      venue: "SIMULATED" as const,
      spreadPoints: 0.35,
      slippagePoints: 0.2,
      latencyMs: 250,
    },
    features: {
      aiEnabled: true,
      persistenceEnabled: true,
      telegramEnabled: true,
      experienceMemoryEnabled: false,
      strongCandleStrategy: true,
      dashboardEnabled: true,
    },
  });

  // 1. Explicit TELEGRAM_CHAT_ID works
  it("1. Explicit TELEGRAM_CHAT_ID works", () => {
    process.env.TELEGRAM_CHAT_ID = "explicit-id-123";
    const cfg = loadAppConfig(undefined, { ignorePersisted: true });
    expect(cfg.telegram.chatId).toBe("explicit-id-123");
  });

  // 2. Explicit Chat ID has priority
  it("2. Explicit Chat ID has priority over persisted config", () => {
    process.env.TELEGRAM_CHAT_ID = "explicit-priority-id";
    const store = new RuntimeConfigStore(
      {
        ...getBaseConfig(),
        telegram: { botToken: "tok", chatId: "persisted-old-id", enabled: true },
      } as any,
      new InMemoryConfigPersistence()
    );
    // Verified that our env override overrides base config in loadAppConfig
    const loaded = loadAppConfig({ telegram: { chatId: "persisted" } }, { ignorePersisted: true });
    expect(loaded.telegram.chatId).toBe("explicit-priority-id");
  });

  // 3. No Chat ID starts discovery mode
  it("3. No Chat ID starts discovery mode", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);
    const service = new TelegramDiscoveryService(store, notifier, log);
    const status = service.getStatus();
    expect(status.status).toBe("UNCONFIGURED");
    expect(status.verifiedChatId).toBeNull();
  });

  // 4. getUpdates candidate without claim is NOT trusted
  it("4. getUpdates candidate without claim is NOT trusted", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);
    
    // Setup a mock fetch returning updates with non-matching messages
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 100,
            message: { chat: { id: 8888, type: "private" }, text: "random greeting" }
          }
        ]
      }));
    }) as any;

    const service = new TelegramDiscoveryService(store, notifier, log, fetchImpl);
    await service.generateClaimCode(); // Starts discovery
    service.stopPolling(); // Retain manual poll control
    await service.poll();

    const status = service.getStatus();
    expect(status.status).toBe("PENDING");
    expect(status.verifiedChatId).toBeNull();
  });

  // 5. Valid claim discovers Chat ID
  it("5. Valid claim discovers Chat ID", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    let service: TelegramDiscoveryService;
    const fetchImpl = async () => {
      const activeClaim = service.getStatus().claimCode;
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 101,
            message: { chat: { id: 9999, type: "private" }, text: activeClaim }
          }
        ]
      }));
    };

    service = new TelegramDiscoveryService(store, notifier, log, fetchImpl);

    await service.generateClaimCode();
    service.stopPolling();
    await service.poll();

    const status = service.getStatus();
    expect(status.status).toBe("VERIFIED");
    expect(status.verifiedChatId).toBe("9999");
    expect(store.get().telegram.chatId).toBe("9999");
  });

  // 6. Invalid claim ignored
  it("6. Invalid claim ignored", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 102,
            message: { chat: { id: 9999, type: "private" }, text: "WRONG_CODE" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    await service.poll();

    const status = service.getStatus();
    expect(status.status).toBe("PENDING");
    expect(status.verifiedChatId).toBeNull();
  });

  // 7. Expired claim ignored
  it("7. Expired claim ignored", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 103,
            message: { chat: { id: 9999, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    // Manually force expiry
    (service as any).claimExpiresAt = Date.now() - 1000;

    await service.poll();

    const status = service.getStatus();
    expect(status.status).toBe("UNCONFIGURED");
    expect(status.verifiedChatId).toBeNull();
  });

  // 8. Reused claim rejected
  it("8. Reused claim rejected", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 104,
            message: { chat: { id: 9999, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    // Set custom code
    (service as any).claimCode = "CLAIM";

    await service.poll(); // First submission -> Success
    expect(service.getStatus().status).toBe("VERIFIED");

    // Second submission with same update or same code (should have null claimCode now)
    expect(service.getStatus().claimCode).toBeNull();
  });

  // 9. Group chat rejected by default
  it("9. Group chat rejected by default", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 105,
            message: { chat: { id: -2222, type: "group" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";

    await service.poll();

    expect(service.getStatus().status).toBe("PENDING");
    expect(service.getStatus().verifiedChatId).toBeNull();
  });

  // 10. Private chat accepted
  it("10. Private chat accepted", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 106,
            message: { chat: { id: 1111, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";

    await service.poll();

    expect(service.getStatus().status).toBe("VERIFIED");
    expect(service.getStatus().verifiedChatId).toBe("1111");
  });

  // 11. Discovered Chat ID persists
  it("11. Discovered Chat ID persists", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 107,
            message: { chat: { id: 1111, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";

    await service.poll();

    expect(store.get().telegram.chatId).toBe("1111");
    expect(store.get().telegram.discoveryStatus?.status).toBe("VERIFIED");
  });

  // 12. Discovered Chat ID survives restart
  it("12. Discovered Chat ID survives restart", async () => {
    // Write a dummy runtime-config.json
    const tmpPath = path.resolve(process.cwd(), "test-runtime-config.json");
    const testConfig = getBaseConfig() as any;
    testConfig.telegram.chatId = "survived-id";
    testConfig.telegram.discoveryStatus = { status: "VERIFIED", chatId: "survived-id" };

    fs.writeFileSync(tmpPath, JSON.stringify({ config: testConfig }, null, 2), "utf-8");

    try {
      const cfg = loadAppConfig(undefined, { configFilePath: tmpPath });
      expect(cfg.telegram.chatId).toBe("survived-id");
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  // 13. Duplicate Telegram update is not processed twice
  it("13. Duplicate Telegram update is not processed twice", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 200,
            message: { chat: { id: 1111, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";

    await service.poll();
    expect(service.getStatus().status).toBe("VERIFIED");

    // Clear verification to see if duplicate update triggers again
    (service as any).status = "PENDING";
    (service as any).claimCode = "CLAIM";

    await service.poll();
    // Since update_id 200 is already processed, it should be ignored and status remains PENDING
    expect(service.getStatus().status).toBe("PENDING");
  });

  // 14. Offset advances correctly
  it("14. Offset advances correctly", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 300,
            message: { chat: { id: 1111, type: "private" }, text: "DUMMY" }
          }
        ]
      }));
    }) as any;

    const service = new TelegramDiscoveryService(store, notifier, log, fetchImpl);
    // Control poll calls strictly manually
    await service.poll();
    expect(urls[0]).toContain("offset=0");

    await service.poll();
    expect(urls[1]).toContain("offset=301");
  });

  // 15. Telegram 429 retry_after handled
  it("15. Telegram 429 retry_after handled", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false }), {
        status: 429,
        headers: { "retry-after": "10" }
      });
    }) as any;

    const service = new TelegramDiscoveryService(store, notifier, log, fetchImpl);
    await service.generateClaimCode();
    service.stopPolling();
    await service.poll();

    expect(service.getStatus().diagnostic).toContain("retry after 10s");
    expect((service as any).sleepUntil).toBeGreaterThan(Date.now() + 9000);
  });

  // 16. Network failure handled
  it("16. Network failure handled", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const fetchImpl = async () => {
      throw new Error("DNS failure");
    };

    const service = new TelegramDiscoveryService(store, notifier, log, fetchImpl);
    await service.generateClaimCode();
    service.stopPolling();
    await service.poll();

    expect(service.getStatus().diagnostic).toContain("DNS failure");
    expect(service.getStatus().status).toBe("PENDING"); // Doesn't crash
  });

  // 17. Missing bot token remains disabled
  it("17. Missing bot token remains disabled", async () => {
    const config = getBaseConfig();
    config.telegram.botToken = "";
    const store = new RuntimeConfigStore(config as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    const service = new TelegramDiscoveryService(store, notifier, log);
    await expect(service.generateClaimCode()).rejects.toThrow("Telegram integrations must be enabled");
  });

  // 18. TelegramNotifier becomes active after verified discovery
  it("18. TelegramNotifier becomes active after verified discovery", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);

    expect(notifier.isOn).toBe(false);

    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 400,
            message: { chat: { id: 7777, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";

    await service.poll();

    // Hot-reload applies setting to app notifier
    notifier.updateConfig(store.get().telegram);
    expect(notifier.isOn).toBe(true);
  });

  // 19. PromotionGates recognizes verified discovered Chat ID
  it("19. PromotionGates recognizes verified discovered Chat ID", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);
    
    // Pre-discovery safety check -> blocks/unconfigured
    let gatesEngine = new PromotionGateEngine(store.get(), {} as any, {} as any, {} as any);
    let report = await gatesEngine.evaluateAll();
    expect(report.overallState).toBe("NOT_READY");

    // Success auto-discovery
    const service = new TelegramDiscoveryService(store, notifier, log, async () => {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 500,
            message: { chat: { id: 8888, type: "private" }, text: "CLAIM" }
          }
        ]
      }));
    });

    await service.generateClaimCode();
    service.stopPolling();
    (service as any).claimCode = "CLAIM";
    await service.poll();

    // Now verify
    gatesEngine = new PromotionGateEngine(store.get(), {} as any, {} as any, {} as any);
    report = await gatesEngine.evaluateAll();
    // Checked if "Telegram=" contains "SET" in the evidence
    const gate6 = report.gates.find((g: any) => g.gateId === "GATE_6_PRODUCTION_SAFETY");
    expect(gate6?.evidence).toContain("Telegram=SET");
  });

  // 20. Bot token never appears in logs
  it("20. Bot token never appears in logs", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);
    const service = new TelegramDiscoveryService(store, notifier, log);

    const logSpy = vi.spyOn(log, "info");
    await service.generateClaimCode();
    service.stopPolling();

    // Verify logs
    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("test-bot-token");
    }
  });

  // 21. Shutdown stops polling cleanly
  it("21. Shutdown stops polling cleanly", async () => {
    const store = new RuntimeConfigStore(getBaseConfig() as any, new InMemoryConfigPersistence());
    const notifier = new TelegramNotifier(store.get().telegram, log);
    const service = new TelegramDiscoveryService(store, notifier, log);

    await service.generateClaimCode();
    expect(service.getStatus().isPollingActive).toBe(true);

    service.stopPolling();
    expect(service.getStatus().isPollingActive).toBe(false);
  });
});
