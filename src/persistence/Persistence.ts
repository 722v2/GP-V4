import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiDecision, AiResult } from "../core/types/AiDecision.js";
import type { KillSwitchState } from "../risk/KillSwitch.js";
import type { Signal } from "../pipeline/Signal.js";
import type { TradeExperienceRecord } from "../core/memory/ExperienceMemory.js";

export interface SignalRecordResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
}

export interface OrderRecord {
  readonly id: string;
  readonly clientOrderId: string;
  readonly tradeId: string;
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly orderType: "MARKET" | "LIMIT" | "STOP";
  readonly requestedLot: number;
  readonly filledLot: number;
  readonly requestedPrice?: number | null;
  readonly fillPrice?: number | null;
  readonly stopLoss?: number | null;
  readonly takeProfit?: number | null;
  readonly status: "ORDER_PENDING" | "ORDER_SUBMITTED" | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_REJECTED" | "ORDER_CANCELLED" | "ORDER_UNKNOWN";
  readonly rejectionReason?: string | null;
  readonly submittedAt: number;
  readonly filledAt?: number | null;
}

export interface ExecutionRecord {
  readonly id: string;
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly tradeId: string;
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly filledLot: number;
  readonly fillPrice: number;
  readonly slippagePoints: number;
  readonly commission: number;
  readonly protectionStatus: "PROTECTED" | "PARTIALLY_PROTECTED" | "UNPROTECTED" | "UNKNOWN";
  readonly executedAt: number;
}

export interface ReconciliationEventRecord {
  readonly id: string;
  readonly mismatchesCount: number;
  readonly mismatches: readonly unknown[];
  readonly killSwitchLevel: string;
  readonly repairsAttempted: number;
  readonly repairedCount: number;
  readonly success: boolean;
  readonly createdAt: number;
}

export interface PromotionReportRecord {
  readonly id: string;
  readonly overallState: string;
  readonly autoTradingAllowed: boolean;
  readonly activeMode: string;
  readonly gates: readonly unknown[];
  readonly summary: string;
  readonly evaluatedAt: number;
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
  saveExperienceRecord?(record: TradeExperienceRecord): Promise<void>;
  getExperienceRecords?(limit?: number): Promise<TradeExperienceRecord[]>;
  saveOrder?(order: OrderRecord): Promise<void>;
  getOrder?(clientOrderId: string): Promise<OrderRecord | null>;
  saveExecution?(execution: ExecutionRecord): Promise<void>;
  saveReconciliationEvent?(event: ReconciliationEventRecord): Promise<void>;
  savePromotionReport?(report: PromotionReportRecord): Promise<void>;
  getLatestPromotionReport?(): Promise<PromotionReportRecord | null>;
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
  async saveExperienceRecord(_record: TradeExperienceRecord): Promise<void> {}
  async getExperienceRecords(_limit?: number): Promise<TradeExperienceRecord[]> {
    return [];
  }
  async saveOrder(_order: OrderRecord): Promise<void> {}
  async getOrder(_clientOrderId: string): Promise<OrderRecord | null> {
    return null;
  }
  async saveExecution(_execution: ExecutionRecord): Promise<void> {}
  async saveReconciliationEvent(_event: ReconciliationEventRecord): Promise<void> {}
  async savePromotionReport(_report: PromotionReportRecord): Promise<void> {}
  async getLatestPromotionReport(): Promise<PromotionReportRecord | null> {
    return null;
  }
}

/** In-memory repository used when Supabase is not configured or in local dev/testing. */
export class InMemoryRepository extends NullRepository {
  override readonly name = "in-memory";
  private readonly inMemorySignals: Signal[] = [];
  private readonly inMemoryTrades = new Map<string, Trade>();
  private readonly inMemoryExperience: TradeExperienceRecord[] = [];
  private readonly inMemoryOrders = new Map<string, OrderRecord>();
  private readonly inMemoryExecutions: ExecutionRecord[] = [];
  private readonly inMemoryReconciliations: ReconciliationEventRecord[] = [];
  private inMemoryPromotionReport: PromotionReportRecord | null = null;
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

  override async saveExperienceRecord(record: TradeExperienceRecord): Promise<void> {
    if (!this.inMemoryExperience.some((r) => r.id === record.id)) {
      this.inMemoryExperience.push(record);
      this.inMemoryExperience.sort((a, b) => a.closedAt - b.closedAt);
    }
  }

  override async getExperienceRecords(limit = 100): Promise<TradeExperienceRecord[]> {
    return this.inMemoryExperience.slice(-limit);
  }

  override async saveOrder(order: OrderRecord): Promise<void> {
    this.inMemoryOrders.set(order.clientOrderId, order);
  }

  override async getOrder(clientOrderId: string): Promise<OrderRecord | null> {
    return this.inMemoryOrders.get(clientOrderId) ?? null;
  }

  override async saveExecution(execution: ExecutionRecord): Promise<void> {
    this.inMemoryExecutions.push(execution);
  }

  override async saveReconciliationEvent(event: ReconciliationEventRecord): Promise<void> {
    this.inMemoryReconciliations.push(event);
  }

  override async savePromotionReport(report: PromotionReportRecord): Promise<void> {
    this.inMemoryPromotionReport = report;
  }

  override async getLatestPromotionReport(): Promise<PromotionReportRecord | null> {
    return this.inMemoryPromotionReport;
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
