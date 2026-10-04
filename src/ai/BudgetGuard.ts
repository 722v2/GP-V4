import type { AiUsage } from "../core/types/AiDecision.js";

export interface BudgetConfig {
  hourlyBudgetUsd: number;
  dailyBudgetUsd: number;
}

/** Evaluates the rolling hourly/daily AI spend budget from a usage log. */
export class BudgetGuard {
  constructor(private readonly cfg: BudgetConfig) {}

  /** True when a new request would exceed the hourly or daily budget. */
  allows(now: number, usageLog: readonly AiUsage[]): boolean {
    const hourAgo = now - 3_600_000;
    const dayAgo = now - 86_400_000;
    let hourly = 0;
    let daily = 0;
    for (const u of usageLog) {
      if (u.windowStart > dayAgo) daily += u.costUsd;
      if (u.windowStart > hourAgo) hourly += u.costUsd;
    }
    return hourly < this.cfg.hourlyBudgetUsd && daily < this.cfg.dailyBudgetUsd;
  }

  usage(now: number, usageLog: readonly AiUsage[]): { hourlyUsd: number; dailyUsd: number } {
    const hourAgo = now - 3_600_000;
    const dayAgo = now - 86_400_000;
    let hourly = 0;
    let daily = 0;
    for (const u of usageLog) {
      if (u.windowStart > dayAgo) daily += u.costUsd;
      if (u.windowStart > hourAgo) hourly += u.costUsd;
    }
    return { hourlyUsd: hourly, dailyUsd: daily };
  }
}
