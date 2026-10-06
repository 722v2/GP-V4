export interface SpreadFilterConfig {
  readonly enabled: boolean;
  readonly maxSpreadPoints: number;
}

export interface SpreadFilterResult {
  readonly passed: boolean;
  readonly currentSpread: number;
  readonly maxSpread: number;
  readonly reason?: string;
}

export function evaluateSpreadFilter(
  currentSpread: number,
  cfg: SpreadFilterConfig
): SpreadFilterResult {
  if (!cfg.enabled || cfg.maxSpreadPoints <= 0) {
    return { passed: true, currentSpread, maxSpread: cfg.maxSpreadPoints };
  }

  if (currentSpread > cfg.maxSpreadPoints) {
    return {
      passed: false,
      currentSpread,
      maxSpread: cfg.maxSpreadPoints,
      reason: `SPREAD_FILTER_BLOCKED: Current spread ${currentSpread.toFixed(2)} pts exceeds maximum allowed spread ${cfg.maxSpreadPoints.toFixed(2)} pts`,
    };
  }

  return { passed: true, currentSpread, maxSpread: cfg.maxSpreadPoints };
}
