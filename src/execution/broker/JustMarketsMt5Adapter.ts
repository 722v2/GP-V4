import type {
  BrokerAdapter,
  BrokerAccountInfo,
  BrokerHealth,
  BrokerOrder,
  BrokerPosition,
  BrokerQuote,
  OrderExecutionResult,
  OrderSubmissionRequest,
  PositionCloseResult,
  ProtectionModificationResult,
  OrderStatus,
  ProtectionStatus,
} from "./BrokerAdapter.js";
import type { InstrumentSpec } from "../../risk/InstrumentSpec.js";
import { validateInstrumentSpec } from "../../risk/InstrumentSpec.js";
import type { Logger } from "../../core/logging/Logger.js";
import { createConsoleLogger } from "../../core/logging/Logger.js";

/**
 * Clean interface describing the MetaTrader 5 Bridge/Gateway Contract
 * as per connection architecture guidelines.
 */
export interface Mt5BridgeClient {
  getHealth(): Promise<{
    connected: boolean;
    status: "READY" | "DEGRADED" | "DISCONNECTED" | "NOT_CONFIGURED";
    serverTime: number;
    latencyMs: number;
    terminalConnected: boolean;
    detail: string;
  }>;
  getAccountInfo(): Promise<{
    accountId: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    currency: string;
    leverage?: number;
    tradingAllowed: boolean;
    investorMode: boolean;
  }>;
  getSymbolSpec(brokerSymbol: string): Promise<{
    symbol: string;
    digits: number;
    point: number;
    tickSize: number;
    tickValue: number;
    contractSize: number;
    volumeMin: number;
    volumeMax: number;
    volumeStep: number;
    tradeMode: string;
    stopsLevel: number;
    freezeLevel: number;
    currency: string;
  } | null>;
  getQuote(brokerSymbol: string): Promise<{
    symbol: string;
    bid: number;
    ask: number;
    time: number;
  } | null>;
  getOpenPositions(): Promise<any[]>;
  getPendingOrders(): Promise<any[]>;
  submitOrder(order: any): Promise<any>;
  closePosition(positionId: string, volume: number, closePrice?: number): Promise<any>;
  modifyProtection(positionId: string, sl?: number, tp?: number): Promise<any>;
  getOrderStatus(orderId: string): Promise<any>;
}

/**
 * Standard HTTP/REST implementation of the MT5 Bridge Gateway client.
 * Connects to the external MT5 bridge URL and maps endpoints.
 */
export class HttpMt5BridgeClient implements Mt5BridgeClient {
  constructor(
    private readonly bridgeUrl: string,
    private readonly accountId: string,
    private readonly server: string,
    private readonly log: Logger
  ) {}

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-MT5-Account": this.accountId,
      "X-MT5-Server": this.server,
    };
  }

  async getHealth() {
    if (!this.bridgeUrl) {
      return {
        connected: false,
        status: "NOT_CONFIGURED" as const,
        serverTime: Date.now(),
        latencyMs: 0,
        terminalConnected: false,
        detail: "MT5 Bridge URL is empty.",
      };
    }
    try {
      const t0 = Date.now();
      const res = await fetch(`${this.bridgeUrl}/health`, { headers: this.headers, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        return {
          connected: false,
          status: "DEGRADED" as const,
          serverTime: Date.now(),
          latencyMs,
          terminalConnected: false,
          detail: `Bridge HTTP error: ${res.status}`,
        };
      }
      const data = (await res.json()) as any;
      return {
        connected: Boolean(data.connected),
        status: (data.status || "READY") as "READY" | "DEGRADED" | "DISCONNECTED" | "NOT_CONFIGURED",
        serverTime: data.serverTime || Date.now(),
        latencyMs,
        terminalConnected: Boolean(data.terminalConnected),
        detail: data.detail || "Bridge healthy",
      };
    } catch (err: any) {
      return {
        connected: false,
        status: "DISCONNECTED" as const,
        serverTime: Date.now(),
        latencyMs: 0,
        terminalConnected: false,
        detail: `Bridge unreachable: ${err.message}`,
      };
    }
  }

  async getAccountInfo() {
    if (!this.bridgeUrl) throw new Error("Bridge not configured");
    const res = await fetch(`${this.bridgeUrl}/account`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to fetch MT5 account info: ${res.statusText}`);
    return (await res.json()) as any;
  }

  async getSymbolSpec(brokerSymbol: string) {
    if (!this.bridgeUrl) return null;
    const res = await fetch(`${this.bridgeUrl}/symbol/${brokerSymbol}`, { headers: this.headers });
    if (!res.ok) {
      this.log.warn(`Could not retrieve spec for broker symbol ${brokerSymbol}: ${res.statusText}`);
      return null;
    }
    return (await res.json()) as any;
  }

  async getQuote(brokerSymbol: string) {
    if (!this.bridgeUrl) return null;
    const res = await fetch(`${this.bridgeUrl}/quote/${brokerSymbol}`, { headers: this.headers });
    if (!res.ok) {
      this.log.warn(`Could not retrieve quote for broker symbol ${brokerSymbol}: ${res.statusText}`);
      return null;
    }
    return (await res.json()) as any;
  }

  async getOpenPositions() {
    if (!this.bridgeUrl) return [];
    const res = await fetch(`${this.bridgeUrl}/positions`, { headers: this.headers });
    if (!res.ok) return [];
    return (await res.json()) as any[];
  }

  async getPendingOrders() {
    if (!this.bridgeUrl) return [];
    const res = await fetch(`${this.bridgeUrl}/orders`, { headers: this.headers });
    if (!res.ok) return [];
    return (await res.json()) as any[];
  }

  async submitOrder(order: any) {
    if (!this.bridgeUrl) throw new Error("Bridge not configured");
    const res = await fetch(`${this.bridgeUrl}/order`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(order),
    });
    if (!res.ok) throw new Error(`Failed to submit order: ${res.statusText}`);
    return res.json();
  }

  async closePosition(positionId: string, volume: number, closePrice?: number) {
    if (!this.bridgeUrl) throw new Error("Bridge not configured");
    const res = await fetch(`${this.bridgeUrl}/position/${positionId}/close`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ volume, closePrice }),
    });
    if (!res.ok) throw new Error(`Failed to close position: ${res.statusText}`);
    return res.json();
  }

  async modifyProtection(positionId: string, sl?: number, tp?: number) {
    if (!this.bridgeUrl) throw new Error("Bridge not configured");
    const res = await fetch(`${this.bridgeUrl}/position/${positionId}/protection`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ sl, tp }),
    });
    if (!res.ok) throw new Error(`Failed to modify protection: ${res.statusText}`);
    return res.json();
  }

  async getOrderStatus(orderId: string) {
    if (!this.bridgeUrl) return null;
    const res = await fetch(`${this.bridgeUrl}/order/${orderId}`, { headers: this.headers });
    if (!res.ok) return null;
    return res.json();
  }
}

/**
 * JustMarkets MT5 Broker Adapter.
 * Integrates GP-V4 execution pipeline with MetaTrader 5 via HttpMt5BridgeClient.
 */
export class JustMarketsMt5Adapter implements BrokerAdapter {
  readonly name = "JustMarkets (MT5)";
  readonly isSimulated = false;
  private readonly brokerSymbol: string;
  private readonly log: Logger;

  constructor(
    private readonly bridge: Mt5BridgeClient,
    brokerSymbol?: string,
    log?: Logger
  ) {
    this.brokerSymbol = brokerSymbol || "XAUUSD";
    this.log = log || createConsoleLogger("justmarkets-mt5");
  }

  async getHealth(): Promise<BrokerHealth> {
    const bridgeHealth = await this.bridge.getHealth();
    let detail = bridgeHealth.detail;
    let status = bridgeHealth.status;

    if (bridgeHealth.connected && !bridgeHealth.terminalConnected) {
      status = "DEGRADED";
      detail = "Bridge is running but disconnected from MT5 Terminal.";
    }

    return {
      name: this.name,
      connected: bridgeHealth.connected && bridgeHealth.terminalConnected,
      status,
      isSimulated: false,
      latencyMs: bridgeHealth.latencyMs,
      serverTime: bridgeHealth.serverTime,
      detail,
      capabilities: {
        supportsPendingOrders: true,
        supportsBrokerSideProtection: true,
        supportsTrailingStop: false,
        supportsPartialClose: true,
        supportsMarketOrders: true,
      },
    };
  }

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    try {
      const h = await this.getHealth();
      if (!h.connected) {
        return this.getUnconnectedAccount();
      }
      const acc = await this.bridge.getAccountInfo();
      return {
        accountId: acc.accountId || "UNKNOWN",
        balance: acc.balance,
        equity: acc.equity,
        margin: acc.margin,
        freeMargin: acc.freeMargin,
        currency: acc.currency || "USD",
        leverage: acc.leverage,
        serverTime: Date.now(),
        isSimulated: false,
      };
    } catch (err: any) {
      this.log.error(`Failed to retrieve account info: ${err.message}`);
      return this.getUnconnectedAccount();
    }
  }

  private getUnconnectedAccount(): BrokerAccountInfo {
    return {
      accountId: "UNCONNECTED",
      equity: 0,
      balance: 0,
      margin: 0,
      freeMargin: 0,
      currency: "USD",
      serverTime: Date.now(),
      isSimulated: false,
    };
  }

  async getInstrumentSpec(symbol: string): Promise<InstrumentSpec> {
    // Return specs ONLY from actual retrieved MT5 broker values, separating canonical from broker symbol.
    if (symbol !== "XAUUSD") {
      throw new Error(`Symbol ${symbol} is unsupported. JustMarkets adapter only supports XAUUSD.`);
    }

    try {
      const spec = await this.bridge.getSymbolSpec(this.brokerSymbol);
      if (!spec) {
        throw new Error(`Spec retrieval failed for MT5 symbol: ${this.brokerSymbol}. Specifications must come from the actual MT5 symbol.`);
      }

      // Explicitly map properties, preventing guessed values or substitutes
      const mappedSpec: InstrumentSpec = {
        symbol: "XAUUSD",
        canonicalSymbol: "XAUUSD",
        brokerSymbol: this.brokerSymbol,
        baseCurrency: "XAU",
        quoteCurrency: spec.currency || "USD",
        digits: spec.digits,
        pointSize: spec.point,
        tickSize: spec.tickSize,
        tickValue: spec.tickValue,
        contractSize: spec.contractSize,
        minLot: spec.volumeMin,
        maxLot: spec.volumeMax,
        lotStep: spec.volumeStep,
        minStopDistancePts: spec.stopsLevel,
        freezeLevelPts: spec.freezeLevel,
        tradingSessions: ["23:00-22:00 UTC"],
      };

      const val = validateInstrumentSpec(mappedSpec);
      if (!val.valid) {
        throw new Error(`Invalid mapped instrument spec: ${val.errors.join("; ")}`);
      }

      return mappedSpec;
    } catch (err: any) {
      this.log.error(`Broker symbol spec retrieval failed: ${err.message}`);
      // Throw specific error to let callers know BROKER_STATUS = UNVERIFIED
      throw new Error(`UNVERIFIED: MT5 specification cannot be retrieved. Live execution blocked. Reason: ${err.message}`);
    }
  }

  async getQuote(symbol: string): Promise<BrokerQuote | null> {
    if (symbol !== "XAUUSD") return null;
    try {
      const q = await this.bridge.getQuote(this.brokerSymbol);
      if (!q) return null;

      const bid = q.bid;
      const ask = q.ask;

      if (bid <= 0 || ask <= 0 || ask < bid) {
        this.log.warn(`Invalid bid/ask quote prices: bid=${bid}, ask=${ask}`);
        return null;
      }

      const spread = parseFloat((ask - bid).toFixed(4));
      const timestamp = q.time || Date.now();

      // Quote freshness check (e.g. within last 30 seconds)
      const isFresh = Date.now() - timestamp < 30_000;
      if (!isFresh) {
        this.log.warn(`Stale quote detected for ${this.brokerSymbol}: timestamp=${timestamp}`);
        return null;
      }

      return {
        symbol: "XAUUSD",
        bid,
        ask,
        spread,
        timestamp,
      };
    } catch {
      return null;
    }
  }

  async getOpenPositions(): Promise<readonly BrokerPosition[]> {
    try {
      const posList = await this.bridge.getOpenPositions();
      return posList.map((p) => ({
        positionId: String(p.positionId),
        tradeId: p.tradeId,
        symbol: "XAUUSD",
        side: (p.direction === "SHORT" || p.side === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
        lotSize: p.volume || p.lotSize,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        stopLoss: p.sl || p.stopLoss,
        takeProfit: p.tp || p.takeProfit,
        unrealizedPnl: p.profit || p.unrealizedPnl,
        openedAt: p.time || p.openedAt || Date.now(),
        state: "OPEN" as const,
        protectionStatus: (p.sl && p.tp ? "PROTECTED" : p.sl || p.tp ? "PARTIALLY_PROTECTED" : "UNPROTECTED") as ProtectionStatus,
      }));
    } catch {
      return [];
    }
  }

  async getPendingOrders(): Promise<readonly BrokerOrder[]> {
    try {
      const ordList = await this.bridge.getPendingOrders();
      return ordList.map((o) => ({
        orderId: String(o.orderId),
        clientOrderId: o.clientOrderId,
        tradeId: o.tradeId,
        symbol: "XAUUSD",
        side: (o.direction === "SHORT" || o.side === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
        orderType: (o.orderType || "MARKET") as any,
        requestedLot: o.requestedVolume || o.requestedLot,
        filledLot: o.filledVolume || o.filledLot || 0,
        requestedPrice: o.price || o.requestedPrice,
        status: (o.status || "ORDER_PENDING") as OrderStatus,
        submittedAt: o.time || o.submittedAt || Date.now(),
      }));
    } catch {
      return [];
    }
  }

  async submitOrder(request: OrderSubmissionRequest): Promise<OrderExecutionResult> {
    // ALWAYS safety gate: Keep live trading blocked unless verified/allowed
    const health = await this.getHealth();
    if (!health.connected) {
      return {
        success: false,
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        status: "ORDER_REJECTED" as const,
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp: Date.now(),
        rejectionReason: "LIVE_EXECUTION = BLOCKED. JustMarkets MT5 is disconnected/unverified.",
        protectionStatus: "UNPROTECTED" as const,
      };
    }

    try {
      // Map GP-V4 canonical request fields directly to MT5 order request structure
      const mt5Order = {
        symbol: this.brokerSymbol,
        action: request.orderType === "MARKET" ? "MARKET" : "PENDING",
        direction: request.direction,
        volume: request.lotSize,
        price: request.targetPrice,
        sl: request.stopLoss,
        tp: request.takeProfit1,
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        comment: request.comment,
      };

      const res = await this.bridge.submitOrder(mt5Order);
      return {
        success: Boolean(res.success),
        orderId: String(res.orderId),
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        status: (res.status || "ORDER_FILLED") as OrderStatus,
        filledLot: res.volumeFilled || res.filledLot || 0,
        fillPrice: res.priceFilled || res.fillPrice || 0,
        slippagePoints: res.slippage || 0,
        commission: res.commission || 0,
        timestamp: res.time || Date.now(),
        rejectionReason: res.error || res.rejectionReason,
        protectionStatus: (request.stopLoss && request.takeProfit1 ? "PROTECTED" : "PARTIALLY_PROTECTED") as ProtectionStatus,
      };
    } catch (err: any) {
      return {
        success: false,
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        status: "ORDER_REJECTED" as const,
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp: Date.now(),
        rejectionReason: err.message,
        protectionStatus: "UNPROTECTED" as const,
      };
    }
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await this.bridge.closePosition(orderId, 0); // Canceling pending order mapped to close/cancel
      return { success: Boolean(res.success), error: res.error };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async closePosition(positionId: string, lotSize?: number, closePrice?: number): Promise<PositionCloseResult> {
    try {
      const res = await this.bridge.closePosition(positionId, lotSize || 0, closePrice);
      return {
        success: Boolean(res.success),
        positionId,
        realizedPnl: res.pnl || 0,
        closedLot: res.volume || lotSize || 0,
        closePrice: res.price || closePrice || 0,
        timestamp: Date.now(),
        error: res.error,
      };
    } catch (err: any) {
      return {
        success: false,
        positionId,
        realizedPnl: 0,
        closedLot: 0,
        closePrice: 0,
        timestamp: Date.now(),
        error: err.message,
      };
    }
  }

  async modifyProtection(spec: {
    positionId: string;
    tradeId?: string;
    symbol: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<ProtectionModificationResult> {
    try {
      const res = await this.bridge.modifyProtection(spec.positionId, spec.stopLoss, spec.takeProfit);
      return {
        success: Boolean(res.success),
        positionId: spec.positionId,
        protectionStatus: (spec.stopLoss && spec.takeProfit ? "PROTECTED" : "PARTIALLY_PROTECTED") as ProtectionStatus,
        stopLoss: spec.stopLoss,
        takeProfit: spec.takeProfit,
        error: res.error,
      };
    } catch (err: any) {
      return {
        success: false,
        positionId: spec.positionId,
        protectionStatus: "UNPROTECTED" as const,
        error: err.message,
      };
    }
  }

  async getOrderStatus(orderId: string): Promise<BrokerOrder | null> {
    try {
      const o = await this.bridge.getOrderStatus(orderId);
      if (!o) return null;
      return {
        orderId: String(o.orderId),
        clientOrderId: o.clientOrderId,
        tradeId: o.tradeId,
        symbol: "XAUUSD",
        side: o.direction === "SHORT" ? "SHORT" : "LONG",
        orderType: o.orderType || "MARKET",
        requestedLot: o.requestedVolume,
        filledLot: o.filledVolume,
        fillPrice: o.priceFilled,
        status: o.status as OrderStatus,
        submittedAt: o.time || Date.now(),
      };
    } catch {
      return null;
    }
  }
}
