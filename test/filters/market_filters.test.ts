import { describe, expect, it, vi } from "vitest";
import {
  evaluateSessionFilter,
  getActiveSessions,
} from "../../src/filters/SessionFilter.js";
import { evaluateSpreadFilter } from "../../src/filters/SpreadFilter.js";
import { evaluateNewsFilter, type NewsProvider, type NewsEvent } from "../../src/filters/NewsFilter.js";
import { MarketFilterEngine } from "../../src/filters/MarketFilterEngine.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Candle } from "../../src/core/types/Candle.js";

function makeUtcTimestamp(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

describe("P2-18 Market Filters (Session, Spread, News)", () => {
  describe("SessionFilter", () => {
    it("calculates active UTC trading sessions correctly", () => {
      // 03:00 UTC -> ASIA
      const tAsia = makeUtcTimestamp(2026, 10, 5, 3, 0);
      expect(getActiveSessions(tAsia)).toEqual(["ASIA"]);

      // 08:00 UTC -> Overlap ASIA & LONDON
      const tOverlap1 = makeUtcTimestamp(2026, 10, 5, 8, 0);
      expect(getActiveSessions(tOverlap1)).toEqual(["ASIA", "LONDON"]);

      // 14:00 UTC -> Overlap LONDON & NEW_YORK
      const tOverlap2 = makeUtcTimestamp(2026, 10, 5, 14, 0);
      expect(getActiveSessions(tOverlap2)).toEqual(["LONDON", "NEW_YORK"]);

      // 22:00 UTC -> OFF_HOURS
      const tOff = makeUtcTimestamp(2026, 10, 5, 22, 0);
      expect(getActiveSessions(tOff)).toEqual([]);
    });

    it("disabled session filter allows all timestamps", () => {
      const tOff = makeUtcTimestamp(2026, 10, 5, 22, 0);
      const res = evaluateSessionFilter(tOff, { enabled: false, allowedSessions: ["LONDON"] });
      expect(res.passed).toBe(true);
    });

    it("enabled session filter blocks off-hours or disallowed sessions with SESSION_FILTER_BLOCKED", () => {
      // 03:00 UTC is ASIA only
      const tAsia = makeUtcTimestamp(2026, 10, 5, 3, 0);
      const res = evaluateSessionFilter(tAsia, { enabled: true, allowedSessions: ["LONDON", "NEW_YORK"] });
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("SESSION_FILTER_BLOCKED");
    });

    it("enabled session filter passes when current session matches allowed sessions", () => {
      // 14:00 UTC is LONDON & NEW_YORK
      const tNy = makeUtcTimestamp(2026, 10, 5, 14, 0);
      const res = evaluateSessionFilter(tNy, { enabled: true, allowedSessions: ["LONDON", "NEW_YORK"] });
      expect(res.passed).toBe(true);
    });
  });

  describe("SpreadFilter", () => {
    it("disabled spread filter or non-positive threshold allows all spreads", () => {
      const res1 = evaluateSpreadFilter(5.0, { enabled: false, maxSpreadPoints: 1.0 });
      expect(res1.passed).toBe(true);

      const res2 = evaluateSpreadFilter(5.0, { enabled: true, maxSpreadPoints: 0 });
      expect(res2.passed).toBe(true);
    });

    it("spread within maxSpreadPoints passes", () => {
      const res = evaluateSpreadFilter(0.35, { enabled: true, maxSpreadPoints: 1.0 });
      expect(res.passed).toBe(true);
      expect(res.currentSpread).toBe(0.35);
    });

    it("spread exceeding maxSpreadPoints fails with SPREAD_FILTER_BLOCKED", () => {
      const res = evaluateSpreadFilter(1.5, { enabled: true, maxSpreadPoints: 1.0 });
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("SPREAD_FILTER_BLOCKED");
      expect(res.reason).toContain("exceeds maximum allowed spread");
    });
  });

  describe("NewsFilter", () => {
    it("disabled news filter returns DISABLED status and passes", async () => {
      const res = await evaluateNewsFilter("XAUUSD", Date.now(), { enabled: false, newsWindowMinutes: 30 });
      expect(res.passed).toBe(true);
      expect(res.status).toBe("DISABLED");
    });

    it("enabled news filter without provider returns UNAVAILABLE status and fails safely", async () => {
      const res = await evaluateNewsFilter("XAUUSD", Date.now(), { enabled: true, newsWindowMinutes: 30 }, null);
      expect(res.passed).toBe(false);
      expect(res.status).toBe("UNAVAILABLE");
      expect(res.reason).toContain("NEWS_FILTER_UNAVAILABLE");
    });

    it("enabled news filter with provider blocks high-impact news with NEWS_FILTER_BLOCKED", async () => {
      const now = makeUtcTimestamp(2026, 10, 5, 13, 30);
      const newsEvent: NewsEvent = {
        id: "e1",
        symbol: "XAUUSD",
        title: "US Non-Farm Payrolls",
        impact: "HIGH",
        scheduledAt: now + 10 * 60_000, // 10 minutes in future
      };

      const provider: NewsProvider = {
        name: "mock-news",
        isConfigured: () => true,
        getEvents: async () => [newsEvent],
      };

      const res = await evaluateNewsFilter("XAUUSD", now, { enabled: true, newsWindowMinutes: 30 }, provider);
      expect(res.passed).toBe(false);
      expect(res.status).toBe("AVAILABLE");
      expect(res.reason).toContain("NEWS_FILTER_BLOCKED");
      expect(res.reason).toContain("US Non-Farm Payrolls");
    });

    it("enabled news filter passes when no high-impact news in window", async () => {
      const now = makeUtcTimestamp(2026, 10, 5, 13, 30);
      const newsEvent: NewsEvent = {
        id: "e2",
        symbol: "XAUUSD",
        title: "Minor Fed Speech",
        impact: "LOW",
        scheduledAt: now,
      };

      const provider: NewsProvider = {
        name: "mock-news",
        isConfigured: () => true,
        getEvents: async () => [newsEvent],
      };

      const res = await evaluateNewsFilter("XAUUSD", now, { enabled: true, newsWindowMinutes: 30 }, provider);
      expect(res.passed).toBe(true);
      expect(res.status).toBe("AVAILABLE");
    });
  });

  describe("MarketFilterEngine & Pipeline Integration", () => {
    it("evaluates session, spread, and news filters in sequence and aggregates rejections", async () => {
      const spreadModel = new SpreadSlippageModel(2.0, 0.2, 250); // 2.0 pts spread
      const engine = new MarketFilterEngine(
        {
          sessionFilterEnabled: true,
          allowedSessions: ["LONDON"],
          spreadFilterEnabled: true,
          maxSpreadPoints: 1.0,
          newsFilterEnabled: true,
          newsWindowMinutes: 30,
        },
        spreadModel,
        null
      );

      // Timestamp at 03:00 UTC (ASIA only, not LONDON)
      const tAsia = makeUtcTimestamp(2026, 10, 5, 3, 0);
      const res = await engine.evaluate("XAUUSD", tAsia);

      expect(res.passed).toBe(false);
      expect(res.rejections).toHaveLength(3); // Session, Spread, News Unavailable
      expect(res.rejections[0]!.code).toBe("SESSION_FILTER_BLOCKED");
      expect(res.rejections[1]!.code).toBe("SPREAD_FILTER_BLOCKED");
      expect(res.rejections[2]!.code).toBe("NEWS_FILTER_UNAVAILABLE");
    });

    it("pipeline blocks trade candidate with CycleAction FILTER_BLOCKED when market filter fails", async () => {
      const bus = new EventBus();
      const repo = new NullRepository();
      const log = createConsoleLogger("test");

      const spreadModel = new SpreadSlippageModel(2.0, 0.2, 250); // Spread 2.0 > 1.0 max
      const filterEngine = new MarketFilterEngine(
        {
          sessionFilterEnabled: false,
          allowedSessions: ["LONDON"],
          spreadFilterEnabled: true,
          maxSpreadPoints: 1.0,
          newsFilterEnabled: false,
          newsWindowMinutes: 30,
        },
        spreadModel,
        null
      );

      const mockSetup = {
        id: "s_test_1",
        strategyId: "strong-candle",
        symbol: "XAUUSD",
        timeframe: "M5",
        direction: "LONG" as const,
        barOpenTime: 1000 + 300000,
        createdAt: 1000 + 300000,
        state: "NEW" as const,
        entry: 2024,
        stopLoss: 2014,
        takeProfit1: 2034,
        takeProfit2: 2044,
        invalidationPrice: 2014,
        rationale: "test setup",
        evidence: [],
      };

      const pipeline = new TradingPipeline({
        bus,
        cache: new CandleCache(),
        confluence: new ConfluenceEngine([]),
        strategy: { evaluate: () => mockSetup } as any,
        setupStore: new SetupStore(),
        ai: { analyze: vi.fn() } as any,
        riskConfig: { perTradePct: 0.5, dailyLossCapPct: 3, weeklyLossCapPct: 6, maxDrawdownPct: 10, maxOpenTrades: 2, netExposureMax: 1.5, marginCeilingPct: 50, accountEquity: 10000 },
        riskEnv: () => ({ equity: 10000, state: {} as any, killSwitch: "NONE" }),
        repo,
        telegram: new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log),
        mode: "PAPER_TRADING",
        log,
        marketFilterEngine: filterEngine,
      });

      // Inject 2 candles that trigger StrongCandleStrategy
      const c1: Candle = { symbol: "XAUUSD", timeframe: "M5", openTime: 1000, open: 2000, high: 2005, low: 1995, close: 2002, volume: 100, closeTime: 1000 + 299999 };
      const c2: Candle = { symbol: "XAUUSD", timeframe: "M5", openTime: 1000 + 300000, open: 2002, high: 2025, low: 2001, close: 2024, volume: 200, closeTime: 1000 + 599999 };

      pipeline["deps"].cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: [c1, c2] });

      const outcome = await pipeline.onBarClosed("XAUUSD", "M5");

      expect(outcome.action.kind).toBe("FILTER_BLOCKED");
      if (outcome.action.kind === "FILTER_BLOCKED") {
        expect(outcome.action.filterName).toBe("SpreadFilter");
      }
      expect(outcome.reasons[0]).toContain("SPREAD_FILTER_BLOCKED");
    });
  });
});
