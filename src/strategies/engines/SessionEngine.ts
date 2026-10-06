import type { AnalysisEngine, EngineContext, EngineOutput } from "../Engine.js";

export type MarketSession = "ASIA" | "LONDON" | "NEW_YORK" | "LONDON_NY_OVERLAP" | "OFF_HOURS";

export function getSessionFromTimestamp(timestampMs: number): MarketSession {
  const date = new Date(timestampMs);
  const hour = date.getUTCHours();

  if (hour >= 13 && hour < 16) {
    return "LONDON_NY_OVERLAP";
  }
  if (hour >= 8 && hour < 16) {
    return "LONDON";
  }
  if (hour >= 13 && hour < 21) {
    return "NEW_YORK";
  }
  if (hour >= 0 && hour < 8) {
    return "ASIA";
  }
  return "OFF_HOURS";
}

/**
 * Session Analysis Engine:
 * Emits session context information for confluence and strategy weighting.
 */
export class SessionEngine implements AnalysisEngine {
  readonly id = "session";

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length === 0) return { engine: this.id, evidence: [] };

    const last = candles[candles.length - 1]!;
    const session = getSessionFromTimestamp(last.openTime);

    const evidence = [
      {
        source: "session",
        kind: `session-${session.toLowerCase()}`,
        detail: `current closed bar inside ${session} trading window`,
        weight: 0, // Neutral informational factor by default unless session-specific bias is defined
      },
    ];

    return { engine: this.id, evidence };
  }
}
