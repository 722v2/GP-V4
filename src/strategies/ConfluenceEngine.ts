import type { Direction, Evidence } from "../core/types/Setup.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "./Engine.js";

export interface ConfluenceResult {
  /** Net score (sum of signed weights). Positive = long bias, negative = short. */
  readonly score: number;
  /** Bias direction when |score| clears threshold and has independent engine support, else null. */
  readonly direction: Direction | null;
  /** Aggregated evidence from every engine. */
  readonly evidence: readonly Evidence[];
  /** Merged structural/liquidity levels for downstream context. */
  readonly levels: readonly EngineLevel[];
  /** Per-engine raw outputs, for debugging and AI context. */
  readonly perEngine: readonly EngineOutput[];
  /** Distinct engine IDs that independently supported the resolved direction. */
  readonly supportingEngines?: readonly string[];
}

export interface ConfluenceConfig {
  /** Minimum |score| to declare a directional bias. */
  minScore: number;
  /** Maximum weight any single engine can contribute (caps dominance). */
  maxEngineWeight: number;
  /**
   * Minimum number of distinct independent engines that must support the directional bias.
   * Prevents a single factor (e.g. strong candle / momentum alone) from establishing direction.
   */
  minSupportingEngines?: number;
}

export const DEFAULT_CONFLUENCE_CONFIG: ConfluenceConfig = {
  minScore: 0.5,
  maxEngineWeight: 1.5,
  minSupportingEngines: 2,
};

/**
 * Confluence engine: runs every analysis engine over the same closed-bar context,
 * aggregates their signed evidence, and resolves a directional bias. Pure and
 * deterministic — the same candles always produce the same verdict.
 *
 * Invariant (P1-1): A single engine (e.g. momentum / strong-candle) alone cannot
 * establish trade direction. Directional trade evidence requires support from at least
 * two sufficiently independent engines.
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
    const candidateDirection: Direction | null =
      Math.abs(score) >= this.cfg.minScore ? (score > 0 ? "LONG" : "SHORT") : null;

    let direction: Direction | null = null;
    const supportingEngines: string[] = [];

    if (candidateDirection) {
      for (const out of perEngine) {
        const engineNet = totalScore(out.evidence);
        const hasSupportingEvidence = out.evidence.some((e) =>
          candidateDirection === "LONG" ? e.weight > 0 : e.weight < 0
        );
        if (
          hasSupportingEvidence &&
          ((candidateDirection === "LONG" && engineNet > 0) ||
            (candidateDirection === "SHORT" && engineNet < 0))
        ) {
          supportingEngines.push(out.engine);
        }
      }

      const minSupporting = this.cfg.minSupportingEngines ?? 2;
      const uniqueSupporting = Array.from(new Set(supportingEngines));
      if (uniqueSupporting.length >= minSupporting) {
        direction = candidateDirection;
      }
    }

    const uniqueSupporting = Array.from(new Set(supportingEngines));

    return {
      score,
      direction,
      evidence,
      levels,
      perEngine,
      supportingEngines: uniqueSupporting,
    };
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
