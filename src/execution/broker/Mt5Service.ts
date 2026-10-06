import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../../core/logging/Logger.js";
import { createConsoleLogger } from "../../core/logging/Logger.js";
import type {
  BrokerAccountInfo,
  BrokerHealth,
  BrokerOrder,
  BrokerPosition,
  BrokerQuote,
} from "./BrokerAdapter.js";
import type { InstrumentSpec } from "../../risk/InstrumentSpec.js";
import { HttpMt5BridgeClient, JustMarketsMt5Adapter } from "./JustMarketsMt5Adapter.js";

export type Mt5ConnectionStatus =
  | "NOT_CONFIGURED"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "ERROR"
  | "RECONCILIATION_REQUIRED";

export interface Mt5AccountConfig {
  readonly enabled: boolean;
  readonly broker: string;
  readonly bridgeUrl: string;
  readonly accountId: string;
  readonly server: string;
  readonly brokerSymbolXauusd: string;
  readonly password?: string;
}

export interface Mt5SanitizedStatus {
  readonly status: Mt5ConnectionStatus;
  readonly isConfigured: boolean;
  readonly broker: string;
  readonly bridgeUrl: string;
  readonly accountId: string;
  readonly server: string;
  readonly brokerSymbolXauusd: string;
  readonly lastConnectedAt: number | null;
  readonly lastError: string | null;
  readonly lastCheckedAt: number;
  readonly account: {
    readonly accountId: string;
    readonly balance: number;
    readonly equity: number;
    readonly margin: number;
    readonly freeMargin: number;
    readonly marginLevel: number | null;
    readonly currency: string;
    readonly leverage?: number;
    readonly serverTime: number;
  } | null;
  readonly instrumentSpec: InstrumentSpec | null;
  readonly openPositions: readonly BrokerPosition[];
  readonly pendingOrders: readonly BrokerOrder[];
  readonly quote: BrokerQuote | null;
  readonly healthDetail: string;
}

/**
 * Central Service for MT5 Real Account Management.
 * Manages secure credentials persistence, lifecycle, live connection verification,
 * and state synchronization between GP-V4 and MetaTrader 5.
 */
export class Mt5Service {
  private config: Mt5AccountConfig;
  private adapter: JustMarketsMt5Adapter | null = null;
  private bridgeClient: HttpMt5BridgeClient | null = null;
  private status: Mt5ConnectionStatus = "NOT_CONFIGURED";
  private lastConnectedAt: number | null = null;
  private lastError: string | null = null;
  private lastCheckedAt: number = Date.now();
  private readonly configFilePath: string;

  constructor(
    initialConfig?: Partial<Mt5AccountConfig>,
    private readonly log: Logger = createConsoleLogger("mt5-service"),
    customConfigPath?: string
  ) {
    this.configFilePath =
      customConfigPath ||
      process.env.GP_MT5_CONFIG_PATH ||
      path.resolve(process.cwd(), "data", "mt5-account.json");

    this.config = {
      enabled: Boolean(initialConfig?.enabled),
      broker: initialConfig?.broker || "JustMarkets",
      bridgeUrl: initialConfig?.bridgeUrl || "",
      accountId: initialConfig?.accountId || "",
      server: initialConfig?.server || "",
      brokerSymbolXauusd: initialConfig?.brokerSymbolXauusd || "XAUUSD",
      password: initialConfig?.password || "",
    };

    this.loadPersistedConfig();
    this.rebuildAdapter();
  }

  private loadPersistedConfig(): void {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.config = {
            enabled: Boolean(parsed.enabled),
            broker: parsed.broker || "JustMarkets",
            bridgeUrl: parsed.bridgeUrl || "",
            accountId: parsed.accountId || "",
            server: parsed.server || "",
            brokerSymbolXauusd: parsed.brokerSymbolXauusd || "XAUUSD",
            password: parsed.password || "",
          };
          this.lastConnectedAt = parsed.lastConnectedAt || null;
        }
      }
    } catch (err: any) {
      this.log.warn("failed to load persisted MT5 account config", { err: err.message });
    }
  }

  private savePersistedConfig(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        savedAt: Date.now(),
        ...this.config,
        lastConnectedAt: this.lastConnectedAt,
      };
      fs.writeFileSync(this.configFilePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err: any) {
      this.log.error("failed to save MT5 account config", err);
    }
  }

  private rebuildAdapter(): void {
    if (!this.config.bridgeUrl || !this.config.accountId) {
      this.status = "NOT_CONFIGURED";
      this.adapter = null;
      this.bridgeClient = null;
      return;
    }

    this.bridgeClient = new HttpMt5BridgeClient(
      this.config.bridgeUrl,
      this.config.accountId,
      this.config.server,
      this.log.child("bridge")
    );

    this.adapter = new JustMarketsMt5Adapter(
      this.bridgeClient,
      this.config.brokerSymbolXauusd,
      this.log.child("adapter")
    );

    this.status = "DISCONNECTED";
  }

  getAdapter(): JustMarketsMt5Adapter | null {
    return this.adapter;
  }

  isConfigured(): boolean {
    return Boolean(this.config.bridgeUrl && this.config.accountId);
  }

  async testConnection(): Promise<{ success: boolean; status: Mt5ConnectionStatus; detail: string; error?: string }> {
    this.lastCheckedAt = Date.now();
    if (!this.isConfigured()) {
      this.status = "NOT_CONFIGURED";
      this.lastError = "MT5 bridge URL or Account ID is not configured";
      return { success: false, status: "NOT_CONFIGURED", detail: this.lastError };
    }

    this.status = "CONNECTING";
    try {
      if (!this.adapter) this.rebuildAdapter();
      const health = await this.adapter!.getHealth();

      if (health.connected) {
        this.status = "CONNECTED";
        this.lastConnectedAt = Date.now();
        this.lastError = null;
        this.savePersistedConfig();
        return { success: true, status: "CONNECTED", detail: health.detail || "MT5 Bridge & Terminal connected successfully" };
      } else if (health.status === "DEGRADED") {
        this.status = "DEGRADED";
        this.lastError = health.detail;
        return { success: false, status: "DEGRADED", detail: health.detail };
      } else {
        this.status = "DISCONNECTED";
        this.lastError = health.detail;
        return { success: false, status: "DISCONNECTED", detail: health.detail };
      }
    } catch (err: any) {
      this.status = "ERROR";
      const errMsg = err?.message || String(err);
      this.lastError = errMsg;
      return { success: false, status: "ERROR", detail: errMsg, error: errMsg };
    }
  }

  async disconnect(): Promise<void> {
    this.status = "DISCONNECTED";
    this.lastCheckedAt = Date.now();
  }

  async getSanitizedStatus(): Promise<Mt5SanitizedStatus> {
    this.lastCheckedAt = Date.now();
    const isConf = this.isConfigured();

    let account: Mt5SanitizedStatus["account"] = null;
    let spec: InstrumentSpec | null = null;
    let positions: readonly BrokerPosition[] = [];
    let orders: readonly BrokerOrder[] = [];
    let quote: BrokerQuote | null = null;
    let healthDetail = isConf ? "Configured — awaiting connection verification" : "MT5 account not configured";

    if (isConf && this.adapter) {
      try {
        const health = await this.adapter.getHealth();
        if (health.connected) {
          this.status = "CONNECTED";
          this.lastConnectedAt = Date.now();
          healthDetail = health.detail || "Connected";

          // Broker is source of truth for account state
          const accInfo = await this.adapter.getAccountInfo();
          const marginLevel = accInfo.margin > 0 ? (accInfo.equity / accInfo.margin) * 100 : null;
          account = {
            accountId: accInfo.accountId,
            balance: accInfo.balance,
            equity: accInfo.equity,
            margin: accInfo.margin,
            freeMargin: accInfo.freeMargin,
            marginLevel: marginLevel !== null ? Math.round(marginLevel * 100) / 100 : null,
            currency: accInfo.currency,
            leverage: accInfo.leverage,
            serverTime: accInfo.serverTime,
          };

          try {
            spec = await this.adapter.getInstrumentSpec("XAUUSD");
          } catch {
            spec = null;
          }

          positions = await this.adapter.getOpenPositions();
          orders = await this.adapter.getPendingOrders();
          quote = await this.adapter.getQuote("XAUUSD");
        } else {
          this.status = health.status === "DEGRADED" ? "DEGRADED" : "DISCONNECTED";
          healthDetail = health.detail;
        }
      } catch (err: any) {
        this.status = "ERROR";
        const errMsg = err?.message || String(err);
        this.lastError = errMsg;
        healthDetail = errMsg;
      }
    } else {
      this.status = "NOT_CONFIGURED";
    }

    return {
      status: this.status,
      isConfigured: isConf,
      broker: this.config.broker,
      bridgeUrl: this.config.bridgeUrl,
      accountId: this.config.accountId,
      server: this.config.server,
      brokerSymbolXauusd: this.config.brokerSymbolXauusd,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      account,
      instrumentSpec: spec,
      openPositions: positions,
      pendingOrders: orders,
      quote,
      healthDetail,
    };
  }

  async saveAccount(cfg: Partial<Mt5AccountConfig>): Promise<Mt5SanitizedStatus> {
    this.config = {
      enabled: cfg.enabled ?? true,
      broker: cfg.broker || "JustMarkets",
      bridgeUrl: (cfg.bridgeUrl || "").trim(),
      accountId: (cfg.accountId || "").trim(),
      server: (cfg.server || "").trim(),
      brokerSymbolXauusd: (cfg.brokerSymbolXauusd || "XAUUSD").trim(),
      password: cfg.password ? cfg.password.trim() : this.config.password || "",
    };

    this.savePersistedConfig();
    this.rebuildAdapter();
    this.lastError = null;

    if (this.isConfigured()) {
      await this.testConnection();
    }

    return this.getSanitizedStatus();
  }

  async deleteAccount(): Promise<void> {
    // 1. Invalidate active broker connection
    this.status = "NOT_CONFIGURED";
    this.adapter = null;
    this.bridgeClient = null;
    this.lastError = null;
    this.lastConnectedAt = null;

    // 2. Clear credentials & config
    this.config = {
      enabled: false,
      broker: "JustMarkets",
      bridgeUrl: "",
      accountId: "",
      server: "",
      brokerSymbolXauusd: "XAUUSD",
      password: "",
    };

    // 3. Remove persisted file completely
    try {
      if (fs.existsSync(this.configFilePath)) {
        fs.unlinkSync(this.configFilePath);
      }
    } catch (err: any) {
      this.log.warn("error removing MT5 config file", { err: err.message });
    }
  }
}
