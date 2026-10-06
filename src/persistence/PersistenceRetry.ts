import { AppError, ErrorCode, type Logger } from "../core/logging/Logger.js";
import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiResult } from "../core/types/AiDecision.js";
import type { KillSwitchState } from "../risk/KillSwitch.js";
import type { Signal } from "../pipeline/Signal.js";
import type { EventBus } from "../core/events/EventBus.js";
import type { TelegramNotifier } from "../telegram/TelegramNotifier.js";
import type { PersistenceRepository, RiskDecisionRecord, SignalRecordResult } from "./Persistence.js";

export interface PersistenceRetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  alertCooldownMs?: number;
  bus?: EventBus;
  telegram?: TelegramNotifier;
  mode?: string;
  log?: Logger;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export function isRetryablePersistenceError(err: unknown): boolean {
  if (!err) return false;

  // Supabase / Postgres non-retryable error codes
  // 23505 (unique_violation), 23503 (foreign_key_violation), 42P01 (undefined_table), 42703 (undefined_column)
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as Record<string, unknown>).code);
    if (code.startsWith("23") || code.startsWith("42") || code === "P0001") {
      return false;
    }
  }

  if (err instanceof AppError) {
    if (err.code === ErrorCode.CONFIG_INVALID || err.code === ErrorCode.VALIDATION_FAILED) {
      return false;
    }
    if (err.cause && !isRetryablePersistenceError(err.cause)) {
      return false;
    }
  }

  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (
    msg.includes("400") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("permission")
  ) {
    return false;
  }

  return true;
}

export async function retryPersistence<T>(
  operationName: string,
  fn: () => Promise<T>,
  opts: PersistenceRetryOptions
): Promise<T> {
  const maxRetries = Math.max(0, opts.maxRetries ?? 3);
  const initialDelayMs = Math.max(0, opts.initialDelayMs ?? 500);
  const maxDelayMs = Math.max(initialDelayMs, opts.maxDelayMs ?? 4000);
  const sleep = opts.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = isRetryablePersistenceError(err);

      if (!isRetryable || attempt > maxRetries) {
        if (opts.log) {
          opts.log.error(
            `persistence operation ${operationName} failed (attempt ${attempt}/${maxRetries + 1}, retryable: ${isRetryable})`,
            err
          );
        }
        throw err;
      }

      const backoffMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      if (opts.log) {
        opts.log.warn(
          `persistence operation ${operationName} failed (attempt ${attempt}/${maxRetries + 1}), retrying in ${backoffMs}ms`,
          {
            err: err instanceof Error ? err.message : String(err),
          }
        );
      }
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

/**
 * Decorator class that wraps any PersistenceRepository with exponential backoff retries,
 * error classification, failure event emission, and Telegram alerts on failure exhaustion.
 */
export class RetryingRepository implements PersistenceRepository {
  readonly name: string;
  private readonly recentAlerts = new Map<string, number>();

  constructor(
    private readonly inner: PersistenceRepository,
    private readonly opts: PersistenceRetryOptions
  ) {
    this.name = `retrying(${inner.name})`;
  }

  private async executeWithRetry<T>(
    operation: string,
    entity: string,
    entityId: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const maxRetries = this.opts.maxRetries ?? 3;
    const initialDelayMs = this.opts.initialDelayMs ?? 500;
    const maxDelayMs = this.opts.maxDelayMs ?? 4000;
    const sleep = this.opts.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = this.opts.now ?? Date.now;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isRetryable = isRetryablePersistenceError(err);

        if (!isRetryable || attempt > maxRetries) {
          await this.handleExhaustedFailure(operation, entity, entityId, attempt, err, now());
          throw err;
        }

        const backoffMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        if (this.opts.log) {
          this.opts.log.warn(
            `persistence operation ${operation} failed (attempt ${attempt}/${maxRetries + 1}), retrying in ${backoffMs}ms`,
            {
              operation,
              entity,
              entityId,
              err: err instanceof Error ? err.message : String(err),
            }
          );
        }
        await sleep(backoffMs);
      }
    }

    throw lastError;
  }

  private async handleExhaustedFailure(
    operation: string,
    entity: string,
    entityId: string | undefined,
    attempts: number,
    error: unknown,
    timestamp: number
  ): Promise<void> {
    const errMsg = error instanceof Error ? error.message : String(error);
    const mode = this.opts.mode ?? "UNKNOWN";

    // 1. Publish Event
    if (this.opts.bus) {
      await this.opts.bus
        .publish({
          name: "persistence.failed",
          timestamp,
          payload: {
            operation,
            entity,
            entityId,
            attempts,
            error: errMsg,
            mode,
            exhausted: true,
          },
        })
        .catch((e) => {
          this.opts.log?.warn("failed to publish persistence.failed event", { err: String(e) });
        });
    }

    // 2. Telegram Alert with Cooldown Deduplication
    if (this.opts.telegram) {
      const cooldownMs = this.opts.alertCooldownMs ?? 60_000;
      const fingerprint = `${operation}:${entity}:${entityId ?? "all"}:${errMsg.slice(0, 50)}`;
      const lastSent = this.recentAlerts.get(fingerprint) ?? 0;

      if (timestamp - lastSent >= cooldownMs) {
        this.recentAlerts.set(fingerprint, timestamp);

        const alertText = [
          `*[PERSISTENCE FAILURE]*`,
          `*Operation:* ${operation}`,
          `*Entity:* ${entity}`,
          `*ID:* ${entityId ?? "N/A"}`,
          `*Attempts:* ${attempts}`,
          `*Mode:* ${mode}`,
          `*Error:* ${errMsg}`,
          `*Action:* runtime entered degraded/safe path`,
        ].join("\n");

        await this.opts.telegram.notify(alertText).catch((err) => {
          this.opts.log?.warn("telegram notification on persistence failure failed", { err: String(err) });
        });
      }
    }
  }

  async saveSetup(setup: Setup): Promise<void> {
    return this.executeWithRetry("saveSetup", "setup", setup.id, () => this.inner.saveSetup(setup));
  }

  async saveAiDecision(setupId: string, result: AiResult, mode: string): Promise<void> {
    // Non-critical telemetry write
    try {
      return await this.executeWithRetry("saveAiDecision", "ai_decision", setupId, () =>
        this.inner.saveAiDecision(setupId, result, mode)
      );
    } catch (err) {
      this.opts.log?.warn("non-critical saveAiDecision failed", { setupId, err: String(err) });
    }
  }

  async saveTradePlan(plan: TradePlan, decision: RiskDecisionRecord): Promise<void> {
    return this.executeWithRetry("saveTradePlan", "trade_plan", plan.id, () =>
      this.inner.saveTradePlan(plan, decision)
    );
  }

  async saveSignal(signal: Signal): Promise<SignalRecordResult> {
    return this.executeWithRetry("saveSignal", "signal", signal.id, () => this.inner.saveSignal(signal));
  }

  async updateTrade(trade: Trade): Promise<void> {
    return this.executeWithRetry("updateTrade", "trade", trade.id, () => this.inner.updateTrade(trade));
  }

  async getOpenTrades(): Promise<Trade[]> {
    return this.executeWithRetry("getOpenTrades", "trade", undefined, () => this.inner.getOpenTrades());
  }

  async getClosedTrades(since?: number): Promise<Trade[]> {
    return this.executeWithRetry("getClosedTrades", "trade", undefined, () => this.inner.getClosedTrades(since));
  }

  async getActiveSetups(): Promise<Setup[]> {
    return this.executeWithRetry("getActiveSetups", "setup", undefined, () => this.inner.getActiveSetups());
  }

  async getSignals(limit?: number): Promise<Signal[]> {
    return this.executeWithRetry("getSignals", "signal", undefined, () => this.inner.getSignals(limit));
  }

  async getKillSwitchState(): Promise<KillSwitchState | null> {
    return this.executeWithRetry("getKillSwitchState", "kill_switch", "singleton", () =>
      this.inner.getKillSwitchState()
    );
  }

  async saveKillSwitchState(state: KillSwitchState): Promise<void> {
    return this.executeWithRetry("saveKillSwitchState", "kill_switch", "singleton", () =>
      this.inner.saveKillSwitchState(state)
    );
  }

  async saveSettings(settings: Record<string, unknown>, updatedBy: string): Promise<void> {
    if (!this.inner.saveSettings) return;
    return this.executeWithRetry("saveSettings", "system_settings", "singleton", () =>
      this.inner.saveSettings!(settings, updatedBy)
    );
  }

  async getSettings(): Promise<Record<string, unknown> | null> {
    if (!this.inner.getSettings) return null;
    return this.executeWithRetry("getSettings", "system_settings", "singleton", () =>
      this.inner.getSettings!()
    );
  }

  async saveExperienceRecord(record: import("../core/memory/ExperienceMemory.js").TradeExperienceRecord): Promise<void> {
    if (!this.inner.saveExperienceRecord) return;
    return this.executeWithRetry("saveExperienceRecord", "experience_record", record.id, () =>
      this.inner.saveExperienceRecord!(record)
    );
  }

  async getExperienceRecords(limit?: number): Promise<import("../core/memory/ExperienceMemory.js").TradeExperienceRecord[]> {
    if (!this.inner.getExperienceRecords) return [];
    return this.executeWithRetry("getExperienceRecords", "experience_record", undefined, () =>
      this.inner.getExperienceRecords!(limit)
    );
  }

  async saveOrder(order: import("./Persistence.js").OrderRecord): Promise<void> {
    if (!this.inner.saveOrder) return;
    return this.executeWithRetry("saveOrder", "order", order.clientOrderId, () =>
      this.inner.saveOrder!(order)
    );
  }

  async getOrder(clientOrderId: string): Promise<import("./Persistence.js").OrderRecord | null> {
    if (!this.inner.getOrder) return null;
    return this.executeWithRetry("getOrder", "order", clientOrderId, () =>
      this.inner.getOrder!(clientOrderId)
    );
  }

  async saveExecution(execution: import("./Persistence.js").ExecutionRecord): Promise<void> {
    if (!this.inner.saveExecution) return;
    return this.executeWithRetry("saveExecution", "execution", execution.id, () =>
      this.inner.saveExecution!(execution)
    );
  }

  async saveReconciliationEvent(event: import("./Persistence.js").ReconciliationEventRecord): Promise<void> {
    if (!this.inner.saveReconciliationEvent) return;
    return this.executeWithRetry("saveReconciliationEvent", "reconciliation_event", event.id, () =>
      this.inner.saveReconciliationEvent!(event)
    );
  }

  async savePromotionReport(report: import("./Persistence.js").PromotionReportRecord): Promise<void> {
    if (!this.inner.savePromotionReport) return;
    return this.executeWithRetry("savePromotionReport", "promotion_report", report.id, () =>
      this.inner.savePromotionReport!(report)
    );
  }

  async getLatestPromotionReport(): Promise<import("./Persistence.js").PromotionReportRecord | null> {
    if (!this.inner.getLatestPromotionReport) return null;
    return this.executeWithRetry("getLatestPromotionReport", "promotion_report", "latest", () =>
      this.inner.getLatestPromotionReport!()
    );
  }
}
