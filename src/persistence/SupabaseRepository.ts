import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiResult } from "../core/types/AiDecision.js";
import type { KillSwitchState } from "../risk/KillSwitch.js";
import { AppError, ErrorCode, type Logger } from "../core/logging/Logger.js";
import { serializeAiDecision, type SignalRecordResult, type PersistenceRepository, type RiskDecisionRecord } from "./Persistence.js";
import type { Signal } from "../pipeline/Signal.js";

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

/**
 * Supabase-backed persistence. The client is created lazily so constructing this
 * class never requires network or credentials; every method is a no-op guard
 * until configured. The Supabase schema (tables/columns) is created by a separate
 * SQL migration — this code targets tables named setups, ai_decisions, trades, kill_switch, signals.
 */
export class SupabaseRepository implements PersistenceRepository {
  readonly name = "supabase";
  private client: SupabaseClient | null = null;
  private readonly localSignalIds = new Set<string>();

  constructor(
    private readonly cfg: SupabaseConfig,
    private readonly log: Logger
  ) {}

  isConfigured(): boolean {
    return this.cfg.url !== "" && this.cfg.serviceKey !== "";
  }

  private db(): SupabaseClient {
    if (!this.client) {
      if (!this.isConfigured()) {
        throw new AppError(ErrorCode.CONFIG_INVALID, "Supabase persistence not configured");
      }
      this.client = createClient(this.cfg.url, this.cfg.serviceKey, { auth: { persistSession: false } });
    }
    return this.client;
  }

  private async upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
    if (!this.isConfigured()) return;
    const { error } = await this.db().from(table).upsert(row, { onConflict });
    if (error) {
      this.log.error(`supabase upsert failed: ${table}`, error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, `Supabase upsert into ${table} failed`, undefined, error);
    }
  }

  async saveSetup(setup: Setup): Promise<void> {
    await this.upsert(
      "setups",
      {
        id: setup.id,
        strategy_id: setup.strategyId,
        symbol: setup.symbol,
        timeframe: setup.timeframe,
        direction: setup.direction,
        bar_open_time: setup.barOpenTime,
        state: setup.state,
        entry: setup.entry,
        stop_loss: setup.stopLoss,
        take_profit1: setup.takeProfit1,
        take_profit2: setup.takeProfit2,
        rationale: setup.rationale,
        evidence: setup.evidence,
        created_at: setup.createdAt,
      },
      "id"
    );
  }

  async saveAiDecision(setupId: string, result: AiResult, mode: string): Promise<void> {
    await this.upsert(
      "ai_decisions",
      { setup_id: setupId, ...serializeAiDecision(setupId, result, mode), decided_at: Date.now() },
      "setup_id"
    );
  }

  async saveTradePlan(plan: TradePlan, decision: RiskDecisionRecord): Promise<void> {
    await this.upsert(
      "trades",
      {
        id: plan.id,
        signal_id: plan.signalId,
        symbol: plan.symbol,
        direction: plan.direction,
        state: "PLANNED",
        entry: plan.entry,
        stop_loss: plan.stopLoss,
        take_profit1: plan.takeProfit1,
        take_profit2: plan.takeProfit2,
        lot_size: plan.lotSize,
        risk_amount: plan.riskAmount,
        mode: plan.mode,
        created_at: plan.createdAt,
        risk_decision: decision,
      },
      "id"
    );
  }

  async saveSignal(signal: Signal): Promise<SignalRecordResult> {
    if (!this.isConfigured()) {
      if (this.localSignalIds.has(signal.id)) {
        return { accepted: false, duplicate: true };
      }
      this.localSignalIds.add(signal.id);
      return { accepted: true, duplicate: false };
    }

    const row = {
      id: signal.id,
      setup_id: signal.setupId,
      symbol: signal.symbol,
      timeframe: signal.timeframe ?? "M5",
      direction: signal.direction,
      bar_open_time: signal.barOpenTime ?? signal.createdAt ?? Date.now(),
      entry: signal.entry,
      stop_loss: signal.stopLoss,
      take_profit1: signal.takeProfit1,
      take_profit2: signal.takeProfit2,
      lot_size: signal.lotSize,
      risk_amount: signal.riskAmount,
      mode: signal.mode,
      created_at: signal.createdAt,
    };

    const { error } = await this.db().from("signals").insert(row);
    if (error) {
      if (
        error.code === "23505" ||
        error.message?.includes("duplicate") ||
        error.message?.includes("unique constraint") ||
        error.details?.includes("already exists")
      ) {
        return { accepted: false, duplicate: true };
      }
      this.log.error("supabase saveSignal failed", error);
      throw new AppError(
        ErrorCode.PERSISTENCE_FAILED,
        `Failed to persist signal in Supabase: ${error.message}`,
        undefined,
        error
      );
    }

    return { accepted: true, duplicate: false };
  }

  async updateTrade(trade: Trade): Promise<void> {
    await this.upsert(
      "trades",
      {
        id: trade.id,
        state: trade.state,
        opened_at: trade.openedAt ?? null,
        closed_at: trade.closedAt ?? null,
        realized_pnl: trade.realizedPnl ?? null,
        exit_reason: trade.exitReason ?? null,
      },
      "id"
    );
  }

  async getOpenTrades(): Promise<Trade[]> {
    if (!this.isConfigured()) return [];
    const { data, error } = await this.db()
      .from("trades")
      .select("*")
      .in("state", ["SUBMITTED", "OPEN", "TP1_HIT"]);
    if (error) {
      this.log.error("supabase getOpenTrades failed", error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, "Failed to load open trades from Supabase", undefined, error);
    }
    return (data ?? []).map(mapTradeRow);
  }

  async getClosedTrades(since?: number): Promise<Trade[]> {
    if (!this.isConfigured()) return [];
    let query = this.db()
      .from("trades")
      .select("*")
      .in("state", ["TP2_HIT", "SL_HIT", "MANUALLY_CLOSED"]);
    if (since !== undefined) {
      query = query.gte("closed_at", since);
    }
    const { data, error } = await query;
    if (error) {
      this.log.error("supabase getClosedTrades failed", error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, "Failed to load closed trades from Supabase", undefined, error);
    }
    return (data ?? []).map(mapTradeRow);
  }

  async getActiveSetups(): Promise<Setup[]> {
    if (!this.isConfigured()) return [];
    const { data, error } = await this.db()
      .from("setups")
      .select("*")
      .in("state", ["NEW", "ACTIVE", "UPDATED"]);
    if (error) {
      this.log.error("supabase getActiveSetups failed", error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, "Failed to load active setups from Supabase", undefined, error);
    }
    return (data ?? []).map(mapSetupRow);
  }

  async getSignals(limit = 100): Promise<Signal[]> {
    if (!this.isConfigured()) return [];
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const { data, error } = await this.db()
      .from("signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    if (error) {
      this.log.error("supabase getSignals failed", error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, "Failed to load signals from Supabase", undefined, error);
    }
    return (data ?? []).map(mapSignalRow);
  }

  async getKillSwitchState(): Promise<KillSwitchState | null> {
    if (!this.isConfigured()) return null;
    const { data, error } = await this.db()
      .from("kill_switch")
      .select("*")
      .eq("id", "singleton")
      .maybeSingle();
    if (error) {
      this.log.error("supabase getKillSwitchState failed", error);
      throw new AppError(ErrorCode.PERSISTENCE_FAILED, "Failed to load kill switch state from Supabase", undefined, error);
    }
    if (!data) return null;
    return {
      level: data.level,
      reason: data.reason ?? "",
      updatedAt: Number(data.updated_at ?? 0),
      updatedBy: data.updated_by ?? "system",
      active: Boolean(data.active),
    };
  }

  async saveKillSwitchState(state: KillSwitchState): Promise<void> {
    await this.upsert(
      "kill_switch",
      {
        id: "singleton",
        level: state.level,
        reason: state.reason,
        updated_at: state.updatedAt,
        updated_by: state.updatedBy,
        active: state.active,
      },
      "id"
    );
  }

  async saveSettings(settings: Record<string, unknown>, updatedBy: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.upsert(
      "system_settings",
      {
        id: "singleton",
        settings,
        updated_at: Date.now(),
        updated_by: updatedBy,
      },
      "id"
    );
  }

  async getSettings(): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.db().from("system_settings").select("*").eq("id", "singleton").maybeSingle();
      if (error) {
        this.log.warn("failed to get system settings from supabase", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return null;
      }
      return data ? (data.settings as Record<string, unknown>) : null;
    } catch (err) {
      this.log.warn("failed to get system settings from supabase", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function mapTradeRow(row: Record<string, unknown>): Trade {
  return {
    id: String(row.id),
    signalId: String(row.signal_id ?? `sig:${row.id}`),
    symbol: (row.symbol as Trade["symbol"]) ?? "XAUUSD",
    direction: (row.direction as Trade["direction"]) ?? "LONG",
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    takeProfit1: Number(row.take_profit1),
    takeProfit2: Number(row.take_profit2),
    lotSize: Number(row.lot_size),
    riskAmount: Number(row.risk_amount ?? 0),
    mode: String(row.mode ?? "PAPER_TRADING"),
    createdAt: Number(row.created_at ?? Date.now()),
    state: (row.state as Trade["state"]) ?? "OPEN",
    openedAt: row.opened_at != null ? Number(row.opened_at) : undefined,
    closedAt: row.closed_at != null ? Number(row.closed_at) : undefined,
    realizedPnl: row.realized_pnl != null ? Number(row.realized_pnl) : undefined,
    exitReason: row.exit_reason != null ? String(row.exit_reason) : undefined,
  };
}

function mapSetupRow(row: Record<string, unknown>): Setup {
  return {
    id: String(row.id),
    strategyId: String(row.strategy_id ?? "strong-candle"),
    symbol: (row.symbol as Setup["symbol"]) ?? "XAUUSD",
    timeframe: (row.timeframe as Setup["timeframe"]) ?? "M5",
    direction: (row.direction as Setup["direction"]) ?? "LONG",
    barOpenTime: Number(row.bar_open_time),
    createdAt: Number(row.created_at),
    state: (row.state as Setup["state"]) ?? "ACTIVE",
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    takeProfit1: Number(row.take_profit1),
    takeProfit2: Number(row.take_profit2),
    invalidationPrice: Number(row.stop_loss),
    rationale: String(row.rationale ?? ""),
    evidence: (row.evidence as Setup["evidence"]) ?? [],
  };
}

function mapSignalRow(row: Record<string, unknown>): Signal {
  return {
    id: String(row.id),
    setupId: String(row.setup_id),
    symbol: String(row.symbol),
    timeframe: row.timeframe ? String(row.timeframe) : "M5",
    direction: (row.direction as Signal["direction"]) ?? "LONG",
    barOpenTime: row.bar_open_time ? Number(row.bar_open_time) : undefined,
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    takeProfit1: Number(row.take_profit1),
    takeProfit2: Number(row.take_profit2),
    lotSize: Number(row.lot_size),
    riskAmount: Number(row.risk_amount ?? 0),
    createdAt: Number(row.created_at ?? Date.now()),
    mode: String(row.mode ?? "PAPER_TRADING"),
  };
}
