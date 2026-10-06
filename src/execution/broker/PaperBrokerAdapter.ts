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
} from "./BrokerAdapter.js";
import type { InstrumentSpec } from "../../risk/InstrumentSpec.js";
import { DEFAULT_XAUUSD_SPEC, validateInstrumentSpec } from "../../risk/InstrumentSpec.js";
import type { SpreadSlippageModel } from "../TradeLifecycle.js";
import type { Logger } from "../../core/logging/Logger.js";

export interface PaperBrokerConfig {
  readonly initialBalance?: number;
  readonly currency?: string;
  readonly leverage?: number;
  readonly commissionPerLot?: number;
  readonly spreadModel?: SpreadSlippageModel;
  readonly instrumentSpec?: InstrumentSpec;
  readonly log?: Logger;
  readonly now?: () => number;
}

export class PaperBrokerAdapter implements BrokerAdapter {
  readonly name = "PaperBrokerAdapter";
  readonly isSimulated = true;

  private balance: number;
  private readonly currency: string;
  private readonly leverage: number;
  private readonly commissionPerLot: number;
  private readonly spreadModel?: SpreadSlippageModel;
  private readonly spec: InstrumentSpec;
  private readonly log?: Logger;
  private readonly now: () => number;

  private readonly positions = new Map<string, BrokerPosition>();
  private readonly orders = new Map<string, BrokerOrder>();
  private readonly quotes = new Map<string, BrokerQuote>();
  private orderSequence = 1;

  constructor(cfg: PaperBrokerConfig = {}) {
    this.balance = cfg.initialBalance ?? 10_000;
    this.currency = cfg.currency ?? "USD";
    this.leverage = cfg.leverage ?? 100;
    this.commissionPerLot = cfg.commissionPerLot ?? 0.0;
    this.spreadModel = cfg.spreadModel;
    this.spec = cfg.instrumentSpec ?? DEFAULT_XAUUSD_SPEC;
    this.log = cfg.log;
    this.now = cfg.now ?? Date.now;
  }

  setBalance(balance: number): void {
    this.balance = balance;
  }

  updateQuote(quote: BrokerQuote): void {
    this.quotes.set(quote.symbol, quote);
  }

  async getHealth(): Promise<BrokerHealth> {
    return {
      name: this.name,
      connected: true,
      status: "READY",
      isSimulated: true,
      latencyMs: this.spreadModel?.latency ?? 250,
      serverTime: this.now(),
      detail: "Paper Trading Broker Adapter — Real market data with simulated fills",
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
    let totalUnrealizedPnl = 0;
    let totalMargin = 0;

    for (const pos of this.positions.values()) {
      if (pos.state === "OPEN" || pos.state === "PARTIAL") {
        const quote = this.quotes.get(pos.symbol);
        const currentPrice = quote
          ? (pos.side === "LONG" ? quote.bid : quote.ask)
          : pos.entryPrice;
        const diff = pos.side === "LONG" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
        const posPnl = diff * this.spec.contractSize * pos.lotSize;
        totalUnrealizedPnl += posPnl;

        // Margin calculation
        const notional = pos.entryPrice * this.spec.contractSize * pos.lotSize;
        totalMargin += notional / this.leverage;
      }
    }

    const equity = this.balance + totalUnrealizedPnl;
    const freeMargin = Math.max(0, equity - totalMargin);

    return {
      accountId: "PAPER-SIM-01",
      equity,
      balance: this.balance,
      margin: totalMargin,
      freeMargin,
      currency: this.currency,
      leverage: this.leverage,
      serverTime: this.now(),
      isSimulated: true,
    };
  }

  async getInstrumentSpec(symbol: string): Promise<InstrumentSpec> {
    if (symbol === this.spec.symbol) {
      return this.spec;
    }
    return {
      ...DEFAULT_XAUUSD_SPEC,
      symbol,
    };
  }

  async getQuote(symbol: string): Promise<BrokerQuote | null> {
    return this.quotes.get(symbol) ?? null;
  }

  async getOpenPositions(): Promise<readonly BrokerPosition[]> {
    return [...this.positions.values()].filter(
      (p) => p.state === "OPEN" || p.state === "PARTIAL"
    );
  }

  async getPendingOrders(): Promise<readonly BrokerOrder[]> {
    return [...this.orders.values()].filter(
      (o) => o.status === "ORDER_SUBMITTED" || o.status === "ORDER_PENDING"
    );
  }

  async submitOrder(request: OrderSubmissionRequest): Promise<OrderExecutionResult> {
    const timestamp = this.now();
    const orderId = `P-ORD-${Date.now()}-${this.orderSequence++}`;

    const val = validateInstrumentSpec(this.spec);
    if (!val.valid) {
      return {
        success: false,
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: `Invalid instrument spec: ${val.errors.join(", ")}`,
        protectionStatus: "UNPROTECTED",
      };
    }

    if (request.lotSize < this.spec.minLot || request.lotSize > this.spec.maxLot) {
      return {
        success: false,
        clientOrderId: request.clientOrderId,
        tradeId: request.tradeId,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: `Lot size ${request.lotSize} outside bounds [${this.spec.minLot}, ${this.spec.maxLot}]`,
        protectionStatus: "UNPROTECTED",
      };
    }

    const basePrice = request.targetPrice ?? 2050.0;
    const fillPrice = this.spreadModel
      ? this.spreadModel.adjustedFill(request.direction, basePrice)
      : basePrice;
    const slippagePoints = Math.abs(fillPrice - basePrice);
    const commission = this.commissionPerLot * request.lotSize;

    this.balance -= commission;

    const order: BrokerOrder = {
      orderId,
      clientOrderId: request.clientOrderId,
      tradeId: request.tradeId,
      symbol: request.symbol,
      side: request.direction,
      orderType: request.orderType,
      requestedLot: request.lotSize,
      filledLot: request.lotSize,
      requestedPrice: basePrice,
      fillPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit1,
      status: "ORDER_FILLED",
      submittedAt: timestamp,
      filledAt: timestamp,
    };
    this.orders.set(orderId, order);

    const positionId = `P-POS-${request.tradeId}`;
    const position: BrokerPosition = {
      positionId,
      tradeId: request.tradeId,
      symbol: request.symbol,
      side: request.direction,
      lotSize: request.lotSize,
      entryPrice: fillPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit1,
      openedAt: timestamp,
      state: "OPEN",
      protectionStatus: "PROTECTED",
    };
    this.positions.set(positionId, position);

    this.log?.info("paper broker order filled", {
      orderId,
      positionId,
      symbol: request.symbol,
      fillPrice,
      lotSize: request.lotSize,
    });

    return {
      success: true,
      orderId,
      clientOrderId: request.clientOrderId,
      tradeId: request.tradeId,
      status: "ORDER_FILLED",
      filledLot: request.lotSize,
      fillPrice,
      slippagePoints,
      commission,
      timestamp,
      protectionStatus: "PROTECTED",
    };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    const order = this.orders.get(orderId);
    if (!order) {
      return { success: false, error: "Order not found" };
    }
    if (order.status === "ORDER_FILLED" || order.status === "ORDER_CANCELLED") {
      return { success: false, error: `Cannot cancel order in status ${order.status}` };
    }
    this.orders.set(orderId, { ...order, status: "ORDER_CANCELLED" });
    return { success: true };
  }

  async closePosition(
    positionId: string,
    lotSize?: number,
    closePrice?: number
  ): Promise<PositionCloseResult> {
    const pos = this.positions.get(positionId);
    if (!pos || pos.state === "CLOSED") {
      return {
        success: false,
        positionId,
        realizedPnl: 0,
        closedLot: 0,
        closePrice: 0,
        timestamp: this.now(),
        error: "Position not found or already closed",
      };
    }

    const closeLot = lotSize ? Math.min(lotSize, pos.lotSize) : pos.lotSize;
    const finalPrice = closePrice ?? pos.entryPrice;
    const adjustedExit = this.spreadModel
      ? this.spreadModel.adjustedExit(pos.side, finalPrice)
      : finalPrice;

    const diff = pos.side === "LONG" ? adjustedExit - pos.entryPrice : pos.entryPrice - adjustedExit;
    const realizedPnl = diff * this.spec.contractSize * closeLot;

    this.balance += realizedPnl;

    const remainingLot = pos.lotSize - closeLot;
    if (remainingLot <= 0.0001) {
      this.positions.set(positionId, {
        ...pos,
        lotSize: 0,
        state: "CLOSED",
        protectionStatus: "UNPROTECTED",
      });
    } else {
      this.positions.set(positionId, {
        ...pos,
        lotSize: remainingLot,
        state: "PARTIAL",
      });
    }

    return {
      success: true,
      positionId,
      tradeId: pos.tradeId,
      realizedPnl,
      closedLot: closeLot,
      closePrice: adjustedExit,
      timestamp: this.now(),
    };
  }

  async modifyProtection(spec: {
    positionId: string;
    tradeId?: string;
    symbol: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<ProtectionModificationResult> {
    const pos = this.positions.get(spec.positionId);
    if (!pos || pos.state === "CLOSED") {
      return {
        success: false,
        positionId: spec.positionId,
        protectionStatus: "UNPROTECTED",
        error: "Position not found or closed",
      };
    }

    const updated: BrokerPosition = {
      ...pos,
      stopLoss: spec.stopLoss ?? pos.stopLoss,
      takeProfit: spec.takeProfit ?? pos.takeProfit,
      protectionStatus: "PROTECTED",
    };
    this.positions.set(spec.positionId, updated);

    return {
      success: true,
      positionId: spec.positionId,
      protectionStatus: "PROTECTED",
      stopLoss: updated.stopLoss,
      takeProfit: updated.takeProfit,
    };
  }

  async getOrderStatus(orderId: string): Promise<BrokerOrder | null> {
    return this.orders.get(orderId) ?? null;
  }
}
