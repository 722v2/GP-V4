import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "../../src/ai/OpenAiCompatibleProvider.js";
import {
  AiRouter,
  DEFAULT_AI_ROUTER_CONFIG,
  extractJson,
  validateAiDecisionAgainstSetup,
} from "../../src/ai/AiRouter.js";
import { BudgetGuard } from "../../src/ai/BudgetGuard.js";
import { CircuitBreaker } from "../../src/ai/CircuitBreaker.js";
import { ResponseCache } from "../../src/ai/ResponseCache.js";
import { ContextBuilder } from "../../src/ai/ContextBuilder.js";
import { ReplayProvider, ReplayRecorder } from "../../src/ai/ReplayProvider.js";
import type { AiProvider, AiProviderResult, ChatCompletionRequest } from "../../src/ai/types.js";
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

function validDecisionJson(overrides: Record<string, unknown> = {}): string {
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
    ...overrides,
  });
}

function fakeProvider(content: string, onComplete?: (req: ChatCompletionRequest, opts?: any) => void): AiProvider {
  return {
    name: "fake",
    complete: async (req, opts): Promise<AiProviderResult> => {
      if (onComplete) onComplete(req, opts);
      return {
        content,
        usage: { prompt: 1000, completion: 500 },
        model: req.model || "test-model",
      };
    },
  };
}

function makeRouter(
  provider: AiProvider,
  opts: {
    budgetLog?: AiUsage[];
    breaker?: CircuitBreaker;
    now?: () => number;
    sleepFn?: (ms: number) => Promise<void>;
    cfg?: Partial<typeof DEFAULT_AI_ROUTER_CONFIG>;
  } = {}
) {
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
    { ...DEFAULT_AI_ROUTER_CONFIG, cacheTtlMs: 60_000, ...(opts.cfg ?? {}) },
    opts.now ?? (() => 1_000_000),
    opts.sleepFn ?? (async () => {})
  );
  return { router, breaker };
}

describe("L: OpenAiCompatibleProvider (NVIDIA NIM) Configurability", () => {
  const cfg = { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "k", model: "meta/llama-3.2-11b-vision-instruct", timeoutMs: 1000 };

  it("is not configured without credentials", async () => {
    const p = new OpenAiCompatibleProvider({ ...cfg, apiKey: "" }, createConsoleLogger("test"));
    expect(p.isConfigured()).toBe(false);
    await expect(p.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/not configured/);
  });

  it("parses a valid chat completion response and respects model overrides", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          model: capturedBody.model,
          choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const p = new OpenAiCompatibleProvider(cfg, createConsoleLogger("test"), fetchImpl);
    const out = await p.complete({ model: "fast-m5-model", messages: [{ role: "user", content: "x" }] });
    expect(capturedBody.model).toBe("fast-m5-model");
    expect(out.content).toBe("hello");
  });

  it("surfaces HTTP errors and schema violations as typed errors", async () => {
    const http500 = (async () => new Response("err", { status: 500 })) as typeof fetch;
    const p1 = new OpenAiCompatibleProvider(cfg, createConsoleLogger("test"), http500);
    await expect(p1.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/HTTP 500/);

    const badBody = (async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as typeof fetch;
    const p2 = new OpenAiCompatibleProvider(cfg, createConsoleLogger("test"), badBody);
    await expect(p2.complete({ model: "", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/expected schema/);
  });
});

describe("Setup vs AI Validation Helper", () => {
  it("A: setup direction mismatch → invalid", () => {
    const decision = JSON.parse(validDecisionJson({ direction: "SHORT" }));
    const result = validateAiDecisionAgainstSetup(decision, SETUP, 1.0);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("contradicts setup direction");
  });

  it("B: setup level mismatch beyond tolerance → invalid", () => {
    const decision = JSON.parse(validDecisionJson({ entry: 2010 })); // setup entry is 2002
    const result = validateAiDecisionAgainstSetup(decision, SETUP, 1.0);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("differs from setup entry");
  });

  it("C: valid AI decision matching setup → valid", () => {
    const decision = JSON.parse(validDecisionJson());
    const result = validateAiDecisionAgainstSetup(decision, SETUP, 1.0);
    expect(result.valid).toBe(true);
  });
});

describe("AiRouter Hardening Features", () => {
  it("A & B: setup mismatch causes AI router to degrade to INVALID_OUTPUT failure", async () => {
    const badDir = validDecisionJson({ direction: "SHORT" });
    const { router } = makeRouter(fakeProvider(badDir));
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.kind).toBe("INVALID_OUTPUT");
      expect(out.failure.message).toContain("contradicts setup direction");
    }
  });

  it("D: confidence below configured minimum → downgraded to NO_TRADE (not TRADE_CANDIDATE)", async () => {
    const lowConf = validDecisionJson({ confidence: 0.4 });
    const { router } = makeRouter(fakeProvider(lowConf), { cfg: { minConfidence: 0.6 } });
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.decision.decision).toBe("NO_TRADE");
      expect(out.decision.reason_codes).toContain("CONFIDENCE_BELOW_MINIMUM");
    }
  });

  it("E: confidence at or above threshold → allowed as TRADE_CANDIDATE", async () => {
    const goodConf = validDecisionJson({ confidence: 0.7 });
    const { router } = makeRouter(fakeProvider(goodConf), { cfg: { minConfidence: 0.6 } });
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.decision.decision).toBe("TRADE_CANDIDATE");
    }
  });

  it("F & G: provider timeout produces safe TIMEOUT failure and passes timeoutMs", async () => {
    let capturedOpts: any;
    const timeoutProvider: AiProvider = {
      name: "timeout",
      complete: async (_req, opts) => {
        capturedOpts = opts;
        throw new AppError(ErrorCode.AI_TIMEOUT, "Novita request timed out after 15000ms");
      },
    };
    const { router } = makeRouter(timeoutProvider, { cfg: { timeoutMs: 15_000 } });
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.kind).toBe("TIMEOUT");
    }
    expect(capturedOpts.timeoutMs).toBe(15_000);
  });

  it("H & I: exponential retry delay progression and max delay cap", async () => {
    const delays: number[] = [];
    const sleepFn = async (ms: number) => {
      delays.push(ms);
    };

    let attemptsCount = 0;
    const failingProvider: AiProvider = {
      name: "failing",
      complete: async () => {
        attemptsCount += 1;
        throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "temporary 503");
      },
    };

    const { router } = makeRouter(failingProvider, {
      sleepFn,
      cfg: {
        maxRetries: 3, // total 4 attempts
        retryInitialDelayMs: 100,
        retryMaxDelayMs: 300,
      },
    });

    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    expect(attemptsCount).toBe(4);
    // Attempt 1: no sleep.
    // Attempt 2: 100ms
    // Attempt 3: min(100 * 2, 300) = 200ms
    // Attempt 4: min(100 * 4, 300) = 300ms (capped at max delay 300)
    expect(delays).toEqual([100, 200, 300]);
  });

  it("J & K: M5 fast-path overrides model & timeout while applying all safety checks", async () => {
    let capturedReq: ChatCompletionRequest | undefined;
    let capturedOpts: any;

    const badM5 = validDecisionJson({ direction: "SHORT" }); // Direction mismatch on M5
    const provider = fakeProvider(badM5, (req, opts) => {
      capturedReq = req;
      capturedOpts = opts;
    });

    const { router } = makeRouter(provider, {
      cfg: {
        m5Model: "fast-m5-model",
        m5TimeoutMs: 12_000,
      },
    });

    const m5Ctx: EngineContext = { ...CTX, timeframe: "M5" };
    const out = await router.analyze(m5Ctx, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");

    // Fast path configuration was passed to provider
    expect(capturedReq?.model).toBe("fast-m5-model");
    expect(capturedOpts?.timeoutMs).toBe(12_000);

    // Safety checks still rejected direction mismatch on M5
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.kind).toBe("INVALID_OUTPUT");
    }
  });

  it("M: cached incompatible decision cannot bypass setup validation", async () => {
    const validFirst = validDecisionJson();
    const provider = fakeProvider(validFirst);
    const { router } = makeRouter(provider);

    // Request 1 caches the valid decision
    const out1 = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out1.ok).toBe(true);

    // Request 2 with a modified setup (different entry: 2050)
    const modifiedSetup: Setup = { ...SETUP, entry: 2050 };
    const out2 = await router.analyze(CTX, CONFLUENCE, modifiedSetup, 10_000, "ANALYSIS_ONLY");

    // Even if prompt hash matched or cache key was queried, level mismatch rejects or bypasses invalid cache
    if (out2.ok) {
      expect(out2.cached).toBe(false);
    } else {
      expect(out2.failure.kind).toBe("INVALID_OUTPUT");
    }
  });

  it("N: provider and schema failure remains safe", async () => {
    const { router } = makeRouter(fakeProvider("garbage non-json"));
    const out = await router.analyze(CTX, CONFLUENCE, SETUP, 10_000, "ANALYSIS_ONLY");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.kind).toBe("INVALID_OUTPUT");
  });
});

describe("O: ReplayProvider Safety", () => {
  it("ReplayProvider does NOT call live provider when recorded entry exists", async () => {
    const recorder = new ReplayRecorder();
    recorder.record("sig1", {
      ok: true,
      decision: JSON.parse(validDecisionJson()),
      cached: false,
      costUsd: 0,
      tokens: { prompt: 10, completion: 5 },
    });

    const liveSpy = vi.fn();
    const liveProvider: AiProvider = { name: "live", complete: liveSpy };

    const replayProvider = new ReplayProvider(recorder, () => "sig1", liveProvider);
    const result = await replayProvider.complete({ model: "m", messages: [] });

    expect(liveSpy).not.toHaveBeenCalled();
    expect(result.content).toContain("TRADE_CANDIDATE");
  });

  it("ReplayProvider throws error when output is unrecorded and fallback is null", async () => {
    const recorder = new ReplayRecorder();
    const replayProvider = new ReplayProvider(recorder, () => "missing-sig", null);

    await expect(replayProvider.complete({ model: "m", messages: [] })).rejects.toThrow(
      /no recorded output/
    );
  });
});
