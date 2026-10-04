import { describe, expect, it, vi } from "vitest";
import { NullRepository, serializeAiDecision } from "../../src/persistence/Persistence.js";
import { SupabaseRepository } from "../../src/persistence/SupabaseRepository.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { AiResult } from "../../src/core/types/AiDecision.js";

const log = createConsoleLogger("test");

describe("Persistence boundary", () => {
  it("NullRepository is a silent no-op", async () => {
    const repo = new NullRepository();
    await expect(repo.saveAiDecision("s", { ok: false, failure: { kind: "TIMEOUT", message: "x" } }, "ANALYSIS_ONLY")).resolves.toBeUndefined();
  });

  it("serializes an ok AI result for storage", () => {
    const result: AiResult = {
      ok: true,
      decision: {
        decision: "TRADE_CANDIDATE",
        direction: "LONG",
        confidence: 0.8,
        evidence: [],
        risk_notes: [],
        reassessment_conditions: [],
        reason_codes: [],
      },
      cached: false,
      costUsd: 0.01,
      tokens: { prompt: 1, completion: 2 },
    };
    const row = serializeAiDecision("setup-1", result, "ANALYSIS_ONLY");
    expect(row.setup_id).toBe("setup-1");
    expect(row.decision).toBe("TRADE_CANDIDATE");
    expect(row.ok).toBe(true);
  });

  it("serializes a failed AI result without throwing", () => {
    const result: AiResult = { ok: false, failure: { kind: "PROVIDER_ERROR", message: "boom" } };
    const row = serializeAiDecision("setup-2", result, "AUTO_TRADING");
    expect(row.ok).toBe(false);
    expect(row.decision).toBeNull();
  });

  it("SupabaseRepository reports not configured without credentials", () => {
    const repo = new SupabaseRepository({ url: "", serviceKey: "" }, log);
    expect(repo.isConfigured()).toBe(false);
  });

  it("SupabaseRepository write methods no-op when unconfigured", async () => {
    const repo = new SupabaseRepository({ url: "", serviceKey: "" }, log);
    await expect(
      repo.saveSetup({
        id: "s",
        strategyId: "x",
        symbol: "XAUUSD",
        timeframe: "M5",
        direction: "LONG",
        barOpenTime: 1,
        createdAt: 1,
        state: "NEW",
        entry: 1,
        stopLoss: 0,
        takeProfit1: 2,
        takeProfit2: 3,
        invalidationPrice: 0,
        rationale: "r",
        evidence: [],
      })
    ).resolves.toBeUndefined();
  });
});

describe("TelegramNotifier", () => {
  const base = { botToken: "t", chatId: "c", enabled: true };

  it("is off when disabled or unconfigured", async () => {
    const n = new TelegramNotifier({ ...base, enabled: false }, log);
    expect(n.isOn).toBe(false);
    expect(await n.notify("hi")).toBe(false);
  });

  it("posts to the Telegram API when configured", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: unknown) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const n = new TelegramNotifier(base, log, fetchImpl as unknown as typeof fetch);
    expect(await n.notify("hello")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0] as unknown[];
    expect(String(call[0])).toContain("api.telegram.org/bott/sendMessage");
  });

  it("swallows transport errors and reports false", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const n = new TelegramNotifier(base, log, fetchImpl);
    expect(await n.notify("hello")).toBe(false);
  });

  it("reports false on non-2xx responses", async () => {
    const fetchImpl = (async () => new Response("bad", { status: 400 })) as typeof fetch;
    const n = new TelegramNotifier(base, log, fetchImpl);
    expect(await n.notify("hello")).toBe(false);
  });

  it("formats a decision message", () => {
    const msg = TelegramNotifier.formatDecision("XAUUSD", "LONG", 2000, 1990, 2010, 2020, "ANALYSIS_ONLY");
    expect(msg).toContain("XAUUSD LONG");
    expect(msg).toContain("Entry: 2000");
  });
});
