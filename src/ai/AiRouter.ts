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
import type { ExperienceInsight } from "../core/memory/ExperienceMemory.js";

export interface AiRouterConfig {
  enabled: boolean;
  maxRetries: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  minConfidence: number;
  levelTolerancePts: number;
  timeoutMs: number;
  m5TimeoutMs: number;
  m5Model: string;
  cacheTtlMs: number;
  /** USD per 1M tokens, used to estimate cost from usage. */
  pricePerMTokensPrompt: number;
  pricePerMTokensCompletion: number;
}

export const DEFAULT_AI_ROUTER_CONFIG: AiRouterConfig = {
  enabled: true,
  maxRetries: 1,
  retryInitialDelayMs: 500,
  retryMaxDelayMs: 4000,
  minConfidence: 0.6,
  levelTolerancePts: 1.0,
  timeoutMs: 45_000,
  m5TimeoutMs: 15_000,
  m5Model: "",
  cacheTtlMs: 120_000,
  pricePerMTokensPrompt: 0.4,
  pricePerMTokensCompletion: 0.4,
};

/**
 * Validates that an AI TRADE_CANDIDATE decision materially matches the setup context.
 * Checks direction, SL directional sanity, setup ID, and level tolerances.
 */
export function validateAiDecisionAgainstSetup(
  decision: AiDecision,
  setup: Setup,
  tolerancePts = 1.0
): { valid: boolean; reason?: string } {
  if (decision.decision !== "TRADE_CANDIDATE") {
    return { valid: true };
  }

  // 1. Direction check
  if (decision.direction && decision.direction !== setup.direction) {
    return {
      valid: false,
      reason: `AI direction (${decision.direction}) contradicts setup direction (${setup.direction})`,
    };
  }

  // 2. SL directional sanity check
  if (decision.entry != null && decision.SL != null) {
    if (setup.direction === "LONG" && decision.SL >= decision.entry) {
      return {
        valid: false,
        reason: `AI SL (${decision.SL}) >= entry (${decision.entry}) for LONG setup`,
      };
    }
    if (setup.direction === "SHORT" && decision.SL <= decision.entry) {
      return {
        valid: false,
        reason: `AI SL (${decision.SL}) <= entry (${decision.entry}) for SHORT setup`,
      };
    }
  }

  // 3. Setup ID match check
  if (decision.setup_id && decision.setup_id !== setup.id) {
    return {
      valid: false,
      reason: `AI setup_id (${decision.setup_id}) does not match setup id (${setup.id})`,
    };
  }

  // 4. Level tolerance checks
  if (decision.entry != null && Math.abs(decision.entry - setup.entry) > tolerancePts) {
    return {
      valid: false,
      reason: `AI entry (${decision.entry}) differs from setup entry (${setup.entry}) by > ${tolerancePts} pts`,
    };
  }
  if (decision.SL != null && Math.abs(decision.SL - setup.stopLoss) > tolerancePts) {
    return {
      valid: false,
      reason: `AI SL (${decision.SL}) differs from setup stopLoss (${setup.stopLoss}) by > ${tolerancePts} pts`,
    };
  }
  if (decision.TP1 != null && Math.abs(decision.TP1 - setup.takeProfit1) > tolerancePts) {
    return {
      valid: false,
      reason: `AI TP1 (${decision.TP1}) differs from setup takeProfit1 (${setup.takeProfit1}) by > ${tolerancePts} pts`,
    };
  }
  if (decision.TP2 != null && Math.abs(decision.TP2 - setup.takeProfit2) > tolerancePts) {
    return {
      valid: false,
      reason: `AI TP2 (${decision.TP2}) differs from setup takeProfit2 (${setup.takeProfit2}) by > ${tolerancePts} pts`,
    };
  }

  return { valid: true };
}

export interface AiDecisionRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly setupId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly decision: AiDecision;
  readonly validationStatus: "VALIDATED" | "REJECTED" | "CONFIDENCE_BELOW_MINIMUM";
  readonly rejectionReason?: string;
  readonly cached: boolean;
  readonly model: string;
  readonly costUsd: number;
  readonly tokens: { prompt: number; completion: number };
}

/**
 * AI router: budget check → circuit breaker → cache → provider call with exponential retries
 * → setup validation → minimum confidence enforcement.
 * ALWAYS returns an AiResult; failures are degraded to `{ ok:false, failure }`.
 */
export class AiRouter {
  private readonly cache: ResponseCache;
  private readonly usageLog: AiUsage[] = [];
  private readonly decisionLog: AiDecisionRecord[] = [];

  constructor(
    private readonly provider: AiProvider,
    private readonly budget: BudgetGuard,
    private readonly breaker: CircuitBreaker,
    private readonly contextBuilder: ContextBuilder,
    private readonly log: Logger,
    private readonly cfg: AiRouterConfig = DEFAULT_AI_ROUTER_CONFIG,
    private readonly now: () => number = Date.now,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((res) => setTimeout(res, ms))
  ) {
    this.cache = new ResponseCache(cfg.cacheTtlMs);
  }

  getUsageLog(): readonly AiUsage[] {
    return this.usageLog;
  }

  getDecisionLog(): readonly AiDecisionRecord[] {
    return this.decisionLog;
  }

  updateConfig(patch: Partial<AiRouterConfig>): void {
    Object.assign(this.cfg, patch);
  }

  getConfig(): Readonly<AiRouterConfig> {
    return { ...this.cfg };
  }

  async analyze(
    ctx: EngineContext,
    confluence: ConfluenceResult,
    setup: Setup,
    accountEquity: number,
    mode: string,
    expInsight?: ExperienceInsight
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

    // Primary execution timeframe fast-path routing configuration
    const isPrimaryFastPath = ctx.timeframe === "M1" || ctx.timeframe === "M5";
    const selectedTimeoutMs = isPrimaryFastPath && this.cfg.m5TimeoutMs ? this.cfg.m5TimeoutMs : this.cfg.timeoutMs;
    const selectedModel = isPrimaryFastPath && this.cfg.m5Model ? this.cfg.m5Model : "";

    const { system, user } = this.contextBuilder.buildSetupPrompt(ctx, confluence, setup, accountEquity, mode, expInsight);
    const key = ResponseCache.signature(system, user);
    const cached = this.cache.get<{ decision: AiDecision; usage: { prompt: number; completion: number }; model: string }>(key, now);
    if (cached) {
      const validation = validateAiDecisionAgainstSetup(cached.decision, setup, this.cfg.levelTolerancePts);
      if (validation.valid) {
        let decision = cached.decision;
        let validationStatus: "VALIDATED" | "CONFIDENCE_BELOW_MINIMUM" = "VALIDATED";
        if (decision.decision === "TRADE_CANDIDATE" && decision.confidence < this.cfg.minConfidence) {
          validationStatus = "CONFIDENCE_BELOW_MINIMUM";
          decision = {
            ...decision,
            decision: "NO_TRADE",
            reason_codes: [...decision.reason_codes, "CONFIDENCE_BELOW_MINIMUM"],
          };
        }
        const record: AiDecisionRecord = {
          id: `ai:${setup.id}:${now}`,
          timestamp: now,
          setupId: setup.id,
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          decision,
          validationStatus,
          cached: true,
          model: cached.model,
          costUsd: 0,
          tokens: cached.usage,
        };
        this.decisionLog.push(record);
        return { ok: true, decision, cached: true, costUsd: 0, tokens: cached.usage };
      } else {
        this.log.warn("cached AI decision failed setup validation — bypassing cache", { reason: validation.reason });
      }
    }

    let lastFailure: AiFailure = { kind: "PROVIDER_ERROR", message: "no attempt made" };
    const attempts = this.cfg.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        if (lastFailure.kind === "INVALID_OUTPUT") {
          // Schema / setup mismatch failures are non-retriable invalid outputs
          break;
        }
        const delay = Math.min(
          this.cfg.retryInitialDelayMs * Math.pow(2, attempt - 2),
          this.cfg.retryMaxDelayMs
        );
        await this.sleepFn(delay);
      }

      try {
        const result = await this.provider.complete(
          {
            model: selectedModel,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0.2,
            response_format: { type: "json_object" },
          },
          { timeoutMs: selectedTimeoutMs }
        );

        let decision = this.parseDecision(result.content);

        // Validate AI decision against setup context
        const validation = validateAiDecisionAgainstSetup(decision, setup, this.cfg.levelTolerancePts);
        if (!validation.valid) {
          throw new AppError(
            ErrorCode.AI_INVALID_OUTPUT,
            `AI decision failed setup validation: ${validation.reason}`
          );
        }

        let validationStatus: "VALIDATED" | "CONFIDENCE_BELOW_MINIMUM" = "VALIDATED";
        // Enforce minimum confidence threshold
        if (decision.decision === "TRADE_CANDIDATE" && decision.confidence < this.cfg.minConfidence) {
          validationStatus = "CONFIDENCE_BELOW_MINIMUM";
          this.log.info("AI confidence below threshold — downgrading to NO_TRADE", {
            confidence: decision.confidence,
            minConfidence: this.cfg.minConfidence,
          });
          decision = {
            ...decision,
            decision: "NO_TRADE",
            reason_codes: [...decision.reason_codes, "CONFIDENCE_BELOW_MINIMUM"],
          };
        }

        this.breaker.recordSuccess();
        const costUsd = this.estimateCost(result.usage);
        this.usageLog.push({
          windowStart: now,
          requests: 1,
          tokensPrompt: result.usage.prompt,
          tokensCompletion: result.usage.completion,
          costUsd,
        });
        const record: AiDecisionRecord = {
          id: `ai:${setup.id}:${now}`,
          timestamp: now,
          setupId: setup.id,
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          decision,
          validationStatus,
          cached: false,
          model: result.model,
          costUsd,
          tokens: result.usage,
        };
        this.decisionLog.push(record);
        this.cache.set(key, { decision, usage: result.usage, model: result.model }, now);
        this.log.info("ai decision", { decision: decision.decision, confidence: decision.confidence, cached: false });
        return { ok: true, decision, cached: false, costUsd, tokens: result.usage };
      } catch (err) {
        lastFailure = toFailure(err, attempt);
        this.breaker.recordFailure();
        this.log.warn(`ai attempt ${attempt}/${attempts} failed`, { kind: lastFailure.kind, message: lastFailure.message });
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
