import type { Direction } from "../core/types/Setup.js";
import type { Symbol } from "../core/types/MarketTypes.js";
import type { RiskState } from "./RiskEngine.js";
import type { EventBus } from "../core/events/EventBus.js";
import type { SystemEvent } from "../core/types/Events.js";

export interface TrackedPosition {
  readonly id: string;
  readonly symbol: Symbol | string;
  readonly direction: Direction;
  readonly entry: number;
  readonly lotSize: number;
  readonly openedAt: number;
}

export interface TradeClosedEventPayload {
  readonly tradeId: string;
  readonly realizedPnl: number;
  readonly exitPrice?: number;
  readonly exitReason?: string;
  readonly closedAt?: number;
}

export interface TradeSubmittedEventPayload {
  readonly tradeId: string;
  readonly lotSize: number;
  readonly entry: number;
  readonly symbol?: Symbol | string;
  readonly direction?: Direction;
}

export interface RiskTrackerOptions {
  readonly leverage?: number;
  readonly now?: () => number;
}

export interface RiskStateRestoreSnapshot {
  readonly openPositions?: readonly TrackedPosition[];
  readonly currentEquity?: number;
  readonly peakEquity?: number;
  readonly startingDailyEquity?: number;
  readonly startingWeeklyEquity?: number;
  readonly dailyRealizedPnl?: number;
  readonly weeklyRealizedPnl?: number;
  readonly maxDrawdownPct?: number;
}

function getUtcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getUtcWeekKey(timestamp: number): string {
  const d = new Date(timestamp);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

/**
 * Single-owner runtime tracker for RiskState.
 * Updates dynamic capacity (openTrades, netExposureLots, marginUsedPct)
 * and risk metrics (dailyLossPct, weeklyLossPct, maxDrawdownPct) as
 * trades are submitted, opened, and closed.
 */
export class RiskStateTracker {
  private initialEquity: number;
  private _currentEquity: number;
  private _peakEquity: number;
  private _startingDailyEquity: number;
  private _startingWeeklyEquity: number;
  private _dailyRealizedPnl: number = 0;
  private _weeklyRealizedPnl: number = 0;
  private _maxDrawdownPct: number = 0;
  private currentDayKey: string;
  private currentWeekKey: string;
  private readonly openPositions = new Map<string, TrackedPosition>();
  private readonly leverage: number;
  private readonly now: () => number;

  constructor(initialEquity: number, options: RiskTrackerOptions = {}) {
    if (!Number.isFinite(initialEquity) || initialEquity <= 0) {
      throw new Error(`Invalid initial equity: ${initialEquity}`);
    }
    this.initialEquity = initialEquity;
    this._currentEquity = initialEquity;
    this._peakEquity = initialEquity;
    this._startingDailyEquity = initialEquity;
    this._startingWeeklyEquity = initialEquity;
    this.leverage = options.leverage ?? 100;
    this.now = options.now ?? Date.now;
    const nowTime = this.now();
    this.currentDayKey = getUtcDayKey(nowTime);
    this.currentWeekKey = getUtcWeekKey(nowTime);
  }

  updateInitialEquity(newEquity: number): void {
    if (Number.isFinite(newEquity) && newEquity > 0) {
      const oldInitial = this.initialEquity;
      this.initialEquity = newEquity;
      if (this._currentEquity === oldInitial) {
        this._currentEquity = newEquity;
      }
      if (this._peakEquity === oldInitial) {
        this._peakEquity = newEquity;
      }
      if (this._startingDailyEquity === oldInitial) {
        this._startingDailyEquity = newEquity;
      }
      if (this._startingWeeklyEquity === oldInitial) {
        this._startingWeeklyEquity = newEquity;
      }
    }
  }

  get currentEquity(): number {
    return this._currentEquity;
  }

  get peakEquity(): number {
    return this._peakEquity;
  }

  get openPositionsCount(): number {
    return this.openPositions.size;
  }

  get openPositionsList(): readonly TrackedPosition[] {
    return [...this.openPositions.values()];
  }

  get dailyRealizedPnl(): number {
    return this._dailyRealizedPnl;
  }

  get weeklyRealizedPnl(): number {
    return this._weeklyRealizedPnl;
  }

  private rollWindowsIfNeeded(timestamp: number): void {
    const dayKey = getUtcDayKey(timestamp);
    if (dayKey !== this.currentDayKey) {
      this.currentDayKey = dayKey;
      this._dailyRealizedPnl = 0;
      this._startingDailyEquity = this._currentEquity;
    }

    const weekKey = getUtcWeekKey(timestamp);
    if (weekKey !== this.currentWeekKey) {
      this.currentWeekKey = weekKey;
      this._weeklyRealizedPnl = 0;
      this._startingWeeklyEquity = this._currentEquity;
    }
  }

  /**
   * Records a newly opened position (idempotent by pos.id).
   */
  recordTradeOpened(pos: TrackedPosition): void {
    if (this.openPositions.has(pos.id)) return;
    this.rollWindowsIfNeeded(pos.openedAt);
    this.openPositions.set(pos.id, pos);
  }

  /**
   * Records a position closure and updates realized PnL and drawdown.
   */
  recordTradeClosed(tradeId: string, realizedPnl: number, closedAt?: number): void {
    const timestamp = closedAt ?? this.now();
    this.rollWindowsIfNeeded(timestamp);
    this.openPositions.delete(tradeId);
    this.applyRealizedPnl(realizedPnl);
  }

  /**
   * Directly records realized PnL (e.g. from manual/broker closure).
   */
  recordRealizedPnl(realizedPnl: number, timestamp?: number): void {
    const t = timestamp ?? this.now();
    this.rollWindowsIfNeeded(t);
    this.applyRealizedPnl(realizedPnl);
  }

  private applyRealizedPnl(realizedPnl: number): void {
    this._dailyRealizedPnl += realizedPnl;
    this._weeklyRealizedPnl += realizedPnl;
    this._currentEquity += realizedPnl;

    if (this._currentEquity > this._peakEquity) {
      this._peakEquity = this._currentEquity;
    }

    if (this._peakEquity > 0) {
      const drawdownUsd = Math.max(0, this._peakEquity - this._currentEquity);
      const currentDdPct = (drawdownUsd / this._peakEquity) * 100;
      if (currentDdPct > this._maxDrawdownPct) {
        this._maxDrawdownPct = Math.round(currentDdPct * 100) / 100;
      }
    }
  }

  /**
   * Produces an immutable RiskState snapshot matching current open positions
   * and loss/drawdown metrics.
   */
  get state(): RiskState {
    const nowTime = this.now();
    this.rollWindowsIfNeeded(nowTime);

    const openTrades = this.openPositions.size;

    let longLots = 0;
    let shortLots = 0;
    let totalMarginRequired = 0;

    for (const pos of this.openPositions.values()) {
      if (pos.direction === "LONG") {
        longLots += pos.lotSize;
      } else {
        shortLots += pos.lotSize;
      }
      // For XAUUSD: 1 standard lot = 100 oz. Notional = entry * 100 * lotSize.
      // Margin required = Notional / leverage. At leverage 100, margin = entry * lotSize.
      const marginForPos = (pos.entry * 100 * pos.lotSize) / this.leverage;
      totalMarginRequired += marginForPos;
    }

    const netExposureLots = Math.round(Math.abs(longLots - shortLots) * 100) / 100;

    let marginUsedPct = 0;
    if (this._currentEquity > 0) {
      marginUsedPct = Math.round(((totalMarginRequired / this._currentEquity) * 100) * 100) / 100;
    } else if (openTrades > 0) {
      marginUsedPct = 100;
    }

    const dailyDenominator = this._startingDailyEquity > 0 ? this._startingDailyEquity : this.initialEquity;
    const dailyLossPct = this._dailyRealizedPnl < 0
      ? Math.round(((-this._dailyRealizedPnl) / dailyDenominator) * 100 * 100) / 100
      : 0;

    const weeklyDenominator = this._startingWeeklyEquity > 0 ? this._startingWeeklyEquity : this.initialEquity;
    const weeklyLossPct = this._weeklyRealizedPnl < 0
      ? Math.round(((-this._weeklyRealizedPnl) / weeklyDenominator) * 100 * 100) / 100
      : 0;

    return {
      openTrades,
      netExposureLots,
      marginUsedPct,
      dailyLossPct,
      weeklyLossPct,
      maxDrawdownPct: this._maxDrawdownPct,
    };
  }

  /**
   * Attaches to the EventBus to listen for trade submissions and closures.
   */
  attachToBus(bus: EventBus): void {
    bus.on("trade.submitted", "risk-tracker", (event: SystemEvent<unknown>) => {
      const payload = event.payload as Partial<TradeSubmittedEventPayload> | undefined;
      if (!payload || !payload.tradeId) return;
      this.recordTradeOpened({
        id: payload.tradeId,
        symbol: payload.symbol ?? "XAUUSD",
        direction: payload.direction ?? "LONG",
        entry: payload.entry ?? 0,
        lotSize: payload.lotSize ?? 0,
        openedAt: event.timestamp,
      });
    });

    bus.on("trade.closed", "risk-tracker", (event: SystemEvent<unknown>) => {
      const payload = event.payload as Partial<TradeClosedEventPayload> | undefined;
      if (!payload || !payload.tradeId) return;
      this.recordTradeClosed(
        payload.tradeId,
        payload.realizedPnl ?? 0,
        event.timestamp
      );
    });
  }

  /**
   * Restores tracker state from persisted data upon startup.
   */
  restore(snapshot: RiskStateRestoreSnapshot): void {
    if (snapshot.openPositions) {
      this.openPositions.clear();
      for (const pos of snapshot.openPositions) {
        this.openPositions.set(pos.id, pos);
      }
    }
    if (snapshot.currentEquity !== undefined) this._currentEquity = snapshot.currentEquity;
    if (snapshot.peakEquity !== undefined) this._peakEquity = snapshot.peakEquity;
    if (snapshot.startingDailyEquity !== undefined) this._startingDailyEquity = snapshot.startingDailyEquity;
    if (snapshot.startingWeeklyEquity !== undefined) this._startingWeeklyEquity = snapshot.startingWeeklyEquity;
    if (snapshot.dailyRealizedPnl !== undefined) this._dailyRealizedPnl = snapshot.dailyRealizedPnl;
    if (snapshot.weeklyRealizedPnl !== undefined) this._weeklyRealizedPnl = snapshot.weeklyRealizedPnl;
    if (snapshot.maxDrawdownPct !== undefined) this._maxDrawdownPct = snapshot.maxDrawdownPct;
  }

  /**
   * Resets tracker state to new initial equity (useful for testing or session reset).
   */
  reset(newEquity?: number): void {
    const eq = newEquity ?? this.initialEquity;
    this._currentEquity = eq;
    this._peakEquity = eq;
    this._startingDailyEquity = eq;
    this._startingWeeklyEquity = eq;
    this._dailyRealizedPnl = 0;
    this._weeklyRealizedPnl = 0;
    this._maxDrawdownPct = 0;
    this.openPositions.clear();
    const nowTime = this.now();
    this.currentDayKey = getUtcDayKey(nowTime);
    this.currentWeekKey = getUtcWeekKey(nowTime);
  }
}
