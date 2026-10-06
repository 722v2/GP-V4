import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiDecision, AiResult } from "../core/types/AiDecision.js";
import type { KillSwitchState } from "../risk/KillSwitch.js";
import type { Signal } from "../pipeline/Signal.js";

export interface SignalRecordResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
}

/**
 * Persistence boundary. All persistence is behind this interface so the
 * pipeline is fully testable without a live Supabase project.
 */
export interface PersistenceRepository {
  saveSetup(setup: Setup): Promise<void>;
  saveAiDecision(setupId: string, result: AiResult, mode: string): Promise<void>;
  saveTradePlan(plan: TradePlan, decision: RiskDecisionRecord): Promise<void>;
  saveSignal(signal: Signal): Promise<SignalRecordResult>;
  updateTrade(trade: Trade): Promise<void>;
  getOpenTrades(): Promise<Trade[]>;
  getClosedTrades(since?: number): Promise<Trade[]>;
  getActiveSetups(): Promise<Setup[]>;
  getSignals(limit?: number): Promise<Signal[]>;
  getKillSwitchState(): Promise<KillSwitchState | null>;
  saveKillSwitchState(state: KillSwitchState): Promise<void>;
  saveSettings?(settings: Record<string, unknown>, updatedBy: string): Promise<void>;
  getSettings?(): Promise<Record<string, unknown> | null>;
  readonly name: string;
}

export interface RiskDecisionRecord {
  readonly verdict: string;
  readonly lotSize: number;
  readonly riskAmount: number;
  readonly reasons: readonly string[];
}

/** No-op repository used when persistence is strictly disabled or in isolated unit tests. */
export class NullRepository implements PersistenceRepository {
  readonly name: string = "null";
  protected readonly savedSignalIds = new Set<string>();

  async saveSetup(_setup: Setup): Promise<void> {}
  async saveAiDecision(_setupId: string, _result: AiResult, _mode: string): Promise<void> {}
  async saveTradePlan(_plan: TradePlan, _decision: RiskDecisionRecord): Promise<void> {}
  async saveSignal(signal: Signal): Promise<SignalRecordResult> {
    if (this.savedSignalIds.has(signal.id)) {
      return { accepted: false, duplicate: true };
    }
    this.savedSignalIds.add(signal.id);
    return { accepted: true, duplicate: false };
  }
  async updateTrade(_trade: Trade): Promise<void> {}
  async getOpenTrades(): Promise<Trade[]> {
    return [];
  }
  async getClosedTrades(_since?: number): Promise<Trade[]> {
    return [];
  }
  async getActiveSetups(): Promise<Setup[]> {
    return [];
  }
  async getSignals(_limit?: number): Promise<Signal[]> {
    return [];
  }
  async getKillSwitchState(): Promise<KillSwitchState | null> {
    return null;
  }
  async saveKillSwitchState(_state: KillSwitchState): Promise<void> {}
  async saveSettings(_settings: Record<string, unknown>, _updatedBy: string): Promise<void> {}
  async getSettings(): Promise<Record<string, unknown> | null> {
    return null;
  }
}

/** In-memory repository used when Supabase is not configured or in local dev/testing. */
export class InMemoryRepository extends NullRepository {
  override readonly name = "in-memory";
  private readonly inMemorySignals: Signal[] = [];
  private readonly inMemoryTrades = new Map<string, Trade>();
  private inMemorySettings: Record<string, unknown> | null = null;

  override async saveSettings(settings: Record<string, unknown>, _updatedBy: string): Promise<void> {
    this.inMemorySettings = settings;
  }

  override async getSettings(): Promise<Record<string, unknown> | null> {
    return this.inMemorySettings;
  }

  override async saveTradePlan(plan: TradePlan, _decision: RiskDecisionRecord): Promise<void> {
    const trade: Trade = {
      ...plan,
      state: "PLANNED",
    };
    this.inMemoryTrades.set(trade.id, trade);
  }

  override async saveSignal(signal: Signal): Promise<SignalRecordResult> {
    const res = await super.saveSignal(signal);
    if (res.accepted) {
      this.inMemorySignals.push(signal);
    }
    return res;
  }

  override async updateTrade(trade: Trade): Promise<void> {
    this.inMemoryTrades.set(trade.id, trade);
  }

  override async getOpenTrades(): Promise<Trade[]> {
    return [...this.inMemoryTrades.values()].filter(
      (t) => t.state === "OPEN" || t.state === "SUBMITTED" || t.state === "TP1_HIT"
    );
  }

  override async getClosedTrades(since?: number): Promise<Trade[]> {
    const list = [...this.inMemoryTrades.values()].filter(
      (t) =>
        t.state === "TP2_HIT" ||
        t.state === "SL_HIT" ||
        t.state === "MANUALLY_CLOSED" ||
        t.state === "EXPIRED" ||
        t.state === "REJECTED"
    );
    return since ? list.filter((t) => (t.closedAt ?? 0) >= since) : list;
  }

  override async getSignals(limit?: number): Promise<Signal[]> {
    const list = [...this.inMemorySignals].reverse();
    return limit && limit > 0 ? list.slice(0, limit) : list;
  }
}

/** Serializes a decision row for storage — kept explicit for schema evolution. */
export function serializeAiDecision(setupId: string, result: AiResult, mode: string): Record<string, unknown> {
  return {
    setup_id: setupId,
    mode,
    ok: result.ok,
    decision: result.ok ? result.decision.decision : null,
    confidence: result.ok ? result.decision.confidence : null,
    payload: result.ok ? result.decision : result.failure,
    cost_usd: result.ok ? result.costUsd : 0,
    cached: result.ok ? result.cached : false,
  };
}
