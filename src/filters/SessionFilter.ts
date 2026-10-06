export type SessionName = "ASIA" | "LONDON" | "NEW_YORK";

export interface SessionFilterConfig {
  readonly enabled: boolean;
  readonly allowedSessions: readonly SessionName[];
}

export interface SessionFilterResult {
  readonly passed: boolean;
  readonly activeSessions: readonly SessionName[];
  readonly reason?: string;
}

/**
 * Standard Forex / XAUUSD session hours in UTC:
 * - ASIA: 00:00 to 09:00 UTC
 * - LONDON: 07:00 to 16:00 UTC
 * - NEW_YORK: 12:00 to 21:00 UTC
 */
export function getActiveSessions(timestamp: number): readonly SessionName[] {
  const date = new Date(timestamp);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const timeInMins = hour * 60 + minute;

  const active: SessionName[] = [];

  // ASIA: 00:00 (0) - 09:00 (540)
  if (timeInMins >= 0 && timeInMins < 540) {
    active.push("ASIA");
  }
  // LONDON: 07:00 (420) - 16:00 (960)
  if (timeInMins >= 420 && timeInMins < 960) {
    active.push("LONDON");
  }
  // NEW_YORK: 12:00 (720) - 21:00 (1260)
  if (timeInMins >= 720 && timeInMins < 1260) {
    active.push("NEW_YORK");
  }

  return active;
}

export function evaluateSessionFilter(
  timestamp: number,
  cfg: SessionFilterConfig
): SessionFilterResult {
  if (!cfg.enabled) {
    return { passed: true, activeSessions: getActiveSessions(timestamp) };
  }

  const activeSessions = getActiveSessions(timestamp);
  const allowed = cfg.allowedSessions ?? ["LONDON", "NEW_YORK"];

  const isAllowed = activeSessions.some((s) => allowed.includes(s));

  if (!isAllowed) {
    const timeStr = new Date(timestamp).toISOString().slice(11, 16);
    return {
      passed: false,
      activeSessions,
      reason: `SESSION_FILTER_BLOCKED: Bar open time ${timeStr} UTC (active: [${activeSessions.join(", ") || "OFF_HOURS"}]) outside allowed sessions [${allowed.join(", ")}]`,
    };
  }

  return { passed: true, activeSessions };
}
