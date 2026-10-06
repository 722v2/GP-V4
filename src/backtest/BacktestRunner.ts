import type { Candle } from "../core/types/Candle.js";
import type { Direction } from "../core/types/Setup.js";
import type { TradePlan, TradeState } from "../core/types/Trade.js";
import type { RiskConfig } from "../risk/RiskEngine.js";
import { evaluateRisk } from "../risk/RiskEngine.js";
import { RiskStateTracker } from "../risk/RiskStateTracker.js";
import { ConfluenceEngine } from "../strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../strategies/StrongCandleStrategy.js";
import { SetupStore } from "../strategies/SetupStore.js";
import { StructureEngine } from "../strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../strategies/engines/PriceActionEngine.js";
import type { RiskEnvironment } from "../risk/RiskEngine.js";
import {
  SpreadSlippageModel,
  TradeLifecycle,
  type TradeLifecycleState,
  isTerminal,
} from "../execution/TradeLifecycle.js";

export { SpreadSlippageModel, TradeLifecycle, type TradeLifecycleState, isTerminal };

export interface BacktestPerformanceMetrics {
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly evenTrades: number;
  readonly winRate: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly netProfit: number;
  readonly profitFactor: number | null;
  readonly expectancy: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPct: number;
}

export function calculatePerformanceMetrics(
  closedTrades: readonly TradeLifecycleState[],
  initialEquity: number
): BacktestPerformanceMetrics {
  const totalTrades = closedTrades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let evenTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const trade of closedTrades) {
    const pnl = trade.realizedPnl ?? 0;
    if (!Number.isFinite(pnl)) {
      evenTrades += 1;
      continue;
    }
    if (pnl > 0) {
      winningTrades += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losingTrades += 1;
      grossLoss += Math.abs(pnl);
    } else {
      evenTrades += 1;
    }
  }

  const netProfit = grossProfit - grossLoss;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const expectancy = totalTrades > 0 ? netProfit / totalTrades : 0;

  let profitFactor: number | null = null;
  if (grossLoss > 0) {
    profitFactor = grossProfit / grossLoss;
  } else if (grossProfit > 0) {
    profitFactor = null;
  } else {
    profitFactor = null;
  }

  let currentEquity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  const sortedTrades = [...closedTrades].sort(
    (a, b) => (a.closedAt ?? a.openedAt ?? 0) - (b.closedAt ?? b.openedAt ?? 0)
  );

  for (const trade of sortedTrades) {
    const pnl = trade.realizedPnl ?? 0;
    if (Number.isFinite(pnl)) {
      currentEquity += pnl;
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const dd = peakEquity - currentEquity;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        if (peakEquity > 0) {
          maxDrawdownPct = (maxDrawdown / peakEquity) * 100;
        }
      }
    }
  }

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    evenTrades,
    winRate: Math.round(winRate * 10000) / 10000,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    profitFactor: profitFactor !== null ? Math.round(profitFactor * 100) / 100 : null,
    expectancy: Math.round(expectancy * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
  };
}

/** Append-only candle store that preserves temporal ordering for replay. */
export class BacktestStore {
  readonly candles: Candle[] = [];
  readonly plans: TradePlan[] = [];
  readonly closed: TradeLifecycleState[] = [];
  private readonly seen = new Set<number>();

  appendBatch(batch: readonly Candle[]): { duplicate: boolean; added: number } {
    let added = 0;
    let duplicate = false;
    for (const c of batch) {
      if (this.seen.has(c.openTime)) {
        duplicate = true;
        continue;
      }
      this.seen.add(c.openTime);
      this.candles.push(c);
      added += 1;
    }
    return { duplicate, added };
  }

  /** Closed bars visible at (and before) asOf — the no-lookahead view. */
  viewAsOf(asOf: number): Candle[] {
    return this.candles.filter((c) => c.closeTime <= asOf);
  }

  liveTrades(): TradeLifecycleState[] {
    return this.lifecycles.filter((l) => !isTerminal(l.state));
  }

  readonly lifecycles: TradeLifecycleState[] = [];
}

export interface BacktestCycle {
  readonly index: number;
  readonly outcome: {
    symbol: string;
    timeframe: string;
    barOpenTime: number;
    setup: unknown;
    action: { kind: string };
  };
  /** Exactly the candles visible at decision time (closeTime <= this bar's close). */
  readonly candlesSeen: readonly Candle[];
}

export interface BacktestResult {
  readonly cycles: BacktestCycle[];
  readonly simulatedFills: readonly TradeLifecycleState[];
  readonly store: BacktestStore;
  readonly metrics: BacktestPerformanceMetrics;
}

/**
 * Deterministic backtest: steps a virtual clock bar-by-bar, feeds ONLY closed
 * bars up to the current bar to the decision function, and simulates fills with
 * the spread/slippage model. No lookahead by construction.
 */
export class BacktestRunner {
  private readonly confluence = new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]);
  private readonly strategy = new StrongCandleStrategy();
  private readonly setups = new SetupStore();
  private readonly tracker: RiskStateTracker;

  constructor(
    private readonly fixtures: readonly Candle[],
    private readonly store: BacktestStore,
    private readonly model: SpreadSlippageModel,
    private readonly risk: RiskConfig,
    private readonly warmupBars = 5,
    riskEnv?: RiskEnvironment
  ) {
    this.tracker = new RiskStateTracker(risk.accountEquity);
    if (riskEnv?.state) {
      this.tracker.restore({
        currentEquity: riskEnv.equity,
        dailyRealizedPnl: (riskEnv.state.dailyLossPct * risk.accountEquity) / -100,
        weeklyRealizedPnl: (riskEnv.state.weeklyLossPct * risk.accountEquity) / -100,
        maxDrawdownPct: riskEnv.state.maxDrawdownPct,
      });
    }
  }

  /** Runs the full deterministic decision path over the fixtures. */
  async run(): Promise<BacktestResult> {
    return this.runWith(this.decideDefault.bind(this));
  }

  async runWith(
    decide: (ctx: { symbol: string; timeframe: string; candles: readonly Candle[] }) => Promise<BacktestCycle["outcome"]>
  ): Promise<BacktestResult> {
    const cycles: BacktestCycle[] = [];
    const simulatedFills: TradeLifecycleState[] = [];
    const sorted = [...this.fixtures].sort((a, b) => a.openTime - b.openTime);
    this.store.appendBatch(sorted);

    const symbol = sorted[0]?.symbol ?? "XAUUSD";
    const timeframe = sorted[0]?.timeframe ?? "M1";

    for (let i = this.warmupBars; i < sorted.length; i++) {
      const current = sorted[i]!;

      // 1. Advance existing open positions against current bar
      for (const lc of this.store.liveTrades()) {
        const prevState = lc.state;
        const prevPnl = lc.realizedPnl ?? 0;
        new TradeLifecycle(lc, this.model).advance(current);

        if (lc.state !== prevState) {
          const deltaPnl = (lc.realizedPnl ?? 0) - prevPnl;
          if (lc.state === "TP1_HIT") {
            this.tracker.recordRealizedPnl(deltaPnl, current.openTime);
          } else if (isTerminal(lc.state)) {
            this.tracker.recordTradeClosed(lc.planId, deltaPnl, current.openTime);
          }
        }
      }

      // 2. Evaluate decision on closed bars visible at current bar closeTime
      const candlesSeen = this.store.viewAsOf(current.closeTime);
      const outcome = await decide({ symbol, timeframe, candles: candlesSeen });
      cycles.push({ index: i, outcome, candlesSeen });

      // 3. Entry timing: Fill at NEXT candle open (bar i+1) if simulated execution approved
      if (outcome.action.kind === "EXECUTED_SIMULATED") {
        const setup = outcome.setup as { direction: Direction; stopLoss: number; takeProfit1: number; takeProfit2: number };
        const nextBar = i + 1 < sorted.length ? sorted[i + 1]! : null;
        if (nextBar) {
          const fillEntry = this.model.adjustedFill(setup.direction, nextBar.open);
          const plan: TradePlan = {
            id: `bt:${nextBar.openTime}`,
            signalId: `bt-signal:${nextBar.openTime}`,
            symbol: symbol as TradePlan["symbol"],
            direction: setup.direction,
            entry: fillEntry,
            stopLoss: setup.stopLoss,
            takeProfit1: setup.takeProfit1,
            takeProfit2: setup.takeProfit2,
            lotSize: (outcome as { lotSize?: number }).lotSize ?? 0.05,
            riskAmount: this.tracker.currentEquity * (this.risk.perTradePct / 100),
            mode: "BACKTEST",
            createdAt: nextBar.openTime,
          };
          this.store.plans.push(plan);
          const lifecycleState: TradeLifecycleState = {
            planId: plan.id,
            direction: plan.direction,
            entry: plan.entry,
            stopLoss: plan.stopLoss,
            takeProfit1: plan.takeProfit1,
            takeProfit2: plan.takeProfit2,
            lotSize: plan.lotSize,
            state: "SUBMITTED",
          };
          this.store.lifecycles.push(lifecycleState);
          simulatedFills.push(lifecycleState);
          this.tracker.recordTradeOpened({
            id: plan.id,
            symbol: plan.symbol,
            direction: plan.direction,
            entry: plan.entry,
            lotSize: plan.lotSize,
            openedAt: nextBar.openTime,
          });
        }
      }
    }

    const closedTrades = this.store.lifecycles.filter((l) => isTerminal(l.state));
    this.store.closed.push(...closedTrades);
    const metrics = calculatePerformanceMetrics(closedTrades, this.risk.accountEquity);

    return { cycles, simulatedFills, store: this.store, metrics };
  }

  /** The default decision path: confluence -> strategy -> risk, with AI skipped (replayable offline). */
  private async decideDefault(ctx: { symbol: string; timeframe: string; candles: readonly Candle[] }): Promise<BacktestCycle["outcome"]> {
    const engineCtx = { symbol: ctx.symbol, timeframe: ctx.candles[0]?.timeframe ?? "M1", candles: ctx.candles };
    const conf = this.confluence.evaluate(engineCtx as Parameters<typeof this.confluence.evaluate>[0]);
    const setup = this.strategy.evaluate(engineCtx as Parameters<typeof this.strategy.evaluate>[0], conf.direction);
    const last = ctx.candles[ctx.candles.length - 1];
    const base = { symbol: ctx.symbol, timeframe: engineCtx.timeframe, barOpenTime: last?.openTime ?? 0, setup };
    if (!setup) return { ...base, action: { kind: "NO_SETUP" } };

    const env: RiskEnvironment = {
      equity: this.tracker.currentEquity,
      state: this.tracker.state,
      killSwitch: "NONE",
      mode: "BACKTEST",
    };
    const risk = evaluateRisk(this.risk, env, setup, setup.direction, "BACKTEST");
    if (risk.verdict !== "APPROVED") return { ...base, action: { kind: "RISK_REJECTED" } };
    return { ...base, action: { kind: "EXECUTED_SIMULATED" }, lotSize: risk.lotSize } as unknown as BacktestCycle["outcome"];
  }
}
