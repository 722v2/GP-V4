import type { Direction, Evidence } from "../core/types/Setup.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "./Engine.js";

export interface ConfluenceResult {
  /** Net score (sum of signed weights). Positive = long bias, negative = short. */
  readonly score: number;
  /** Bias direction when |score| clears threshold, else null. */
  readonly direction: Direction | null;
  /** Aggregated evidence from every engine. */
  readonly evidence: readonly Evidence[];
  /** Merged structural/liquidity levels for downstream context. */
  readonly levels: readonly EngineLevel[];
  /** Per-engine raw outputs, for debugging and AI context. */
  readonly perEngine: readonly EngineOutput[];
}

export interface ConfluenceConfig {
  /** Minimum |score| to declare a directional bias. */
  minScore: number;
  /** Maximum weight any single engine can contribute (caps dominance). */
  maxEngineWeight: number;
}

export const DEFAULT_CONFLUENCE_CONFIG: ConfluenceConfig = {
  minScore: 0.5,
  maxEngineWeight: 1.5,
};

/**
 * Confluence engine: runs every analysis engine over the same closed-bar context,
 * aggregates their signed evidence, and resolves a directional bias. Pure and
 * deterministic — the same candles always produce the same verdict.
 */
export class ConfluenceEngine {
  constructor(
    private readonly engines: readonly AnalysisEngine[],
    private readonly cfg: ConfluenceConfig = DEFAULT_CONFLUENCE_CONFIG
  ) {}

  evaluate(ctx: EngineContext): ConfluenceResult {
    const perEngine: EngineOutput[] = [];
    const evidence: Evidence[] = [];
    const levels: EngineLevel[] = [];

    for (const engine of this.engines) {
      const out = engine.analyze(ctx);
      perEngine.push(out);
      levels.push(...(out.levels ?? []));
      evidence.push(...out.evidence);
    }

    const score = totalScore(evidence);
    const direction: Direction | null =
      Math.abs(score) >= this.cfg.minScore ? (score > 0 ? "LONG" : "SHORT") : null;

    return { score, direction, evidence, levels, perEngine };
  }

  get engineIds(): readonly string[] {
    return this.engines.map((e) => e.id);
  }
}

function totalScore(evidence: readonly Evidence[]): number {
  let total = 0;
  for (const e of evidence) {
    total += Math.max(-1, Math.min(1, e.weight));
  }
  return total;
}
