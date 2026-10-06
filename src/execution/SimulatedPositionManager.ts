import type { EventBus } from "../core/events/EventBus.js";
import type { PersistenceRepository } from "../persistence/Persistence.js";
import type { Logger } from "../core/logging/Logger.js";
import type { Candle } from "../core/types/Candle.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { SystemEvent } from "../core/types/Events.js";
import type { BrokerProtection } from "./BrokerProtection.js";
import type { CandleCache } from "../marketdata/CandleCache.js";
import {
  TradeLifecycle,
  type TradeLifecycleState,
  type SpreadSlippageModel,
  isTerminal,
} from "./TradeLifecycle.js";
import type { SimulatedFill } from "../pipeline/TradingPipeline.js";

import type { ExperienceMemory, TradeExperienceRecord } from "../core/memory/ExperienceMemory.js";
import { calculateR } from "../core/types/Trade.js";

export interface SimulatedPositionManagerDeps {
  readonly bus: EventBus;
  readonly repo: PersistenceRepository;
  readonly protection?: BrokerProtection;
  readonly spreadModel?: SpreadSlippageModel;
  readonly cache?: CandleCache;
  readonly experienceMemory?: ExperienceMemory;
  readonly log?: Logger;
  readonly now?: () => number;
}

interface ManagedPosition {
  readonly planId: string;
  readonly symbol: Symbol | string;
  readonly lifecycle: TradeLifecycle;
  readonly submittedBarTime: number;
  readonly plan?: TradePlan;
}

interface ClosedBarPayload {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly openTime: number;
  readonly candle?: Candle;
}

export class SimulatedPositionManager {
  private readonly positions = new Map<string, ManagedPosition>();
  private readonly bus: EventBus;
  private readonly repo: PersistenceRepository;
  private readonly protection?: BrokerProtection;
  private readonly spreadModel?: SpreadSlippageModel;
  private readonly cache?: CandleCache;
  private readonly experienceMemory?: ExperienceMemory;
  private readonly log?: Logger;
  private readonly now: () => number;

  constructor(deps: SimulatedPositionManagerDeps) {
    this.bus = deps.bus;
    this.repo = deps.repo;
    this.protection = deps.protection;
    this.spreadModel = deps.spreadModel;
    this.cache = deps.cache;
    this.experienceMemory = deps.experienceMemory;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
  }

  get openPositions(): readonly TradeLifecycleState[] {
    return [...this.positions.values()].map((p) => p.lifecycle.state);
  }

  get openCount(): number {
    return this.positions.size;
  }

  getPosition(planId: string): TradeLifecycleState | undefined {
    return this.positions.get(planId)?.lifecycle.state;
  }

  /**
   * Restores an active position from persisted trade record upon cold start.
   */
  restorePosition(trade: Trade): TradeLifecycleState {
    const rawState: TradeLifecycleState = {
      planId: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      takeProfit1: trade.takeProfit1,
      takeProfit2: trade.takeProfit2,
      lotSize: trade.lotSize,
      state: trade.state,
      openedAt: trade.openedAt ?? trade.createdAt,
      closedAt: trade.closedAt,
      realizedPnl: trade.realizedPnl,
      exitReason: trade.exitReason,
    };

    const lifecycle = new TradeLifecycle(rawState, this.spreadModel);
    this.positions.set(trade.id, {
      planId: trade.id,
      symbol: trade.symbol,
      lifecycle,
      submittedBarTime: trade.openedAt ?? trade.createdAt,
      plan: trade,
    });

    return lifecycle.state;
  }

  attachToBus(): void {
    this.bus.on("trade.submitted", "simulated-position-manager", async (event: SystemEvent<unknown>) => {
      const fill = event.payload as Partial<SimulatedFill> | undefined;
      if (!fill || !fill.tradeId) return;
      await this.onTradeSubmitted(fill, event.timestamp);
    });

    this.bus.on("candle.closed", "simulated-position-manager", async (event: SystemEvent<unknown>) => {
      const payload = event.payload as Partial<ClosedBarPayload> | undefined;
      if (!payload || !payload.symbol) return;
      let candle: Candle | undefined = payload.candle;
      if (!candle && this.cache && payload.timeframe) {
        const series = this.cache.get(payload.symbol, payload.timeframe);
        if (payload.openTime !== undefined) {
          candle = series.find((c) => c.openTime === payload.openTime);
        }
        if (!candle && series.length > 0) {
          candle = series[series.length - 1];
        }
      }
      if (candle) {
        await this.onCandleClosed(payload.symbol, candle);
      }
    });
  }

  async onTradeSubmitted(fill: Partial<SimulatedFill>, timestamp: number): Promise<TradeLifecycleState> {
    const tradeId = fill.tradeId!;
    const plan = fill.plan;

    const stopLoss = fill.stopLoss ?? plan?.stopLoss ?? 0;
    const takeProfit1 = fill.takeProfit1 ?? plan?.takeProfit1 ?? 0;
    const takeProfit2 = fill.takeProfit2 ?? plan?.takeProfit2 ?? 0;

    const rawState: TradeLifecycleState = {
      planId: tradeId,
      symbol: fill.symbol ?? plan?.symbol ?? "XAUUSD",
      direction: fill.direction ?? plan?.direction ?? "LONG",
      entry: fill.entry ?? plan?.entry ?? 0,
      stopLoss,
      takeProfit1,
      takeProfit2,
      lotSize: fill.lotSize ?? plan?.lotSize ?? 0,
      state: "SUBMITTED",
    };

    const lifecycle = new TradeLifecycle(rawState, this.spreadModel);
    lifecycle.open(timestamp);

    // Register protective orders
    if (this.protection) {
      await safe(
        () =>
          this.protection!.protect({
            tradeId,
            symbol: rawState.symbol ?? "XAUUSD",
            side: rawState.direction,
            stopLoss: rawState.stopLoss,
            takeProfit: rawState.takeProfit1,
          }),
        this.log,
        "protect"
      );
    }

    // Publish trade.stateChanged
    await this.bus.publish({
      name: "trade.stateChanged",
      timestamp,
      payload: { tradeId, state: "OPEN", openedAt: rawState.openedAt },
    });

    // Update persistence
    if (plan) {
      const trade: Trade = {
        ...plan,
        entry: rawState.entry,
        state: "OPEN",
        openedAt: rawState.openedAt,
      };
      await safe(() => this.repo.updateTrade(trade), this.log, "updateTrade OPEN");
    }

    this.positions.set(tradeId, {
      planId: tradeId,
      symbol: rawState.symbol ?? "XAUUSD",
      lifecycle,
      submittedBarTime: timestamp,
      plan,
    });

    return lifecycle.state;
  }

  async onCandleClosed(symbol: Symbol | string, candle: Candle): Promise<TradeLifecycleState[]> {
    const updatedStates: TradeLifecycleState[] = [];

    for (const [id, pos] of this.positions.entries()) {
      if (pos.symbol !== symbol) continue;

      // No lookahead: a trade cannot be evaluated against its own entry bar
      if (candle.openTime <= pos.submittedBarTime) continue;

      const prevState = pos.lifecycle.state.state;
      const updated = pos.lifecycle.advance(candle);

      if (updated.state !== prevState) {
        updatedStates.push(updated);

        await this.bus.publish({
          name: "trade.stateChanged",
          timestamp: candle.openTime,
          payload: {
            tradeId: updated.planId,
            state: updated.state,
            exitReason: updated.exitReason,
          },
        });

        if (isTerminal(updated.state)) {
          if (this.protection) {
            await safe(() => this.protection!.release(updated.planId), this.log, "release");
          }

          const exitPrice = updated.state === "SL_HIT" ? updated.stopLoss : updated.takeProfit2;

          await this.bus.publish({
            name: "trade.closed",
            timestamp: candle.openTime,
            payload: {
              tradeId: updated.planId,
              realizedPnl: updated.realizedPnl ?? 0,
              exitPrice,
              exitReason: updated.exitReason,
              closedAt: updated.closedAt ?? candle.openTime,
            },
          });

          if (pos.plan) {
            const trade: Trade = {
              ...pos.plan,
              entry: updated.entry,
              state: updated.state,
              openedAt: updated.openedAt,
              closedAt: updated.closedAt,
              realizedPnl: updated.realizedPnl,
              exitReason: updated.exitReason,
            };
            await safe(() => this.repo.updateTrade(trade), this.log, "updateTrade terminal");

            const pnl = updated.realizedPnl ?? 0;
            const outcome = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "EVEN";
            const riskAmt = trade.riskAmount > 0 ? trade.riskAmount : 100;
            const realizedR = Math.round((pnl / riskAmt) * 100) / 100;

            const expRecord: TradeExperienceRecord = {
              id: `exp_${trade.id}`,
              setupId: trade.setupId ?? trade.id,
              symbol: trade.symbol,
              timeframe: trade.timeframe ?? "M5",
              direction: trade.direction,
              openedAt: trade.openedAt ?? trade.createdAt,
              closedAt: trade.closedAt ?? candle.openTime,
              factors: [],
              confluenceScore: trade.confluenceScore ?? 0,
              outcome,
              realizedR,
              realizedPnl: pnl,
            };

            if (this.experienceMemory) {
              this.experienceMemory.record(expRecord);
            }
            if (this.repo.saveExperienceRecord) {
              await safe(() => this.repo.saveExperienceRecord!(expRecord), this.log, "saveExperienceRecord");
            }
          }

          this.positions.delete(id);
        } else {
          // Non-terminal state progression (e.g. TP1_HIT runner)
          if (pos.plan) {
            const trade: Trade = {
              ...pos.plan,
              entry: updated.entry,
              state: updated.state,
              openedAt: updated.openedAt,
              realizedPnl: updated.realizedPnl,
              exitReason: updated.exitReason,
            };
            await safe(() => this.repo.updateTrade(trade), this.log, "updateTrade non-terminal");
          }
        }
      }
    }

    return updatedStates;
  }
}

async function safe(fn: () => Promise<void>, log: Logger | undefined, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (log) {
      log.warn(`simulated-position-manager ${label} failed (continuing)`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
