import type { SessionName, SessionFilterResult } from "./SessionFilter.js";
import { evaluateSessionFilter } from "./SessionFilter.js";
import type { SpreadFilterResult } from "./SpreadFilter.js";
import { evaluateSpreadFilter } from "./SpreadFilter.js";
import type { NewsFilterResult, NewsProvider } from "./NewsFilter.js";
import { evaluateNewsFilter } from "./NewsFilter.js";
import type { SpreadSlippageModel } from "../execution/TradeLifecycle.js";

export interface MarketFilterConfig {
  readonly sessionFilterEnabled: boolean;
  readonly allowedSessions: readonly SessionName[];
  readonly spreadFilterEnabled: boolean;
  readonly maxSpreadPoints: number;
  readonly newsFilterEnabled: boolean;
  readonly newsWindowMinutes: number;
}

export interface FilterRejection {
  readonly code: "SESSION_FILTER_BLOCKED" | "SPREAD_FILTER_BLOCKED" | "NEWS_FILTER_BLOCKED" | "NEWS_FILTER_UNAVAILABLE";
  readonly filterName: string;
  readonly message: string;
}

export interface MarketFilterResult {
  readonly passed: boolean;
  readonly rejections: readonly FilterRejection[];
  readonly details: {
    readonly session: SessionFilterResult;
    readonly spread: SpreadFilterResult;
    readonly news: NewsFilterResult;
  };
}

export class MarketFilterEngine {
  constructor(
    private readonly cfg: MarketFilterConfig,
    private readonly spreadModel?: SpreadSlippageModel,
    private readonly newsProvider?: NewsProvider | null
  ) {}

  updateConfig(patch: Partial<MarketFilterConfig>): void {
    Object.assign(this.cfg, patch);
  }

  getConfig(): Readonly<MarketFilterConfig> {
    return { ...this.cfg };
  }

  async evaluate(symbol: string, timestamp: number): Promise<MarketFilterResult> {
    const rejections: FilterRejection[] = [];

    // 1. Session Filter
    const sessionRes = evaluateSessionFilter(timestamp, {
      enabled: this.cfg.sessionFilterEnabled,
      allowedSessions: this.cfg.allowedSessions,
    });
    if (!sessionRes.passed && sessionRes.reason) {
      rejections.push({
        code: "SESSION_FILTER_BLOCKED",
        filterName: "SessionFilter",
        message: sessionRes.reason,
      });
    }

    // 2. Spread Filter
    const currentSpread = this.spreadModel ? this.spreadModel.spread : 0;
    const spreadRes = evaluateSpreadFilter(currentSpread, {
      enabled: this.cfg.spreadFilterEnabled,
      maxSpreadPoints: this.cfg.maxSpreadPoints,
    });
    if (!spreadRes.passed && spreadRes.reason) {
      rejections.push({
        code: "SPREAD_FILTER_BLOCKED",
        filterName: "SpreadFilter",
        message: spreadRes.reason,
      });
    }

    // 3. News Filter
    const newsRes = await evaluateNewsFilter(
      symbol,
      timestamp,
      {
        enabled: this.cfg.newsFilterEnabled,
        newsWindowMinutes: this.cfg.newsWindowMinutes,
      },
      this.newsProvider
    );
    if (!newsRes.passed && newsRes.reason) {
      rejections.push({
        code: newsRes.status === "UNAVAILABLE" ? "NEWS_FILTER_UNAVAILABLE" : "NEWS_FILTER_BLOCKED",
        filterName: "NewsFilter",
        message: newsRes.reason,
      });
    }

    return {
      passed: rejections.length === 0,
      rejections,
      details: {
        session: sessionRes,
        spread: spreadRes,
        news: newsRes,
      },
    };
  }
}
