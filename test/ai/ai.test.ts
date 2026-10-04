import { describe, expect, it } from "vitest";
import { NovitaProvider } from "../../src/ai/NovitaProvider.js";
import { AiRouter, DEFAULT_AI_ROUTER_CONFIG, extractJson } from "../../src/ai/AiRouter.js";
import { BudgetGuard } from "../../src/ai/BudgetGuard.js";
import { CircuitBreaker } from "../../src/ai/CircuitBreaker.js";
import { ResponseCache } from "../../src/ai/ResponseCache.js";
import { ContextBuilder } from "../../src/ai/ContextBuilder.js";
import type { AiProvider, AiProviderResult } from "../../src/ai/types.js";
import type { AiUsage } from "../../src/core/types/AiDecision.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import { AppError, ErrorCode } from "../../src/core/logging/Logger.js";
import type { Candle } from "../../src/core/types/Candle.js";
import type { EngineContext } from "../../src/strategies/Engine.js";
import type { ConfluenceResult } from "../../src/strategies/ConfluenceEngine.js";
import type { Setup } from "../../src/core/types/Setup.js";

const TF = 300_000;
function bar(i: number, open: number, high: number, low: number, close: number): Candle {
  const o = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime: o, open, high, low, close, volume: 100, closeTime: o + TF - 1 };
}
const CANDLES = [0, 1, 2, 3, 4, 5].map((i) => bar(i, 2000 + i, 2005 + i, 1995 + i, 2002 + i));
const CTX: EngineContext = { symbol: "XAUUSD", timeframe: "M5", candles: CANDLES };
const CONFLUENCE: ConfluenceResult = {
  score: 1.2,
  direction: "LONG",
  evidence: [{ source: "structure", kind: "hh-hl", detail: "bullish structure", weight: 0.6 }],
  levels: [{ price: 2010, kind: "swing-high", touchedAt: 0 }],
  perEngine: [],
};
const SETUP: Setup = {
  id: "sc:XAUUSD:M5:1500000",
  strategyId: "strong-candle",
  symbol: "XAUUSD",
  timeframe: "M5",
  direction: "LONG",
  barOpenTime: 1_500_000,
  createdAt: 1,
  state: "NEW",
  entry: 2002,
  stopLoss: 1990,
  takeProfit1: 2014,
  takeProfit2: 2026,
  invalidationPrice: 1990,
  rationale: "test",
  evidence: [],
};

function validDecisionJson(): string {
  return JSON.stringify({
    decision: "TRADE_CANDIDATE",
    direction: "LONG",
    setup_id: SETUP.id,
    entry: 2002,
    SL: 1990,
    TP1: 2014,
    TP2: 2026,
    invalidation: 1988,
    confidence: 0.7,
    evidence: [{ source: "structure", detail: "bullish structure" }],
    risk_notes: ["test risk"],
    management_plan: "hold to TP1",
    reassessment_conditions: ["close below SL"],
    reason_codes: ["SC-01"],
  });
}

function fakeProvider(content: string): AiProvider {
  return {
    name: "fake",
    complete: async (): Promise<AiProviderResult> => ({
      content,
      usage: { prompt: 1000, completion: 500 },
      model: "test-model",
    }),
  };
}

function makeRouter(provider: AiProvider, opts: { budgetLog?: AiUsage[]; breaker?: CircuitBreaker; now?: () => number } = {}) {
  const usageLog: AiUsage[] = opts.budgetLog ?? [];
  const breaker = opts.breaker ?? new CircuitBreaker(3, 60_000, opts.now ?? Date.now);
  const budget = {
    allows: (now: number, _log: readonly AiUsage[]) => {
      const g = new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 });
      return g.allows(now, usageLog);
    },
    usage: (now: number, _log: readonly AiUsage[]) => {
      const g = new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 });
      return g.usage(now, usageLog);
    },
  } as unknown as BudgetGuard;
  const router = new AiRouter(
    provider,
    budget,
    breaker,
    new ContextBuilder(),
    createConsoleLogger("test"),
    { ...DEFAULT_AI_ROUTER_CONFIG, cacheTtlMs: 60_000 },
    opts.now ?? (() => 1_000_000)
  );
  return { router, breaker };
}

describe("NovitaProvider", () => {
  const cfg = { baseUrl: "https://api.novita.ai", apiKey: "k", model: "m1", timeoutMs: 1000 };

  it("is not configured without credentials", async () => {
    const p = new NovitaProvider({ ...cfg, apiKey: "" }, createConsoleLogger("test"));
    expect(p.isConfigured()).toBe(false);
    await expect(p.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/not configured/);
  });

  it("parses a valid chat completion response", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          model: "m1",
          choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 }
      )) as typeof fetch;
    const p = new NovitaProvider(cfg, createConsoleLogger("test"), fetchImpl);
    const out = await p.complete({ model: "", messages: [{ role: "user", content: "x" }] });
    expect(out.content).toBe("hello");
    expect(out.usage).toEqual({ prompt: 10, completion: 5 });
  });

  it("surfaces HTTP errors and schema violations as typed errors", async () => {
    const http500 = (async () => new Response("err", { status: 500 })) as typeof fetch;
    const p1 = new NovitaProvider(cfg, createConsoleLogger("test"), http500);
    await expect(p1.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/HTTP 500/);

    const badBody = (async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as typeof fetch;
    const p2 = new NovitaProvider(cfg, createConsoleLogger("test"), badBody);
    await expect(p2.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/expected schema/);
  });
});

describe("BudgetGuard", () => {
  it("blocks when the hourly budget is exhausted", () => {
    const now = 10_000_000;
    const log: AiUsage[] = [{ windowStart: now - 1000, requests: 1, tokensPrompt: 0, tokensCompletion: 0, costUsd: 1 }];
    const guard = new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 });
    expect(guard.allows(now, log)).toBe(false);
  });

  it("allows spend older than the windows", () => {
    const now = 10_000_000;
    const log: AiUsage[] = [{ windowStart: now - 2 * 3_600_000, requests: 1, tokensPrompt: 0, tokensCompletion: 0, costUsd: 50 }];
    const guard = new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 });
    expect(guard.allows(now, log)).toBe(false); // daily still blocks
    const log2: AiUsage[] = [{ windowStart: now - 2 * 86_400_000, requests: 1, tokensPrompt: 0, tokensCompletion: 0, costUsd: 50 }];
    expect(guard.allows(now, log2)).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  it("opens after threshold failures and half-opens after cooldown", () => {
    let t = 0;
    const cb = new CircuitBreaker(2, 1000, () => t);
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    t = 1500;
    expect(cb.status).toBe("HALF_OPEN");
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    cb.recordSuccess();
    expect(cb.status).toBe("CLOSED");
  });
});

describe("ResponseCache", () => {
  it("round-trips within TTL and expires after", () => {
    const c = new ResponseCache(1000);
    c.set("k", { a: 1 }, 0);
    expect(c.get<{ a: number }>("k", 500)).toEqual({ a: 1 });
    expect(c.get<{ a: number }>("k", 1001)).toBeUndefined();
  });

  it("signature is deterministic and distinct", () => {
    expect(ResponseCache.signature("s", "u")).toBe(ResponseCache.signature("s", "u"));
    expect(ResponseCache.signature("s", "u")).not.toBe(ResponseCache.signature("s", "u2"));
  });
});

describe("extractJson", () => {
  it("unwraps fenced and prose-wrapped JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
});

describe("AiRouter", () => {
  it("returns a valid decision from a well-formed provider", async () => {
    const { router } = makeRouter(fakeProvider(validDecisionJson()));
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.decision.decision).toBe("TRADE_CANDIDATE");
      expect(out.cached).toBe(false);
      expect(out.tokens.prompt).toBe(1000);
    }
  });

  it("serves the second identical request from cache", async () => {
    const { router } = makeRouter(fakeProvider(validDecisionJson()));
    await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cached).toBe(true);
  });

  it("degrades to INVALID_OUTPUT when the model returns garbage", async () => {
    const { router } = makeRouter(fakeProvider("not json at all"));
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe("INVALID_OUTPUT");
  });

  it("degrades when the decision schema is violated", async () => {
    const bad = JSON.stringify({ decision: "MAYBE" });
    const { router } = makeRouter(fakeProvider(bad));
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe("INVALID_OUTPUT");
  });

  it("respects an open circuit breaker", async () => {
    let t = 0;
    const breaker = new CircuitBreaker(1, 60_000, () => t);
    breaker.recordFailure();
    const { router } = makeRouter(fakeProvider(validDecisionJson()), { breaker });
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe("CIRCUIT_OPEN");
  });

  it("records failures into the breaker on provider errors", async () => {
    const failing: AiProvider = {
      name: "failing",
      complete: async () => {
        throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "boom");
      },
    };
    const { router, breaker } = makeRouter(failing, { breaker: new CircuitBreaker(2, 60_000, () => 0), now: () => 0 });
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    expect(breaker.status).toBe("OPEN");
  });
});

describe("ContextBuilder", () => {
  it("produces a deterministic prompt containing candle rows and setup", () => {
    const builder = new ContextBuilder();
    const a = builder.buildSetupPrompt(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    const b = builder.buildSetupPrompt(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(a.user).toBe(b.user);
    expect(a.system).toBe(b.system);
    expect(a.user).toContain("MODE: ANALYSIS_ONLY");
    expect(a.user).toContain("CONFLUENCE_SCORE");
    expect(a.system).toContain("NO_TRADE|WATCH|TRADE_CANDIDATE");
  });
});
