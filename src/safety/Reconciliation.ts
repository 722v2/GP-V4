import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { BrokerProtection } from "../execution/BrokerProtection.js";
import type { PersistenceRepository } from "../persistence/Persistence.js";
import type { KillSwitch } from "../risk/KillSwitch.js";
import type { KillSwitchLevel } from "../core/types/Risk.js";
import type { RiskStateTracker } from "../risk/RiskStateTracker.js";
import type { SetupStore } from "../strategies/SetupStore.js";
import type { SimulatedPositionManager } from "../execution/SimulatedPositionManager.js";
import type { IdempotencyGuard } from "./IdempotencyGuard.js";
import type { Logger } from "../core/logging/Logger.js";
import { isTerminal } from "../execution/TradeLifecycle.js";

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

export interface StartupReconciliationParams {
  readonly repo: PersistenceRepository;
  readonly killSwitch: KillSwitch;
  readonly riskTracker: RiskStateTracker;
  readonly setupStore: SetupStore;
  readonly positionManager?: SimulatedPositionManager;
  readonly protection: BrokerProtection;
  readonly reconciliation: ReconciliationService;
  readonly idempotency?: IdempotencyGuard;
  readonly tolerance?: number;
  readonly log?: Logger;
  readonly now?: () => number;
}

export interface StartupReconciliationResult {
  readonly success: boolean;
  readonly openTradesRestored: number;
  readonly activeSetupsRestored: number;
  readonly killSwitchRestored: boolean;
  readonly killSwitchLevel: KillSwitchLevel;
  readonly repairsAttempted: number;
  readonly remainingMismatches: readonly ReconciledMismatch[];
}

/**
 * Executes startup restoration and reconciliation following the strict lifecycle ordering:
 * 1. Restore KillSwitch (escalation preserved, never downgraded).
 * 2. Restore open trades & active setups.
 * 3. Reconstruct RiskStateTracker (positions, capacity, daily PnL).
 * 4. Run Reconciliation against venue protections.
 * 5. Safely repair missing protections; if inconsistencies remain, escalate KillSwitch to L2 to block new orders.
 */
export async function runStartupReconciliation(
  params: StartupReconciliationParams
): Promise<StartupReconciliationResult> {
  const log = params.log;
  const now = params.now ? params.now() : Date.now();

  // 1. Restore KillSwitch state (escalation is preserved; never silently downgraded)
  const savedKs = await params.repo.getKillSwitchState();
  let killSwitchRestored = false;
  if (savedKs) {
    params.killSwitch.restore(savedKs);
    killSwitchRestored = true;
    log?.info("restored KillSwitch from persistence", { level: savedKs.level, reason: savedKs.reason });
  }

  // 2. Restore open trades / active setups
  const openTrades = await params.repo.getOpenTrades();
  const activeTrades = openTrades.filter((t) => !isTerminal(t.state));

  if (params.positionManager) {
    for (const trade of activeTrades) {
      params.positionManager.restorePosition(trade);
    }
  }

  const activeSetups = await params.repo.getActiveSetups();
  const validSetups = activeSetups.filter(
    (s) => s.state === "NEW" || s.state === "ACTIVE" || s.state === "UPDATED"
  );
  params.setupStore.restore(validSetups);

  if (params.idempotency) {
    for (const s of validSetups) {
      params.idempotency.claim(s.symbol, s.timeframe, s.barOpenTime);
    }
  }

  // 3. Reconstruct RiskStateTracker
  for (const trade of activeTrades) {
    params.riskTracker.recordTradeOpened({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry: trade.entry,
      lotSize: trade.lotSize,
      openedAt: trade.openedAt ?? trade.createdAt,
    });
  }

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const closedToday = await params.repo.getClosedTrades(startOfDay.getTime());
  for (const trade of closedToday) {
    if (trade.realizedPnl != null) {
      params.riskTracker.recordRealizedPnl(trade.realizedPnl, trade.closedAt);
    }
  }

  // 4. Initialize & run reconciliation against venue protections
  const tolerance = params.tolerance ?? 0.5;
  let mismatches = await params.reconciliation.reconcile(activeTrades, tolerance);

  // 5. Attempt safe repair if mismatches exist (e.g. MISSING_PROTECTION)
  let repairsAttempted = 0;
  if (mismatches.length > 0) {
    repairsAttempted = await params.reconciliation.repair(activeTrades);
    mismatches = await params.reconciliation.reconcile(activeTrades, tolerance);
  }

  // If mismatches remain after safe repair, block new order origination by escalating KillSwitch to L2
  if (mismatches.length > 0) {
    log?.error("reconciliation mismatches remain after repair", {
      count: mismatches.length,
      mismatches,
    });
    await params.killSwitch.escalate(
      "L2",
      `reconciliation mismatch: ${mismatches.map((m) => `${m.kind} on ${m.tradeId}`).join("; ")}`
    );
    return {
      success: false,
      openTradesRestored: activeTrades.length,
      activeSetupsRestored: validSetups.length,
      killSwitchRestored,
      killSwitchLevel: params.killSwitch.level,
      repairsAttempted,
      remainingMismatches: mismatches,
    };
  }

  log?.info("startup reconciliation complete and consistent", {
    openTrades: activeTrades.length,
    activeSetups: validSetups.length,
    killSwitchLevel: params.killSwitch.level,
    repairsAttempted,
  });

  return {
    success: true,
    openTradesRestored: activeTrades.length,
    activeSetupsRestored: validSetups.length,
    killSwitchRestored,
    killSwitchLevel: params.killSwitch.level,
    repairsAttempted,
    remainingMismatches: [],
  };
}
