import type { Direction, Evidence } from "../core/types/Setup.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "./Engine.js";
import type { MtfContext } from "./mtf/MtfContext.js";

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
  /** Attached MTF context if available. */
  readonly mtfContext?: MtfContext;
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
 * Confluence engine: runs every analysis engine over the primary closed-bar context,
 * incorporates higher-timeframe context evidence if provided, aggregates signed evidence,
 * and resolves a directional bias. Pure and deterministic — the same inputs produce the same verdict.
 */
export class ConfluenceEngine {
  constructor(
    private readonly engines: readonly AnalysisEngine[],
    private readonly cfg: ConfluenceConfig = DEFAULT_CONFLUENCE_CONFIG
  ) {}

  evaluate(ctx: EngineContext, mtfContext?: MtfContext): ConfluenceResult {
    const perEngine: EngineOutput[] = [];
    const evidence: Evidence[] = [];
    const levels: EngineLevel[] = [];

    for (const engine of this.engines) {
      const out = engine.analyze(ctx);
      perEngine.push(out);
      levels.push(...(out.levels ?? []));
      evidence.push(...out.evidence);
    }

    // Add higher-timeframe context evidence if provided
    if (mtfContext) {
      if (mtfContext.m5) {
        const weight = mtfContext.m5.trend === "BULLISH" ? 0.3 : mtfContext.m5.trend === "BEARISH" ? -0.3 : 0;
        if (weight !== 0) {
          const ev: Evidence = {
            source: "mtf-m5",
            kind: mtfContext.m5.trend === "BULLISH" ? "m5-bullish-context" : "m5-bearish-context",
            detail: mtfContext.m5.rationale,
            weight,
          };
          evidence.push(ev);
          perEngine.push({ engine: "mtf-m5", evidence: [ev] });
        }
      }

      if (mtfContext.m15) {
        const weight = mtfContext.m15.trend === "BULLISH" ? 0.3 : mtfContext.m15.trend === "BEARISH" ? -0.3 : 0;
        if (weight !== 0) {
          const ev: Evidence = {
            source: "mtf-m15",
            kind: mtfContext.m15.trend === "BULLISH" ? "m15-bullish-context" : "m15-bearish-context",
            detail: mtfContext.m15.rationale,
            weight,
          };
          evidence.push(ev);
          perEngine.push({ engine: "mtf-m15", evidence: [ev] });
        }
      }

      if (mtfContext.h1) {
        const weight = mtfContext.h1.trend === "BULLISH" ? 0.2 : mtfContext.h1.trend === "BEARISH" ? -0.2 : 0;
        if (weight !== 0) {
          const ev: Evidence = {
            source: "mtf-h1",
            kind: mtfContext.h1.trend === "BULLISH" ? "h1-bullish-context" : "h1-bearish-context",
            detail: mtfContext.h1.rationale,
            weight,
          };
          evidence.push(ev);
          perEngine.push({ engine: "mtf-h1", evidence: [ev] });
        }
      }
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
      mtfContext,
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
