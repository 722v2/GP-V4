import type { Direction } from "../types/Setup.js";

export interface TradeExperienceRecord {
  readonly id: string;
  readonly setupId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: Direction;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly factors: readonly string[];
  readonly confluenceScore: number;
  readonly outcome: "WIN" | "LOSS" | "EVEN";
  readonly realizedR: number;
  readonly realizedPnl: number;
}

export interface ExperienceQuery {
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: Direction;
  readonly factors: readonly string[];
  readonly asOfTimestamp: number;
}

export interface ExperienceInsight {
  readonly sampleSize: number;
  readonly winRate: number;
  readonly avgR: number;
  readonly advisoryScoreModifier: number;
  readonly confidenceModifier: number;
  readonly recommendation: "FAVORABLE" | "UNFAVORABLE" | "INSUFFICIENT_DATA" | "NEUTRAL";
}

/**
 * Experience & Feedback Memory Layer:
 * Stores structured factor combinations of completed trades and provides
 * bounded point-in-time advisory insights.
 *
 * Invariants (Part H):
 * - Never overrides Risk Engine or Kill Switch.
 * - Point-in-time isolated: cannot leak future closed trade outcomes.
 * - Minimum sample size threshold (>= 5) required before exerting advisory influence.
 * - Bounded modifier (+/- 0.15 max) to prevent overfitting to a small cluster.
 */
export class ExperienceMemory {
  private records: TradeExperienceRecord[] = [];

  constructor(initialRecords: readonly TradeExperienceRecord[] = []) {
    this.records = [...initialRecords];
  }

  record(outcome: TradeExperienceRecord): void {
    if (this.records.some((r) => r.id === outcome.id)) return;
    this.records.push(outcome);
    this.records.sort((a, b) => a.closedAt - b.closedAt);
  }

  query(q: ExperienceQuery): ExperienceInsight {
    // Point-in-time isolation: strictly consider trades that closed at or before asOfTimestamp
    const visibleRecords = this.records.filter((r) => r.closedAt <= q.asOfTimestamp);

    // Match setups with same direction and overlapping factors
    const queryFactorSet = new Set(q.factors);
    const matches = visibleRecords.filter((r) => {
      if (r.direction !== q.direction) return false;
      const commonFactors = r.factors.filter((f) => queryFactorSet.has(f));
      return commonFactors.length >= Math.min(2, q.factors.length);
    });

    const sampleSize = matches.length;
    if (sampleSize < 5) {
      return {
        sampleSize,
        winRate: sampleSize > 0 ? matches.filter((m) => m.outcome === "WIN").length / sampleSize : 0,
        avgR: sampleSize > 0 ? matches.reduce((acc, m) => acc + m.realizedR, 0) / sampleSize : 0,
        advisoryScoreModifier: 0,
        confidenceModifier: 0,
        recommendation: "INSUFFICIENT_DATA",
      };
    }

    const wins = matches.filter((m) => m.outcome === "WIN").length;
    const winRate = wins / sampleSize;
    const totalR = matches.reduce((acc, m) => acc + m.realizedR, 0);
    const avgR = totalR / sampleSize;

    let advisoryScoreModifier = 0;
    let confidenceModifier = 0;
    let recommendation: ExperienceInsight["recommendation"] = "NEUTRAL";

    if (winRate >= 0.65 && avgR >= 0.5) {
      advisoryScoreModifier = Math.min(0.15, (winRate - 0.5) * 0.3);
      confidenceModifier = 0.1;
      recommendation = "FAVORABLE";
    } else if (winRate <= 0.35 || avgR <= -0.3) {
      advisoryScoreModifier = Math.max(-0.15, (winRate - 0.5) * 0.3);
      confidenceModifier = -0.1;
      recommendation = "UNFAVORABLE";
    }

    return {
      sampleSize,
      winRate: Math.round(winRate * 1000) / 1000,
      avgR: Math.round(avgR * 100) / 100,
      advisoryScoreModifier: Math.round(advisoryScoreModifier * 100) / 100,
      confidenceModifier: Math.round(confidenceModifier * 100) / 100,
      recommendation,
    };
  }

  all(): readonly TradeExperienceRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }
}
