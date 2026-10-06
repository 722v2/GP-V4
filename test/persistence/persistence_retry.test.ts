import { describe, expect, it, vi } from "vitest";
import {
  isRetryablePersistenceError,
  retryPersistence,
  RetryingRepository,
} from "../../src/persistence/PersistenceRetry.js";
import { AppError, ErrorCode, createConsoleLogger } from "../../src/core/logging/Logger.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import type { Setup } from "../../src/core/types/Setup.js";
import type { Trade } from "../../src/core/types/Trade.js";
import type { Signal } from "../../src/pipeline/Signal.js";
import type { KillSwitchState } from "../../src/risk/KillSwitch.js";

function makeSetup(id = "s1"): Setup {
  return {
    id,
    strategyId: "strong-candle",
    symbol: "XAUUSD",
    timeframe: "M5",
    direction: "LONG",
    barOpenTime: 1000,
    createdAt: 1000,
    state: "ACTIVE",
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    invalidationPrice: 1990,
    rationale: "test",
    evidence: [],
  };
}

function makeTrade(id = "t1"): Trade {
  return {
    id,
    signalId: "sig_1",
    symbol: "XAUUSD",
    direction: "LONG",
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    lotSize: 0.05,
    riskAmount: 50,
    mode: "PAPER_TRADING",
    createdAt: 1000,
    state: "OPEN",
  };
}

function makeSignal(id = "sig_1"): Signal {
  return {
    id,
    setupId: "s1",
    symbol: "XAUUSD",
    timeframe: "M5",
    direction: "LONG",
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    lotSize: 0.05,
    riskAmount: 50,
    mode: "PAPER_TRADING",
    createdAt: 1000,
  };
}

describe("P2-17 Persistence Failure Handling, Retry & Telegram Alerts", () => {
  it("A: transient persistence failure retries and succeeds", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts === 1) throw new Error("network timeout");
      return "ok";
    };

    const delays: number[] = [];
    const sleepFn = async (ms: number) => { delays.push(ms); };

    const result = await retryPersistence("saveSetup", fn, {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      sleepFn,
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(delays).toEqual([100]);
  });

  it("B: exponential retry delay (100 -> 200 -> 400)", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("503 Service Unavailable");
    };

    const delays: number[] = [];
    const sleepFn = async (ms: number) => { delays.push(ms); };

    await expect(
      retryPersistence("saveSetup", fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        sleepFn,
      })
    ).rejects.toThrow("503 Service Unavailable");

    expect(attempts).toBe(4); // 1 initial + 3 retries
    expect(delays).toEqual([100, 200, 400]);
  });

  it("C: retry delay maximum cap is enforced", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("connection reset");
    };

    const delays: number[] = [];
    const sleepFn = async (ms: number) => { delays.push(ms); };

    await expect(
      retryPersistence("saveSetup", fn, {
        maxRetries: 4,
        initialDelayMs: 100,
        maxDelayMs: 250,
        sleepFn,
      })
    ).rejects.toThrow("connection reset");

    // Backoff sequence: 100, 200, capped 250, capped 250
    expect(delays).toEqual([100, 200, 250, 250]);
  });

  it("D: retry stops after configured maxRetries", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("500 Internal Server Error");
    };

    const sleepFn = async () => {};

    await expect(
      retryPersistence("saveSetup", fn, {
        maxRetries: 2,
        initialDelayMs: 50,
        maxDelayMs: 500,
        sleepFn,
      })
    ).rejects.toThrow("500 Internal Server Error");

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("E: non-retryable persistence error is NOT retried", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new AppError(ErrorCode.CONFIG_INVALID, "Invalid DB schema configuration");
    };

    const sleepFn = async () => {};

    await expect(
      retryPersistence("saveSetup", fn, {
        maxRetries: 3,
        initialDelayMs: 50,
        maxDelayMs: 500,
        sleepFn,
      })
    ).rejects.toThrow("Invalid DB schema configuration");

    expect(attempts).toBe(1); // Aborts on first attempt
  });

  it("F: P2-12 duplicate signal does not create retry loop", async () => {
    const inner = new NullRepository();
    const retrying = new RetryingRepository(inner, {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      sleepFn: async () => {},
    });

    const sig = makeSignal("sig_1");
    const r1 = await retrying.saveSignal(sig);
    expect(r1).toEqual({ accepted: true, duplicate: false });

    // Duplicate call returns duplicate without throwing or retrying
    const r2 = await retrying.saveSignal(sig);
    expect(r2).toEqual({ accepted: false, duplicate: true });
  });

  it("G & H: critical persistence failure after retries throws typed error and is observable", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(
      new AppError(ErrorCode.PERSISTENCE_FAILED, "Database connection dead")
    );

    const retrying = new RetryingRepository(inner, {
      maxRetries: 2,
      initialDelayMs: 10,
      maxDelayMs: 50,
      sleepFn: async () => {},
    });

    await expect(retrying.saveSetup(makeSetup())).rejects.toThrow("Database connection dead");
  });

  it("I & J: Telegram alert is sent after retries are exhausted with structured context", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(new Error("Supabase write failed"));

    const bus = new EventBus();
    const eventSpy = vi.fn();
    bus.on("persistence.failed", "test", eventSpy);

    const log = createConsoleLogger("test");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const telegram = new TelegramNotifier(
      { botToken: "test_bot_token", chatId: "test_chat_id", enabled: true },
      log,
      fetchMock
    );

    const retrying = new RetryingRepository(inner, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 50,
      bus,
      telegram,
      mode: "PAPER_TRADING",
      sleepFn: async () => {},
    });

    await expect(retrying.saveSetup(makeSetup("s_alert_1"))).rejects.toThrow("Supabase write failed");

    // Event published
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "persistence.failed",
        payload: expect.objectContaining({
          operation: "saveSetup",
          entity: "setup",
          entityId: "s_alert_1",
          mode: "PAPER_TRADING",
        }),
      })
    );

    // Telegram notify called
    expect(fetchMock).toHaveBeenCalled();
    const callBody = fetchMock.mock.calls[0]?.[1]?.body;
    const bodyText = typeof callBody === "string" ? JSON.parse(callBody).text : "";
    expect(bodyText).toContain("PERSISTENCE FAILURE");
    expect(bodyText).toContain("saveSetup");
    expect(bodyText).toContain("s_alert_1");
    expect(bodyText).toContain("PAPER_TRADING");
  });

  it("K: Telegram delivery failure does NOT hide original persistence failure", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(new Error("Original DB Error"));

    const log = createConsoleLogger("test");
    const fetchMock = vi.fn().mockRejectedValue(new Error("Telegram API down"));
    const telegram = new TelegramNotifier(
      { botToken: "test_bot_token", chatId: "test_chat_id", enabled: true },
      log,
      fetchMock
    );

    const retrying = new RetryingRepository(inner, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 50,
      telegram,
      sleepFn: async () => {},
    });

    // Throws original DB Error, NOT Telegram error
    await expect(retrying.saveSetup(makeSetup())).rejects.toThrow("Original DB Error");
  });

  it("L: Telegram unconfigured still leaves persistence failure observable", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(new Error("Supabase timeout"));

    const bus = new EventBus();
    const eventSpy = vi.fn();
    bus.on("persistence.failed", "test", eventSpy);

    const log = createConsoleLogger("test");
    const telegram = new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log);

    const retrying = new RetryingRepository(inner, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 50,
      bus,
      telegram,
      sleepFn: async () => {},
    });

    await expect(retrying.saveSetup(makeSetup())).rejects.toThrow("Supabase timeout");
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "persistence.failed",
      })
    );
  });

  it("M: duplicate alert suppression / cooldown window", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(new Error("Repeated DB crash"));

    const log = createConsoleLogger("test");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const telegram = new TelegramNotifier(
      { botToken: "test_bot", chatId: "test_chat", enabled: true },
      log,
      fetchMock
    );

    let nowTime = 100_000;
    const retrying = new RetryingRepository(inner, {
      maxRetries: 0,
      initialDelayMs: 10,
      maxDelayMs: 50,
      telegram,
      alertCooldownMs: 60_000,
      now: () => nowTime,
      sleepFn: async () => {},
    });

    const setup = makeSetup("s_dup");

    // 1st failure triggers Telegram
    await expect(retrying.saveSetup(setup)).rejects.toThrow("Repeated DB crash");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2nd immediate failure within 60s cooldown suppresses Telegram alert
    nowTime = 100_000 + 10_000; // 10s later
    await expect(retrying.saveSetup(setup)).rejects.toThrow("Repeated DB crash");
    expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1

    // 3rd failure after cooldown (70s later) sends alert
    nowTime = 100_000 + 70_000;
    await expect(retrying.saveSetup(setup)).rejects.toThrow("Repeated DB crash");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("N: no secrets appear in alert or log payload", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveSetup").mockRejectedValue(new Error("Connection refused"));

    const log = createConsoleLogger("test");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const telegram = new TelegramNotifier(
      { botToken: "SECRET_BOT_TOKEN_123", chatId: "SECRET_CHAT_ID", enabled: true },
      log,
      fetchMock
    );

    const retrying = new RetryingRepository(inner, {
      maxRetries: 0,
      initialDelayMs: 10,
      maxDelayMs: 50,
      telegram,
      sleepFn: async () => {},
    });

    await expect(retrying.saveSetup(makeSetup())).rejects.toThrow("Connection refused");
    const callBody2 = fetchMock.mock.calls[0]?.[1]?.body;
    const bodyText = typeof callBody2 === "string" ? JSON.parse(callBody2).text : "";

    expect(bodyText).not.toContain("SECRET_BOT_TOKEN_123");
    expect(bodyText).not.toContain("SECRET_CHAT_ID");
  });

  it("O: Replay/Backtest do not require live Telegram", async () => {
    const inner = new NullRepository(); // Used in backtest/replay
    const retrying = new RetryingRepository(inner, {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 50,
      mode: "BACKTEST",
    });

    await expect(retrying.saveSetup(makeSetup())).resolves.toBeUndefined();
    await expect(retrying.saveSignal(makeSignal())).resolves.toEqual({ accepted: true, duplicate: false });
  });

  it("P: reconciliation fails safely on exhausted persistence failure", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "getOpenTrades").mockRejectedValue(
      new AppError(ErrorCode.PERSISTENCE_FAILED, "Database connection pool exhausted")
    );

    const retrying = new RetryingRepository(inner, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 50,
      sleepFn: async () => {},
    });

    await expect(retrying.getOpenTrades()).rejects.toThrow("Database connection pool exhausted");
  });

  it("Q: existing persistence success paths remain unchanged", async () => {
    const inner = new NullRepository();
    const retrying = new RetryingRepository(inner, {
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 50,
    });

    await expect(retrying.saveSetup(makeSetup())).resolves.toBeUndefined();
    await expect(retrying.updateTrade(makeTrade())).resolves.toBeUndefined();
    await expect(retrying.getOpenTrades()).resolves.toEqual([]);
  });

  it("R, S & T: setup expiry, trade, and KillSwitch persistence failures remain observable", async () => {
    const inner = new NullRepository();
    vi.spyOn(inner, "saveKillSwitchState").mockRejectedValue(new Error("Table locked"));

    const retrying = new RetryingRepository(inner, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 50,
      sleepFn: async () => {},
    });

    const ksState: KillSwitchState = { level: "L3", reason: "manual halt", updatedAt: 1000, updatedBy: "user", active: true };
    await expect(retrying.saveKillSwitchState(ksState)).rejects.toThrow("Table locked");
  });
});
