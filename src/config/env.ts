import dotenv from "dotenv";
import { z } from "zod";
import { AppConfigSchema, num, list } from "./AppConfig.js";
import type { AppConfig, ConfigSource } from "./AppConfig.js";

dotenv.config();

function env(key: string): string {
  return process.env[key] ?? "";
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes)$/i.test(v);
}

export class EnvConfigSource implements ConfigSource {
  readonly name = "env";

  load(): Record<string, unknown> {
    const symbolList = list(process.env.GP_SYMBOLS, ["XAUUSD"]);
    const symbolMap: Record<string, string> = {};
    for (const s of symbolList) {
      symbolMap[s] = env(`BIQUITI_SYMBOL_MAP_${s.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}`);
    }
    return {
      mode: env("GP_MODE") || "ANALYSIS_ONLY",
      symbols: symbolList,
      timeframes: list(process.env.GP_TIMEFRAMES, ["M5", "M15", "H1"]).map((t) => t.toUpperCase()),
      scanIntervalMs: num(process.env.GP_SCAN_INTERVAL_MS, 60_000),
      biquiti: {
        baseUrl: env("BIQUITI_BASE_URL"),
        apiKey: env("BIQUITI_API_KEY"),
        candlesPath: env("BIQUITI_CANDLES_PATH"),
        authHeader: env("BIQUITI_AUTH_HEADER") || "Authorization",
        symbolMap,
        timeoutMs: num(process.env.BIQUITI_TIMEOUT_MS, 10_000),
      },
      ai: {
        provider: env("AI_PROVIDER") || "novita",
        baseUrl: env("AI_BASE_URL") || env("NOVITA_BASE_URL"),
        apiKey: env("AI_API_KEY") || env("NOVITA_API_KEY"),
        model: env("AI_MODEL") || env("NOVITA_MODEL"),
        timeoutMs: num(process.env.AI_TIMEOUT_MS, 45_000),
        maxRetries: num(process.env.AI_MAX_RETRIES, 1),
        hourlyBudgetUsd: num(process.env.AI_HOURLY_BUDGET_USD, 1),
        dailyBudgetUsd: num(process.env.AI_DAILY_BUDGET_USD, 10),
        cacheTtlMs: num(process.env.AI_CACHE_TTL_MS, 120_000),
      },
      supabase: { url: env("SUPABASE_URL"), serviceKey: env("SUPABASE_SERVICE_KEY") },
      telegram: {
        botToken: env("TELEGRAM_BOT_TOKEN"),
        chatId: env("TELEGRAM_CHAT_ID"),
        enabled: envBool("TELEGRAM_ENABLED", true) && env("TELEGRAM_BOT_TOKEN") !== "",
      },
      risk: {
        perTradePct: num(process.env.RISK_PER_TRADE_PCT, 0.5),
        dailyLossCapPct: num(process.env.RISK_DAILY_LOSS_CAP_PCT, 3),
        weeklyLossCapPct: num(process.env.RISK_WEEKLY_LOSS_CAP_PCT, 6),
        maxDrawdownPct: num(process.env.RISK_MAX_DRAWDOWN_PCT, 10),
        maxOpenTrades: num(process.env.RISK_MAX_OPEN_TRADES, 2),
        netExposureMax: num(process.env.RISK_NET_EXPOSURE_MAX, 1.5),
        marginCeilingPct: num(process.env.RISK_MARGIN_CEILING_PCT, 50),
        accountEquity: nonZeroNum(process.env.RISK_ACCOUNT_EQUITY, 10_000),
      },
      execution: {
        venue: (env("EXECUTION_VENUE") || "SIMULATED") as "SIMULATED" | "BROKER",
        spreadPoints: num(process.env.MODEL_SPREAD_POINTS, 0.35),
        slippagePoints: num(process.env.MODEL_SLIPPAGE_POINTS, 0.2),
        latencyMs: num(process.env.MODEL_LATENCY_MS, 250),
      },
      fixturesDir: env("FIXTURES_DIR") || "./fixtures",
      features: {
        aiEnabled: envBool("GP_AI_ENABLED", true),
        persistenceEnabled: envBool("GP_PERSISTENCE_ENABLED", true),
        telegramEnabled: envBool("TELEGRAM_ENABLED", true) && env("TELEGRAM_BOT_TOKEN") !== "",
        experienceMemoryEnabled: envBool("GP_EXPERIENCE_MEMORY_ENABLED", false),
        strongCandleStrategy: envBool("GP_STRONG_CANDLE_STRATEGY", true),
        dashboardEnabled: envBool("GP_DASHBOARD_ENABLED", false),
      },
    };
  }
}

function nonZeroNum(v: string | undefined, fallback: number): number {
  const n = num(v, fallback);
  return n > 0 ? n : fallback;
}

export function loadAppConfig(): AppConfig {
  const parsed = AppConfigSchema.safeParse(new EnvConfigSource().load());
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export type { AppConfig };
export { AppConfigSchema };
export const __zod = z;
