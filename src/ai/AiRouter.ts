import type { AiDecision, AiFailure, AiResult, AiUsage } from "../core/types/AiDecision.js";
import { AiDecisionSchema } from "../core/types/AiDecision.js";
import type { Logger } from "../core/logging/Logger.js";
import { AppError, ErrorCode } from "../core/logging/Logger.js";
import type { AiProvider } from "./types.js";
import { BudgetGuard } from "./BudgetGuard.js";
import { CircuitBreaker } from "./CircuitBreaker.js";
import { ResponseCache } from "./ResponseCache.js";
import { ContextBuilder } from "./ContextBuilder.js";
import type { ConfluenceResult } from "../strategies/ConfluenceEngine.js";
import type { Setup } from "../core/types/Setup.js";
import type { EngineContext } from "../strategies/Engine.js";

export interface AiRouterConfig {
  enabled: boolean;
  maxRetries: number;
  cacheTtlMs: number;
  /** USD per 1M tokens, used to estimate cost from usage. */
  pricePerMTokensPrompt: number;
  pricePerMTokensCompletion: number;
}

export const DEFAULT_AI_ROUTER_CONFIG: AiRouterConfig = {
  enabled: true,
  maxRetries: 1,
  cacheTtlMs: 120_000,
  pricePerMTokensPrompt: 0.4,
  pricePerMTokensCompletion: 0.4,
};

/**
 * AI router: budget check → circuit breaker → cache → provider call with retries
 * → schema validation. ALWAYS returns an AiResult; failures are degraded to
 * `{ ok:false, failure }` so AI never blocks the trading pipeline.
 */
export class AiRouter {
  private readonly cache: ResponseCache;
  private readonly usageLog: AiUsage[] = [];

  constructor(
    private readonly provider: AiProvider,
    private readonly budget: BudgetGuard,
    private readonly breaker: CircuitBreaker,
    private readonly contextBuilder: ContextBuilder,
    private readonly log: Logger,
    private readonly cfg: AiRouterConfig = DEFAULT_AI_ROUTER_CONFIG,
    private readonly now: () => number = Date.now
  ) {
    this.cache = new ResponseCache(cfg.cacheTtlMs);
  }

  getUsageLog(): readonly AiUsage[] {
    return this.usageLog;
  }

  async analyze(
    ctx: EngineContext,
    confluence: ConfluenceResult,
    setup: Setup,
    accountEquity: number,
    mode: string
  ): Promise<AiResult> {
    if (!this.cfg.enabled) {
      return fail({ kind: "PROVIDER_ERROR", message: "AI disabled by config" });
    }
    const now = this.now();
    if (!this.budget.allows(now, this.usageLog)) {
      return fail({ kind: "BUDGET_EXCEEDED", message: "AI spend budget exhausted for the current hour/day" });
    }
    if (!this.breaker.canRequest()) {
      return fail({ kind: "CIRCUIT_OPEN", message: "AI circuit breaker is open after repeated failures" });
    }

    const { system, user } = this.contextBuilder.buildSetupPrompt(ctx, confluence, setup, accountEquity, mode);
    const key = ResponseCache.signature(system, user);
    const cached = this.cache.get<{ decision: AiDecision; usage: { prompt: number; completion: number }; model: string }>(key, now);
    if (cached) {
      return { ok: true, decision: cached.decision, cached: true, costUsd: 0, tokens: cached.usage };
    }

    let lastFailure: AiFailure = { kind: "PROVIDER_ERROR", message: "no attempt made" };
    const attempts = this.cfg.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await this.provider.complete({
          model: "",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        });
        const decision = this.parseDecision(result.content);
        this.breaker.recordSuccess();
        const costUsd = this.estimateCost(result.usage);
        this.usageLog.push({
          windowStart: now,
          requests: 1,
          tokensPrompt: result.usage.prompt,
          tokensCompletion: result.usage.completion,
          costUsd,
        });
        this.cache.set(key, { decision, usage: result.usage, model: result.model }, now);
        this.log.info("ai decision", { decision: decision.decision, confidence: decision.confidence, cached: false });
        return { ok: true, decision, cached: false, costUsd, tokens: result.usage };
      } catch (err) {
        lastFailure = toFailure(err, attempt);
        this.breaker.recordFailure();
        this.log.warn(`ai attempt ${attempt}/${attempts} failed`, { kind: lastFailure.kind });
      }
    }
    return fail(lastFailure);
  }

  private parseDecision(content: string): AiDecision {
    let json: unknown;
    try {
      json = JSON.parse(extractJson(content));
    } catch {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "AI response was not valid JSON");
    }
    const parsed = AiDecisionSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "AI decision failed schema validation", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return parsed.data;
  }

  private estimateCost(usage: { prompt: number; completion: number }): number {
    return (usage.prompt / 1_000_000) * this.cfg.pricePerMTokensPrompt + (usage.completion / 1_000_000) * this.cfg.pricePerMTokensCompletion;
  }
}

function fail(failure: AiFailure): AiResult {
  return { ok: false, failure };
}

function toFailure(err: unknown, attempt: number): AiFailure {
  if (err instanceof AppError && err.code === ErrorCode.AI_TIMEOUT) return { kind: "TIMEOUT", message: err.message, attempt };
  if (err instanceof AppError && err.code === ErrorCode.AI_INVALID_OUTPUT) return { kind: "INVALID_OUTPUT", message: err.message, attempt };
  return { kind: "PROVIDER_ERROR", message: err instanceof Error ? err.message : String(err), attempt };
}

/** Extracts a JSON object from a response that may include prose or code fences. */
export function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : content;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1);
}
