import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { AppConfigSchema, num, list } from "./AppConfig.js";
import type { AppConfig, ConfigSource } from "./AppConfig.js";
import { DEFAULT_RUNTIME_CONFIG } from "./RuntimeConfigStore.js";

dotenv.config();

function env(key: string): string {
  return process.env[key] ?? "";
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes)$/i.test(v);
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (target as any)[key] === "object" &&
      !Array.isArray((target as any)[key])
    ) {
      output[key] = deepMerge((target as any)[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export class EnvConfigSource implements ConfigSource {
  readonly name = "env";

  load(): Record<string, unknown> {
    const symbolList = list(process.env.GP_SYMBOLS, ["XAUUSD"]);
    const symbolMap: Record<string, string> = {};
    for (const s of symbolList) {
      const mapped = env(`BIQUITI_SYMBOL_MAP_${s.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}`);
      if (mapped) symbolMap[s] = mapped;
    }
    return {
      mode: env("GP_MODE") || "ANALYSIS_ONLY",
      symbols: symbolList,
      timeframes: list(process.env.GP_TIMEFRAMES, ["M1", "M5", "M15", "H1"]).map((t) => t.toUpperCase()),
      scanIntervalMs: num(process.env.GP_SCAN_INTERVAL_MS, 60_000),
      biquiti: {
        baseUrl: env("BIQUITI_BASE_URL") || "https://biquote.io",
        apiKey: env("BIQUITI_API_KEY"),
        candlesPath: env("BIQUITI_CANDLES_PATH") || "/api/{symbol}/ohlc",
        authHeader: env("BIQUITI_AUTH_HEADER") || "Authorization",
        symbolMap: { XAUUSD: "XAUUSD", ...symbolMap },
        timeoutMs: num(process.env.BIQUITI_TIMEOUT_MS, 10_000),
      },
      ai: {
        provider: env("AI_PROVIDER") || "nvidia-nim",
        baseUrl: env("AI_BASE_URL") || env("NVIDIA_BASE_URL") || env("NOVITA_BASE_URL") || "https://integrate.api.nvidia.com/v1",
        apiKey: env("AI_API_KEY") || env("NVIDIA_API_KEY") || env("NOVITA_API_KEY"),
        model: env("AI_MODEL") || env("NVIDIA_MODEL") || env("NOVITA_MODEL") || "meta/llama-3.2-11b-vision-instruct",
        m5Model: env("AI_M5_MODEL") || env("NVIDIA_M5_MODEL") || env("NOVITA_M5_MODEL") || "",
        timeoutMs: num(process.env.AI_TIMEOUT_MS, 45_000),
        m5TimeoutMs: num(process.env.AI_M5_TIMEOUT_MS, 15_000),
        maxRetries: num(process.env.AI_MAX_RETRIES, 1),
        retryInitialDelayMs: num(process.env.AI_RETRY_INITIAL_DELAY_MS, 500),
        retryMaxDelayMs: num(process.env.AI_RETRY_MAX_DELAY_MS, 4000),
        minConfidence: num(process.env.AI_MIN_CONFIDENCE, 0.6),
        levelTolerancePts: num(process.env.AI_LEVEL_TOLERANCE_PTS, 1.0),
        hourlyBudgetUsd: num(process.env.AI_HOURLY_BUDGET_USD, 1),
        dailyBudgetUsd: num(process.env.AI_DAILY_BUDGET_USD, 10),
        cacheTtlMs: num(process.env.AI_CACHE_TTL_MS, 120_000),
      },
      supabase: { url: env("SUPABASE_URL"), serviceKey: env("SUPABASE_SERVICE_KEY") },
      telegram: {
        botToken: env("TELEGRAM_BOT_TOKEN"),
        chatId: env("TELEGRAM_CHAT_ID"),
        enabled: envBool("TELEGRAM_ENABLED", false) && env("TELEGRAM_BOT_TOKEN") !== "",
      },
      risk: {
        perTradePct: num(process.env.RISK_PER_TRADE_PCT, 0.5),
        minRiskPerTradePct: num(process.env.RISK_MIN_PER_TRADE_PCT, 0.01),
        maxRiskPerTradePct: num(process.env.RISK_MAX_PER_TRADE_PCT, 5.0),
        dailyLossCapPct: num(process.env.RISK_DAILY_LOSS_CAP_PCT, 3),
        weeklyLossCapPct: num(process.env.RISK_WEEKLY_LOSS_CAP_PCT, 6),
        maxDrawdownPct: num(process.env.RISK_MAX_DRAWDOWN_PCT, 10),
        maxOpenTrades: num(process.env.RISK_MAX_OPEN_TRADES, 2),
        netExposureMax: num(process.env.RISK_NET_EXPOSURE_MAX, 1.5),
        marginCeilingPct: num(process.env.RISK_MARGIN_CEILING_PCT, 50),
        accountEquity: nonZeroNum(process.env.RISK_ACCOUNT_EQUITY, 10_000),
        minStopDistancePts: num(process.env.RISK_MIN_STOP_DISTANCE_PTS, 1.0),
        maxStopDistancePts: num(process.env.RISK_MAX_STOP_DISTANCE_PTS, 50.0),
        maxLot: num(process.env.RISK_MAX_LOT, 10.0),
      },
      execution: {
        venue: (env("EXECUTION_VENUE") || "SIMULATED") as "SIMULATED" | "BROKER",
        spreadPoints: num(process.env.MODEL_SPREAD_POINTS, 0.35),
        slippagePoints: num(process.env.MODEL_SLIPPAGE_POINTS, 0.2),
        latencyMs: num(process.env.MODEL_LATENCY_MS, 250),
      },
      strategyExpiryBars: num(process.env.GP_SETUP_EXPIRY_BARS, 6),
      persistenceMaxRetries: num(process.env.GP_PERSISTENCE_MAX_RETRIES, 3),
      persistenceInitialRetryDelayMs: num(process.env.GP_PERSISTENCE_INITIAL_RETRY_DELAY_MS, 500),
      persistenceMaxRetryDelayMs: num(process.env.GP_PERSISTENCE_MAX_RETRY_DELAY_MS, 4000),
      persistenceAlertCooldownMs: num(process.env.GP_PERSISTENCE_ALERT_COOLDOWN_MS, 60_000),
      marketFilters: {
        sessionFilterEnabled: envBool("GP_SESSION_FILTER_ENABLED", false),
        allowedSessions: (env("GP_ALLOWED_SESSIONS") ? env("GP_ALLOWED_SESSIONS").split(",") : ["LONDON", "NEW_YORK"]) as ("ASIA" | "LONDON" | "NEW_YORK")[],
        spreadFilterEnabled: envBool("GP_SPREAD_FILTER_ENABLED", false),
        maxSpreadPoints: num(process.env.GP_MAX_SPREAD_POINTS, 1.0),
        newsFilterEnabled: envBool("GP_NEWS_FILTER_ENABLED", false),
        newsWindowMinutes: num(process.env.GP_NEWS_WINDOW_MINUTES, 30),
      },
      fixturesDir: env("FIXTURES_DIR") || "./fixtures",
      features: {
        aiEnabled: envBool("GP_AI_ENABLED", true),
        persistenceEnabled: envBool("GP_PERSISTENCE_ENABLED", true),
        telegramEnabled: envBool("TELEGRAM_ENABLED", false) && env("TELEGRAM_BOT_TOKEN") !== "",
        experienceMemoryEnabled: envBool("GP_EXPERIENCE_MEMORY_ENABLED", false),
        strongCandleStrategy: envBool("GP_STRONG_CANDLE_STRATEGY", true),
        dashboardEnabled: envBool("GP_DASHBOARD_ENABLED", true),
      },
      mt5: {
        enabled: envBool("MT5_ENABLED", false),
        bridgeUrl: env("MT5_BRIDGE_URL"),
        brokerSymbolXauusd: env("MT5_BROKER_SYMBOL_XAUUSD") || "XAUUSD",
        accountId: env("MT5_ACCOUNT_ID"),
        server: env("MT5_SERVER"),
      },
    };
  }
}

function nonZeroNum(v: string | undefined, fallback: number): number {
  const n = num(v, fallback);
  return n > 0 ? n : fallback;
}

export interface LoadAppConfigOptions {
  configFilePath?: string | null;
  ignorePersisted?: boolean;
}

export function getRuntimeConfigFilePath(): string {
  return process.env.GP_RUNTIME_CONFIG_PATH || path.resolve(process.cwd(), "data", "runtime-config.json");
}

/**
 * Loads canonical configuration with strict priority order:
 * 1. Saved Runtime Configuration (Dashboard Source of Truth from disk store)
 * 2. Optional legacy environment overrides (for backwards-compatible migrations)
 * 3. Canonical safe DEV/TEST defaults (ZERO-CONFIG)
 * 4. External Secrets (BIQUITI_API_KEY, NOVITA_API_KEY, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN)
 */
export function loadAppConfig(
  overrides?: Record<string, unknown>,
  options?: LoadAppConfigOptions
): AppConfig {
  // Start with safe defaults
  let base: Record<string, any> = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));

  // Merge optional legacy environment config
  const envConfig = new EnvConfigSource().load();
  base = deepMerge(base, envConfig);

  // Check and merge saved runtime configuration from local dev store if present and not ignored
  const shouldLoadPersisted = !options?.ignorePersisted && process.env.GP_IGNORE_PERSISTED_CONFIG !== "true";
  if (shouldLoadPersisted) {
    try {
      const devFilePath = options?.configFilePath !== undefined
        ? options.configFilePath
        : getRuntimeConfigFilePath();

      if (devFilePath && fs.existsSync(devFilePath)) {
        const raw = fs.readFileSync(devFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.config && typeof parsed.config === "object") {
          base = deepMerge(base, parsed.config);
        }
      }
    } catch {
      // Gracefully ignore local file read failure
    }
  }

  // Ensure secrets from process.env are always wired if provided
  if (process.env.BIQUITI_API_KEY) base.biquiti.apiKey = process.env.BIQUITI_API_KEY;
  if (process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || process.env.NOVITA_API_KEY) {
    base.ai.apiKey = process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || process.env.NOVITA_API_KEY;
  }
  if (process.env.SUPABASE_SERVICE_KEY) base.supabase.serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (process.env.TELEGRAM_BOT_TOKEN) base.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  // Apply explicit overrides if provided
  if (overrides) {
    base = deepMerge(base, overrides);
  }

  // Ensure secrets from process.env are always wired if provided and have the highest priority
  if (process.env.TELEGRAM_CHAT_ID) base.telegram.chatId = process.env.TELEGRAM_CHAT_ID;

  const parsed = AppConfigSchema.safeParse(base);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export type { AppConfig };
export { AppConfigSchema };
export const __zod = z;
