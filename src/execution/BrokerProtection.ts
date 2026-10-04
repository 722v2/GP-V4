import type { TradePlan } from "../core/types/Trade.js";

/**
 * Broker-side protective order abstraction. The pipeline records its intended
 * SL/TP with the venue so protection survives a process crash — a client-side
 * monitor alone is not sufficient. The concrete venue (broker REST) is external;
 * this boundary lets paper/simulated modes implement it in-process.
 */
export interface ProtectiveOrderSpec {
  readonly tradeId: string;
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly stopLoss: number;
  readonly takeProfit: number;
}

export interface BrokerProtection {
  readonly name: string;
  /** Places/refreshes server-side protective orders. Must be idempotent per tradeId. */
  protect(spec: ProtectiveOrderSpec): Promise<void>;
  /** Cancels protection (position flat). */
  release(tradeId: string): Promise<void>;
  /** Reads back the venue's view of protections — used by reconciliation. */
  list(): Promise<readonly ProtectiveOrderSpec[]>;
}

/** In-memory implementation used by PAPER_TRADING / BACKTEST / REPLAY. */
export class SimulatedProtection implements BrokerProtection {
  readonly name = "simulated";
  private orders = new Map<string, ProtectiveOrderSpec>();

  async protect(spec: ProtectiveOrderSpec): Promise<void> {
    this.orders.set(spec.tradeId, spec);
  }

  async release(tradeId: string): Promise<void> {
    this.orders.delete(tradeId);
  }

  async list(): Promise<readonly ProtectiveOrderSpec[]> {
    return [...this.orders.values()];
  }
}

export function protectionSpecFor(plan: TradePlan): ProtectiveOrderSpec {
  return {
    tradeId: plan.id,
    symbol: plan.symbol,
    side: plan.direction,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit1,
  };
}
