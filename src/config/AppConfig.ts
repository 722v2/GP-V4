import { z } from "zod";

const DEFAULT_SYMBOLS = ["XAUUSD"];
const DEFAULT_TIMEFRAMES = ["M1", "M5", "M15", "H1"];

export const AppConfigSchema = z.object({
  mode: z.enum(["ANALYSIS_ONLY", "MANUAL_CONFIRMATION", "AUTO_TRADING", "PAPER_TRADING", "REPLAY", "BACKTEST"]),
  symbols: z.array(z.string()).min(1),
  timeframes: z.array(z.enum(["M1", "M5", "M15", "H1", "H4", "D1"])).min(1),
  scanIntervalMs: z.number().int().positive().max(600_000),

  biquiti: z.object({
    baseUrl: z.string().url().or(z.literal("")),
    apiKey: z.string(),
    candlesPath: z.string(),
    authHeader: z.string().default("Authorization"),
    /** Maps internal symbol -> provider symbol; empty string = not configured. */
    symbolMap: z.record(z.string(), z.string()),
    timeoutMs: z.number().int().positive(),
  }),

  ai: z.object({
    provider: z.string().default("novita"),
    baseUrl: z.string().url().or(z.literal("")),
    apiKey: z.string(),
    model: z.string(),
    m5Model: z.string().default(""),
    timeoutMs: z.number().int().positive(),
    m5TimeoutMs: z.number().int().positive().default(15_000),
    maxRetries: z.number().int().min(0).max(5),
    retryInitialDelayMs: z.number().int().nonnegative().default(500),
    retryMaxDelayMs: z.number().int().nonnegative().default(4000),
    minConfidence: z.number().min(0).max(1).default(0.6),
    levelTolerancePts: z.number().nonnegative().default(1.0),
    hourlyBudgetUsd: z.number().positive(),
    dailyBudgetUsd: z.number().positive(),
    cacheTtlMs: z.number().int().positive(),
  }),

  supabase: z.object({
    url: z.string().url().or(z.literal("")),
    serviceKey: z.string(),
  }),

  telegram: z.object({
    botToken: z.string(),
    chatId: z.string(),
    enabled: z.boolean(),
  }),

  risk: z.object({
    perTradePct: z.number().positive(),
    minRiskPerTradePct: z.number().positive().optional().default(0.01),
    maxRiskPerTradePct: z.number().positive().optional().default(5.0),
    dailyLossCapPct: z.number().positive(),
    weeklyLossCapPct: z.number().positive(),
    maxDrawdownPct: z.number().positive(),
    maxOpenTrades: z.number().int().positive(),
    netExposureMax: z.number().positive(),
    marginCeilingPct: z.number().positive(),
    accountEquity: z.number().positive(),
    minStopDistancePts: z.number().nonnegative().optional().default(1.0),
    maxStopDistancePts: z.number().positive().optional().default(50.0),
    maxLot: z.number().positive().optional().default(10.0),
  }),

  execution: z.object({
    venue: z.enum(["SIMULATED", "BROKER"]).default("SIMULATED"),
    spreadPoints: z.number().min(0),
    slippagePoints: z.number().min(0),
    latencyMs: z.number().min(0),
  }),

  strategyExpiryBars: z.number().int().nonnegative().optional().default(6),

  persistenceMaxRetries: z.number().int().nonnegative().optional().default(3),
  persistenceInitialRetryDelayMs: z.number().int().positive().optional().default(500),
  persistenceMaxRetryDelayMs: z.number().int().positive().optional().default(4000),
  persistenceAlertCooldownMs: z.number().int().nonnegative().optional().default(60_000),

  marketFilters: z.object({
    sessionFilterEnabled: z.boolean().default(false),
    allowedSessions: z.array(z.enum(["ASIA", "LONDON", "NEW_YORK"])).default(["LONDON", "NEW_YORK"]),
    spreadFilterEnabled: z.boolean().default(false),
    maxSpreadPoints: z.number().nonnegative().default(1.0),
    newsFilterEnabled: z.boolean().default(false),
    newsWindowMinutes: z.number().nonnegative().default(30),
  }).default({}),

  fixturesDir: z.string().default("./fixtures"),

  features: z.object({
    aiEnabled: z.boolean().default(true),
    persistenceEnabled: z.boolean().default(true),
    telegramEnabled: z.boolean().default(false),
    experienceMemoryEnabled: z.boolean().default(false),
    strongCandleStrategy: z.boolean().default(true),
    dashboardEnabled: z.boolean().default(false),
  }),

  mt5: z.object({
    enabled: z.boolean().default(false),
    bridgeUrl: z.string().url().or(z.literal("")).default(""),
    brokerSymbolXauusd: z.string().default("XAUUSD"),
    accountId: z.string().default(""),
    server: z.string().default(""),
  }).default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface ConfigSource {
  load(): Record<string, unknown>;
  name: string;
}

export class ConfigError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[] = []) {
    super(message);
    this.name = "ConfigError";
  }
}

export class VersionedConfig<T extends z.ZodTypeAny> {
  constructor(
    private readonly schema: T,
    private readonly sources: ConfigSource[],
    private readonly onValidation: (issues: z.ZodIssue[]) => void
  ) {}

  private version = 1;
  private overrides: Record<string, unknown> = {};
  private history: { version: number; at: number; change: Record<string, unknown>; source: string }[] = [];
  private value!: z.infer<T>;

  load(): z.infer<T> {
    const merged: Record<string, unknown> = {};
    for (const src of this.sources) {
      Object.assign(merged, src.load());
    }
    Object.assign(merged, this.overrides);
    const parsed = this.schema.safeParse(merged);
    if (!parsed.success) {
      this.onValidation(parsed.error.issues);
      throw new ConfigError(`config invalid (sources: ${this.sources.map((s) => s.name).join(", ")})`, parsed.error.issues);
    }
    this.value = parsed.data;
    return this.value;
  }

  get(): z.infer<T> {
    if (!this.value) this.load();
    return this.value;
  }

  applyOverrides(patch: Record<string, unknown>, source: string): z.infer<T> {
    const candidate = this.schema.safeParse({ ...this.flatten(), ...patch });
    if (!candidate.success) {
      throw new ConfigError(`override rejected: ${candidate.error.issues.map((i) => i.path.join(".")).join(", ")}`, candidate.error.issues);
    }
    this.overrides = { ...this.overrides, ...patch };
    this.version += 1;
    this.history.push({ version: this.version, at: Date.now(), change: patch, source });
    return this.load();
  }

  rollback(): z.infer<T> {
    const last = this.history.pop();
    if (!last) return this.get();
    for (const key of Object.keys(last.change)) {
      delete this.overrides[key];
    }
    this.version += 1;
    return this.load();
  }

  getVersion(): number {
    return this.version;
  }

  getHistory(): readonly { version: number; at: number; change: Record<string, unknown>; source: string }[] {
    return this.history;
  }

  private flatten(): Record<string, unknown> {
    return this.value ? { ...this.value } : {};
  }
}

export function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function list(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  const items = v.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}
