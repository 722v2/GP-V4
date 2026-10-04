import type { z } from "zod";
import type { KillSwitchLevel } from "../core/types/Risk.js";
import { KILL_SWITCH_SCHEMA } from "../core/types/Risk.js";

export type KillSwitchState = z.infer<typeof KILL_SWITCH_SCHEMA>;

/**
 * Kill switch with persistent state. Levels:
 *   L1 — warning: alerts only, trading continues
 *   L2 — halt new entries, existing positions are managed
 *   L3 — full halt, flatten consideration
 * Escalation is monotonic (manual de-escalation only, recorded).
 */
export class KillSwitch {
  private state: KillSwitchState = {
    level: "NONE",
    reason: "",
    updatedAt: 0,
    updatedBy: "system",
    active: false,
  };

  constructor(
    private readonly persist: (state: KillSwitchState) => Promise<void> = async () => {},
    private readonly now: () => number = Date.now
  ) {}

  get current(): Readonly<KillSwitchState> {
    return this.state;
  }

  get level(): KillSwitchLevel {
    return this.state.level;
  }

  /** Restores persisted state (e.g. after a restart). */
  restore(saved: KillSwitchState): void {
    this.state = { ...saved };
  }

  /** Escalates if the proposed level is higher than the current one. */
  async escalate(level: KillSwitchLevel, reason: string, updatedBy = "system"): Promise<KillSwitchState> {
    if (rank(level) <= rank(this.state.level)) return this.state;
    this.state = {
      level,
      reason,
      updatedAt: this.now(),
      updatedBy,
      active: level !== "NONE",
    };
    await this.persist(this.state);
    return this.state;
  }

  /** De-escalation is manual: requires explicit reset with a reason. */
  async reset(reason: string, updatedBy: string): Promise<KillSwitchState> {
    this.state = {
      level: "NONE",
      reason,
      updatedAt: this.now(),
      updatedBy,
      active: false,
    };
    await this.persist(this.state);
    return this.state;
  }
}

function rank(level: KillSwitchLevel): number {
  return { NONE: 0, L1: 1, L2: 2, L3: 3 }[level];
}
