import type { Candle } from "../core/types/Candle.js";
import type { Direction } from "../core/types/Setup.js";
import type { TradePlan, TradeState } from "../core/types/Trade.js";
import type { RiskConfig } from "../risk/RiskEngine.js";
import { evaluateRisk } from "../risk/RiskEngine.js";
import { ConfluenceEngine } from "../strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../strategies/StrongCandleStrategy.js";
import { SetupStore } from "../strategies/SetupStore.js";
import { StructureEngine } from "../strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../strategies/engines/PriceActionEngine.js";
import type { RiskEnvironment } from "../risk/RiskEngine.js";

/**
 * Models the spread, slippage, and latency that separate a paper fill from a
 * theoretical one. LONG entries pay up (fill above mid), SHORT entries fill below.
 */
export class SpreadSlippageModel {
  constructor(
    private readonly spreadPoints: number,
    private readonly slippagePoints: number,
    private readonly latencyMs: number
  ) {}

  get latency(): number {
    return this.latencyMs;
  }

  adjustedFill(direction: Direction, price: number): number {
    const cost = this.spreadPoints + this.slippagePoints;
    return direction === "LONG" ? price + cost : price - cost;
  }
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

export interface TradeLifecycleState {
  readonly planId: string;
  readonly direction: Direction;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly lotSize: number;
  state: TradeState;
  openedAt?: number;
  closedAt?: number;
  realizedPnl?: number;
  exitReason?: string;
}

function isTerminal(state: TradeState): boolean {
  return state === "TP2_HIT" || state === "SL_HIT" || state === "MANUALLY_CLOSED" || state === "REJECTED" || state === "EXPIRED";
}

/**
 * Advances a single position bar-by-bar using intrabar extremes. LONG stops and
 * targets are checked against low/high; SHORT reversed. Conservative ordering
 * (stop before target when both are inside one bar) avoids lookahead bias.
 */
export class TradeLifecycle {
  constructor(
    public readonly state: TradeLifecycleState,
    private readonly model: SpreadSlippageModel
  ) {}

  advance(bar: Candle): TradeLifecycleState {
    if (isTerminal(this.state.state) || this.state.state === "PLANNED" || this.state.state === "SUBMITTED") {
      if (this.state.state === "PLANNED" || this.state.state === "SUBMITTED") {
        this.state.state = "OPEN";
        this.state.openedAt = bar.openTime;
      } else {
        return this.state;
      }
    }
    const s = this.state;
    const long = s.direction === "LONG";

    // Conservative: if the bar could hit both SL and TP1, assume SL first.
    const hitSl = long ? bar.low <= s.stopLoss : bar.high >= s.stopLoss;
    const hitTp2 = long ? bar.high >= s.takeProfit2 : bar.low <= s.takeProfit2;
    const hitTp1 = long ? bar.high >= s.takeProfit1 : bar.low <= s.takeProfit1;

    if (hitSl) {
      s.state = "SL_HIT";
      s.exitReason = "stop loss";
      s.realizedPnl = pnl(s, s.stopLoss);
    } else if (hitTp2) {
      s.state = "TP2_HIT";
      s.exitReason = "take profit 2";
      s.realizedPnl = pnl(s, s.takeProfit2);
    } else if (hitTp1 && s.state !== "TP1_HIT") {
      s.state = "TP1_HIT";
      s.exitReason = "take profit 1 (runner)";
      s.realizedPnl = pnl(s, s.takeProfit1);
    }
    if (isTerminal(s.state)) s.closedAt = bar.openTime;
    void this.model;
    return s;
  }
}

function pnl(s: TradeLifecycleState, exit: number): number {
  const diff = s.direction === "LONG" ? exit - s.entry : s.entry - exit;
  return diff * 100 * s.lotSize;
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

  constructor(
    private readonly fixtures: readonly Candle[],
    private readonly store: BacktestStore,
    private readonly model: SpreadSlippageModel,
    private readonly risk: RiskConfig,
    private readonly warmupBars = 5,
    private readonly riskEnv: RiskEnvironment = { equity: risk.accountEquity, state: { openTrades: 0, netExposureLots: 0, marginUsedPct: 0, dailyLossPct: 0, weeklyLossPct: 0, maxDrawdownPct: 0 }, killSwitch: "NONE" }
  ) {}

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
    const timeframe = sorted[0]?.timeframe ?? "M5";

    for (let i = this.warmupBars; i < sorted.length; i++) {
      const current = sorted[i]!;
      // Only bars whose closeTime <= current bar's close are visible — no lookahead.
      const candlesSeen = this.store.viewAsOf(current.closeTime);
      const outcome = await decide({ symbol, timeframe, candles: candlesSeen });
      cycles.push({ index: i, outcome, candlesSeen });

      if (outcome.action.kind === "EXECUTED_SIMULATED") {
        const fill = this.model.adjustedFill((outcome.setup as { direction: Direction }).direction, current.close);
        const plan: TradePlan = {
          id: `bt:${current.openTime}`,
          signalId: `bt-signal:${current.openTime}`,
          symbol: symbol as TradePlan["symbol"],
          direction: (outcome.setup as { direction: Direction }).direction,
          entry: fill,
          stopLoss: (outcome.setup as { stopLoss: number }).stopLoss,
          takeProfit1: (outcome.setup as { takeProfit1: number }).takeProfit1,
          takeProfit2: (outcome.setup as { takeProfit2: number }).takeProfit2,
          lotSize: (outcome as { lotSize?: number }).lotSize ?? 0.05,
          riskAmount: this.risk.accountEquity * (this.risk.perTradePct / 100),
          mode: "BACKTEST",
          createdAt: current.openTime,
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
      }

      // Advance every open lifecycle with the current (just-closed) bar.
      for (const lc of this.store.liveTrades()) {
        new TradeLifecycle(lc, this.model).advance(current);
      }
    }

    this.store.closed.push(...this.store.lifecycles.filter((l) => isTerminal(l.state)));
    return { cycles, simulatedFills, store: this.store };
  }

  /** The default decision path: confluence -> strategy -> risk, with AI skipped (replayable offline). */
  private async decideDefault(ctx: { symbol: string; timeframe: string; candles: readonly Candle[] }): Promise<BacktestCycle["outcome"]> {
    const engineCtx = { symbol: ctx.symbol, timeframe: ctx.candles[0]?.timeframe ?? "M5", candles: ctx.candles };
    const conf = this.confluence.evaluate(engineCtx as Parameters<typeof this.confluence.evaluate>[0]);
    const setup = this.strategy.evaluate(engineCtx as Parameters<typeof this.strategy.evaluate>[0], conf.direction);
    const last = ctx.candles[ctx.candles.length - 1];
    const base = { symbol: ctx.symbol, timeframe: engineCtx.timeframe, barOpenTime: last?.openTime ?? 0, setup };
    if (!setup) return { ...base, action: { kind: "NO_SETUP" } };
    const risk = evaluateRisk(this.risk, this.riskEnv, setup, setup.direction);
    if (risk.verdict !== "APPROVED") return { ...base, action: { kind: "RISK_REJECTED" } };
    return { ...base, action: { kind: "EXECUTED_SIMULATED" }, lotSize: risk.lotSize } as unknown as BacktestCycle["outcome"];
  }
}
