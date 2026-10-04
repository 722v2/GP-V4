import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiResult } from "../core/types/AiDecision.js";
import { AppError, ErrorCode, type Logger } from "../core/logging/Logger.js";
import { serializeAiDecision, type PersistenceRepository, type RiskDecisionRecord } from "./Persistence.js";

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

/**
 * Supabase-backed persistence. The client is created lazily so constructing this
 * class never requires network or credentials; every method is a no-op guard
 * until configured. The Supabase schema (tables/columns) is created by a separate
 * SQL migration — this code targets tables named setups, ai_decisions, trades.
 */
export class SupabaseRepository implements PersistenceRepository {
  readonly name = "supabase";
  private client: SupabaseClient | null = null;

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
}