import type { Setup, SetupState } from "../core/types/Setup.js";

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

  clear(): void {
    this.setups.clear();
  }
}
