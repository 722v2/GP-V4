import fs from "node:fs";
import path from "node:path";
import { AppConfigSchema, type AppConfig } from "./AppConfig.js";

export interface RuntimeConfigAuditEntry {
  id: string;
  timestamp: number;
  updatedBy: string;
  section: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface ConfigPersistenceProvider {
  name: string;
  load(): Promise<{ config: Partial<AppConfig>; audit?: RuntimeConfigAuditEntry[] } | null>;
  save(config: AppConfig, audit: RuntimeConfigAuditEntry[], updatedBy: string): Promise<void>;
}

/**
 * Default Canonical Safe Operational Configuration.
 * ZERO-CONFIG DEV/TEST defaults.
 */
export const DEFAULT_RUNTIME_CONFIG: AppConfig = {
  mode: "ANALYSIS_ONLY",
  symbols: ["XAUUSD"],
  timeframes: ["M1", "M5", "M15", "H1"],
  scanIntervalMs: 60_000,
  strategyExpiryBars: 6,
  fixturesDir: "./fixtures",

  risk: {
    accountEquity: 10_000, // Safe DEV / SIMULATED ACCOUNT CAPITAL
    perTradePct: 0.5,
    minRiskPerTradePct: 0.01,
    maxRiskPerTradePct: 5.0,
    dailyLossCapPct: 3.0,
    weeklyLossCapPct: 6.0,
    maxDrawdownPct: 10.0,
    maxOpenTrades: 2,
    netExposureMax: 1.5,
    marginCeilingPct: 50.0,
    minStopDistancePts: 1.0,
    maxStopDistancePts: 50.0,
    maxLot: 10.0,
  },

  marketFilters: {
    sessionFilterEnabled: false,
    allowedSessions: ["LONDON", "NEW_YORK"],
    spreadFilterEnabled: false,
    maxSpreadPoints: 1.0,
    newsFilterEnabled: false,
    newsWindowMinutes: 30,
  },

  ai: {
    provider: "novita",
    baseUrl: "https://api.novita.ai/v3/openai",
    apiKey: "", // Secret - remains empty in zero-config
    model: "deepseek/deepseek-r1",
    m5Model: "",
    timeoutMs: 45_000,
    m5TimeoutMs: 15_000,
    maxRetries: 1,
    retryInitialDelayMs: 500,
    retryMaxDelayMs: 4000,
    minConfidence: 0.6,
    levelTolerancePts: 1.0,
    hourlyBudgetUsd: 1.0,
    dailyBudgetUsd: 10.0,
    cacheTtlMs: 120_000,
  },

  biquiti: {
    baseUrl: "",
    apiKey: "", // Secret
    candlesPath: "/v1/candles",
    authHeader: "Authorization",
    symbolMap: { XAUUSD: "" },
    timeoutMs: 10_000,
  },

  supabase: {
    url: "",
    serviceKey: "", // Secret
  },

  telegram: {
    botToken: "", // Secret
    chatId: "",
    enabled: false,
  },

  execution: {
    venue: "SIMULATED",
    spreadPoints: 0.35,
    slippagePoints: 0.2,
    latencyMs: 250,
  },

  features: {
    aiEnabled: true,
    persistenceEnabled: true,
    telegramEnabled: false,
    experienceMemoryEnabled: false,
    strongCandleStrategy: true,
    dashboardEnabled: true,
  },

  mt5: {
    enabled: false,
    bridgeUrl: "",
    brokerSymbolXauusd: "XAUUSD",
    accountId: "",
    server: "",
  },

  persistenceMaxRetries: 3,
  persistenceInitialRetryDelayMs: 500,
  persistenceMaxRetryDelayMs: 4000,
  persistenceAlertCooldownMs: 60_000,
};

/**
 * Local File Persistence Provider for DEV/TEST environment.
 * Persists non-secret runtime configuration to disk so settings survive server restarts without Supabase.
 */
export class DevLocalConfigPersistence implements ConfigPersistenceProvider {
  readonly name = "dev-local-file";
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.GP_RUNTIME_CONFIG_PATH || path.resolve(process.cwd(), "data", "runtime-config.json");
  }

  async load(): Promise<{ config: Partial<AppConfig>; audit?: RuntimeConfigAuditEntry[] } | null> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        config: parsed.config || {},
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      };
    } catch {
      return null;
    }
  }

  async save(config: AppConfig, audit: RuntimeConfigAuditEntry[], _updatedBy: string): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Never write secrets into file store
      const sanitized = sanitizeConfigForStorage(config);
      const data = {
        savedAt: Date.now(),
        updatedBy: _updatedBy,
        config: sanitized,
        audit: audit.slice(0, 50),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // In read-only filesystems, gracefully ignore file write error
    }
  }
}

/**
 * In-Memory Persistence Provider (fallback / isolated tests).
 */
export class InMemoryConfigPersistence implements ConfigPersistenceProvider {
  readonly name = "in-memory";
  private saved: { config: Partial<AppConfig>; audit: RuntimeConfigAuditEntry[] } | null = null;

  async load(): Promise<{ config: Partial<AppConfig>; audit?: RuntimeConfigAuditEntry[] } | null> {
    return this.saved;
  }

  async save(config: AppConfig, audit: RuntimeConfigAuditEntry[], _updatedBy: string): Promise<void> {
    this.saved = {
      config: sanitizeConfigForStorage(config),
      audit: [...audit],
    };
  }
}

/**
 * Deep merge helper for configuration patches.
 */
function deepMerge<T extends Record<string, any>>(target: T, patch: Record<string, any>): T {
  const output = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (target as any)[key] === "object" &&
      !Array.isArray((target as any)[key])
    ) {
      (output as any)[key] = deepMerge((target as any)[key] ?? {}, value);
    } else {
      (output as any)[key] = value;
    }
  }
  return output;
}

/**
 * Removes secrets prior to writing to dev config storage or returning via UI.
 */
function sanitizeConfigForStorage(cfg: AppConfig): Partial<AppConfig> {
  const clone = JSON.parse(JSON.stringify(cfg));
  if (clone.biquiti) delete clone.biquiti.apiKey;
  if (clone.ai) delete clone.ai.apiKey;
  if (clone.supabase) delete clone.supabase.serviceKey;
  if (clone.telegram) delete clone.telegram.botToken;
  return clone;
}

/**
 * Primary Runtime Configuration Store.
 * Canonical Source of Truth for all operational configuration.
 */
export class RuntimeConfigStore {
  private config: AppConfig;
  private auditHistory: RuntimeConfigAuditEntry[] = [];
  private listeners: Array<(newCfg: AppConfig, oldCfg: AppConfig, changedSections: string[]) => void> = [];

  constructor(
    initialConfig?: AppConfig,
    private readonly persistence: ConfigPersistenceProvider = new DevLocalConfigPersistence()
  ) {
    this.config = initialConfig ? { ...initialConfig } : { ...DEFAULT_RUNTIME_CONFIG };
  }

  /**
   * Initializes store by loading persisted overrides (if any) and merging over defaults.
   */
  async init(): Promise<AppConfig> {
    try {
      const persisted = await this.persistence.load();
      if (persisted?.config) {
        const merged = deepMerge(this.config, persisted.config);
        const parsed = AppConfigSchema.safeParse(merged);
        if (parsed.success) {
          this.config = parsed.data;
        }
      }
      if (persisted?.audit) {
        this.auditHistory = persisted.audit;
      }
    } catch {
      // Retain safe defaults on load error
    }
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  getAuditHistory(): readonly RuntimeConfigAuditEntry[] {
    return this.auditHistory;
  }

  /**
   * Returns sanitized configuration safe to send to UI / browser clients.
   * Redacts all sensitive API keys and secrets.
   */
  getSanitized(): Record<string, unknown> {
    return {
      mode: this.config.mode,
      symbols: this.config.symbols,
      timeframes: this.config.timeframes,
      scanIntervalMs: this.config.scanIntervalMs,
      strategyExpiryBars: this.config.strategyExpiryBars,
      features: this.config.features,
      risk: this.config.risk,
      execution: {
        ...this.config.execution,
        mode: "SIMULATED",
        isLive: false,
      },
      marketFilters: this.config.marketFilters,
      ai: {
        model: this.config.ai.model,
        m5Model: this.config.ai.m5Model,
        minConfidence: this.config.ai.minConfidence,
        timeoutMs: this.config.ai.timeoutMs,
        m5TimeoutMs: this.config.ai.m5TimeoutMs,
        levelTolerancePts: this.config.ai.levelTolerancePts,
        maxRetries: this.config.ai.maxRetries,
        isConfigured: Boolean(this.config.ai.apiKey && this.config.features.aiEnabled),
      },
      biquiti: {
        baseUrl: this.config.biquiti.baseUrl,
        candlesPath: this.config.biquiti.candlesPath,
        authHeader: this.config.biquiti.authHeader,
        timeoutMs: this.config.biquiti.timeoutMs,
        isConfigured: Boolean(this.config.biquiti.baseUrl),
      },
      supabase: {
        isConfigured: Boolean(this.config.supabase.url && this.config.supabase.serviceKey),
        persistenceEnabled: this.config.features.persistenceEnabled,
        maxRetries: this.config.persistenceMaxRetries,
      },
      telegram: {
        enabled: this.config.features.telegramEnabled,
        chatId: this.config.telegram.chatId,
        chatIdConfigured: Boolean(this.config.telegram.chatId),
        isConfigured: Boolean(this.config.telegram.botToken && this.config.features.telegramEnabled),
      },
      mt5: {
        enabled: this.config.mt5.enabled,
        bridgeUrl: this.config.mt5.bridgeUrl,
        brokerSymbolXauusd: this.config.mt5.brokerSymbolXauusd,
        accountId: this.config.mt5.accountId,
        server: this.config.mt5.server,
      },
      readOnly: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Updates runtime configuration atomically, validates via schema, records audit, persists, and notifies.
   */
  async update(
    patch: Record<string, unknown>,
    updatedBy = "operator"
  ): Promise<{ config: AppConfig; changedSections: string[]; audit: RuntimeConfigAuditEntry }> {
    const candidate = deepMerge(this.config, patch);
    const parsed = AppConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid configuration: ${issues}`);
    }

    const oldConfig = this.config;
    const newConfig = parsed.data;

    // Detect changed sections & fields
    const changedSections = new Set<string>();
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const [key, val] of Object.entries(patch)) {
      if (val !== undefined && JSON.stringify((oldConfig as any)[key]) !== JSON.stringify((newConfig as any)[key])) {
        changedSections.add(key);
        changes[key] = { from: (oldConfig as any)[key], to: (newConfig as any)[key] };
      }
    }

    const auditEntry: RuntimeConfigAuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      updatedBy,
      section: Array.from(changedSections).join(", ") || "config",
      changes,
    };

    this.auditHistory.unshift(auditEntry);
    if (this.auditHistory.length > 50) {
      this.auditHistory = this.auditHistory.slice(0, 50);
    }

    this.config = newConfig;

    // Persist to provider
    await this.persistence.save(this.config, this.auditHistory, updatedBy);

    // Notify listeners
    const sectionsArray = Array.from(changedSections);
    for (const listener of this.listeners) {
      try {
        listener(newConfig, oldConfig, sectionsArray);
      } catch (err) {
        console.error("Config listener error:", err);
      }
    }

    return { config: newConfig, changedSections: sectionsArray, audit: auditEntry };
  }

  onConfigChange(listener: (newCfg: AppConfig, oldCfg: AppConfig, changedSections: string[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Applies the updated configuration to an active AppRuntime graph dynamically without server restart.
   */
  applyToAppRuntime(app: any): void {
    const cfg = this.config;

    // 1. Account Equity & Risk Engine
    if (app.riskTracker && typeof app.riskTracker.updateInitialEquity === "function") {
      app.riskTracker.updateInitialEquity(cfg.risk.accountEquity);
    }

    // 2. Scanner Scheduler Interval
    if (app.scheduler && typeof app.scheduler.updateInterval === "function") {
      app.scheduler.updateInterval(cfg.scanIntervalMs);
    }

    // 3. Market Filters
    if (app.marketFilterEngine && typeof app.marketFilterEngine.updateConfig === "function") {
      app.marketFilterEngine.updateConfig(cfg.marketFilters);
    }

    // 4. Spread & Slippage Model
    if (app.spreadModel && typeof app.spreadModel.update === "function") {
      app.spreadModel.update(cfg.execution.spreadPoints, cfg.execution.slippagePoints, cfg.execution.latencyMs);
    }

    // 5. AI Router Non-Secret Parameters
    if (app.ai && typeof app.ai.updateConfig === "function") {
      app.ai.updateConfig({
        enabled: cfg.features.aiEnabled,
        minConfidence: cfg.ai.minConfidence,
        levelTolerancePts: cfg.ai.levelTolerancePts,
        timeoutMs: cfg.ai.timeoutMs,
        m5TimeoutMs: cfg.ai.m5TimeoutMs,
        m5Model: cfg.ai.m5Model,
        maxRetries: cfg.ai.maxRetries,
      });
    }

    // 6. Repository settings sync if available
    if (app.repo && typeof app.repo.saveSettings === "function") {
      app.repo.saveSettings(cfg, "runtime-store").catch(() => {});
    }
  }
}
