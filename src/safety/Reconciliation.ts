import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { BrokerProtection } from "../execution/BrokerProtection.js";

export interface ReconciledMismatch {
  readonly tradeId: string;
  readonly kind: "MISSING_PROTECTION" | "PROTECTION_WITHOUT_TRADE" | "PRICE_DRIFT" | "STATE_STALE";
  readonly detail: string;
}

/**
 * Reconciliation boundary: compares the local trade book against the venue's
 * protective orders and flags mismatches for alerting. The live-broker leg is a
 * stub until the venue contract is provided; the simulated leg is complete.
 */
export class ReconciliationService {
  constructor(private readonly protection: BrokerProtection) {}

  async reconcile(localTrades: readonly Trade[], tolerance: number): Promise<readonly ReconciledMismatch[]> {
    const mismatches: ReconciledMismatch[] = [];
    const venueOrders = await this.protection.list();
    const venueByTrade = new Map(venueOrders.map((o) => [o.tradeId, o]));

    const openLocal = localTrades.filter((t) => t.state === "OPEN" || t.state === "TP1_HIT");
    for (const t of openLocal) {
      const order = venueByTrade.get(t.id);
      if (!order) {
        mismatches.push({ tradeId: t.id, kind: "MISSING_PROTECTION", detail: "open trade has no venue protective order" });
        continue;
      }
      if (Math.abs(order.stopLoss - t.stopLoss) > tolerance) {
        mismatches.push({
          tradeId: t.id,
          kind: "PRICE_DRIFT",
          detail: `venue SL ${order.stopLoss} vs local SL ${t.stopLoss}`,
        });
      }
    }

    for (const o of venueOrders) {
      if (!openLocal.some((t) => t.id === o.tradeId)) {
        mismatches.push({ tradeId: o.tradeId, kind: "PROTECTION_WITHOUT_TRADE", detail: "venue protective order for unknown/flat trade" });
      }
    }

    return mismatches;
  }

  /** Auto-heal where safe: (re)place protection for open trades missing it. */
  async repair(localTrades: readonly Trade[]): Promise<number> {
    const openLocal = localTrades.filter((t) => t.state === "OPEN" || t.state === "TP1_HIT");
    const venueOrders = await this.protection.list();
    const venueIds = new Set(venueOrders.map((o) => o.tradeId));
    let repaired = 0;
    for (const t of openLocal) {
      if (venueIds.has(t.id)) continue;
      await this.protection.protect({
        tradeId: t.id,
        symbol: t.symbol,
        side: t.direction,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit1,
      });
      repaired += 1;
    }
    return repaired;
  }
}

export function planToTrade(plan: TradePlan, state: Trade["state"] = "OPEN"): Trade {
  return { ...plan, state, openedAt: plan.createdAt };
}
