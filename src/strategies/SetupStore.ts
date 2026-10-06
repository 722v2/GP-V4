import type { Setup, SetupState } from "../core/types/Setup.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { TIMEFRAME_MS } from "../core/types/MarketTypes.js";

export interface ExpiryResult {
  readonly expired: readonly Setup[];
  readonly cleanedCount: number;
}

/**
 * In-memory setup store with lifecycle transitions and idempotency keyed on
 * setup id (strategy:symbol:timeframe:barOpenTime). Persisted store implements
 * this interface.
 */
export class SetupStore {
  private setups = new Map<string, Setup>();

  /** Returns true when the setup is new (id not seen before). */
  add(setup: Setup): boolean {
    if (this.setups.has(setup.id)) return false;
    this.setups.set(setup.id, setup);
    return true;
  }

  get(id: string): Setup | undefined {
    return this.setups.get(id);
  }

  all(): readonly Setup[] {
    return [...this.setups.values()];
  }

  byState(state: SetupState): readonly Setup[] {
    return this.all().filter((s) => s.state === state);
  }

  get count(): number {
    return this.setups.size;
  }

  /** Legal state machine: NEW→ACTIVE→(UPDATED|TRIGGERED|EXPIRED|INVALIDATED)→CLOSED. */
  private transitions: Record<SetupState, readonly SetupState[]> = {
    NEW: ["ACTIVE", "EXPIRED", "INVALIDATED"],
    ACTIVE: ["UPDATED", "TRIGGERED", "EXPIRED", "INVALIDATED"],
    UPDATED: ["UPDATED", "TRIGGERED", "EXPIRED", "INVALIDATED"],
    TRIGGERED: ["CLOSED"],
    EXPIRED: ["CLOSED"],
    INVALIDATED: ["CLOSED"],
    CLOSED: [],
  };

  transition(id: string, to: SetupState): Setup | null {
    const setup = this.setups.get(id);
    if (!setup) return null;
    if (!this.transitions[setup.state].includes(to)) return null;
    const next: Setup = { ...setup, state: to };
    this.setups.set(id, next);
    return next;
  }

  /**
   * Evaluates active non-terminal setups for the given symbol and timeframe.
   * Expire-eligible setups transition to EXPIRED exactly once.
   * Terminal setups (EXPIRED, INVALIDATED, TRIGGERED, CLOSED) are then removed
   * from the active in-memory collection.
   */
  expireAndCleanup(
    symbol: Symbol | string,
    timeframe: Timeframe,
    currentBarOpenTime: number,
    expiryBars: number
  ): ExpiryResult {
    const effectiveExpiryBars =
      Number.isFinite(expiryBars) && expiryBars >= 0 ? expiryBars : 6;

    const tfMs = TIMEFRAME_MS[timeframe as Timeframe];
    const expired: Setup[] = [];

    if (tfMs && tfMs > 0) {
      for (const setup of this.setups.values()) {
        if (setup.symbol !== symbol || setup.timeframe !== timeframe) {
          continue;
        }

        // Expiry applies ONLY to non-terminal active setups (NEW, ACTIVE, UPDATED)
        if (setup.state === "NEW" || setup.state === "ACTIVE" || setup.state === "UPDATED") {
          const elapsedBars = Math.floor((currentBarOpenTime - setup.barOpenTime) / tfMs);
          if (elapsedBars >= effectiveExpiryBars) {
            const transitioned = this.transition(setup.id, "EXPIRED");
            if (transitioned) {
              expired.push(transitioned);
            }
          }
        }
      }
    }

    // Clean terminal setups from active in-memory collection
    let cleanedCount = 0;
    for (const [id, setup] of this.setups.entries()) {
      if (
        setup.state === "EXPIRED" ||
        setup.state === "INVALIDATED" ||
        setup.state === "CLOSED" ||
        setup.state === "TRIGGERED"
      ) {
        this.setups.delete(id);
        cleanedCount += 1;
      }
    }

    return { expired, cleanedCount };
  }

  clear(): void {
    this.setups.clear();
  }

  /**
   * Restores active, non-terminal setups from persistence.
   * Never resurrects terminal setups (TRIGGERED, EXPIRED, INVALIDATED, CLOSED).
   */
  restore(setups: readonly Setup[]): void {
    for (const s of setups) {
      if (s.state === "NEW" || s.state === "ACTIVE" || s.state === "UPDATED") {
        this.setups.set(s.id, s);
      }
    }
  }
}
