import type { InstrumentSpec } from "../../risk/InstrumentSpec.js";

export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type OrderSide = "LONG" | "SHORT";

export type OrderStatus =
  | "ORDER_PENDING"
  | "ORDER_SUBMITTED"
  | "ORDER_PARTIALLY_FILLED"
  | "ORDER_FILLED"
  | "ORDER_REJECTED"
  | "ORDER_CANCELLED"
  | "ORDER_UNKNOWN";

export type BrokerPositionState = "OPEN" | "PARTIAL" | "CLOSED" | "UNKNOWN";

export type ProtectionStatus = "PROTECTED" | "PARTIALLY_PROTECTED" | "UNPROTECTED" | "UNKNOWN";

export interface BrokerAccountInfo {
  readonly accountId: string;
  readonly equity: number;
  readonly balance: number;
  readonly margin: number;
  readonly freeMargin: number;
  readonly currency: string;
  readonly leverage?: number;
  readonly serverTime: number;
  readonly isSimulated: boolean;
}

export interface BrokerQuote {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly spread: number;
  readonly timestamp: number;
}

export interface BrokerPosition {
  readonly positionId: string;
  readonly tradeId?: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly lotSize: number;
  readonly entryPrice: number;
  readonly currentPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly unrealizedPnl?: number;
  readonly openedAt: number;
  readonly state: BrokerPositionState;
  readonly protectionStatus: ProtectionStatus;
}

export interface BrokerOrder {
  readonly orderId: string;
  readonly clientOrderId?: string;
  readonly tradeId?: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly requestedLot: number;
  readonly filledLot: number;
  readonly requestedPrice?: number;
  readonly fillPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly status: OrderStatus;
  readonly rejectionReason?: string;
  readonly submittedAt: number;
  readonly filledAt?: number;
}

export interface OrderSubmissionRequest {
  readonly clientOrderId: string;
  readonly tradeId: string;
  readonly symbol: string;
  readonly direction: OrderSide;
  readonly lotSize: number;
  readonly orderType: OrderType;
  readonly targetPrice?: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2?: number;
  readonly comment?: string;
}

export interface OrderExecutionResult {
  readonly success: boolean;
  readonly orderId?: string;
  readonly clientOrderId: string;
  readonly tradeId: string;
  readonly status: OrderStatus;
  readonly filledLot: number;
  readonly fillPrice: number;
  readonly slippagePoints: number;
  readonly commission: number;
  readonly timestamp: number;
  readonly rejectionReason?: string;
  readonly protectionStatus: ProtectionStatus;
}

export interface PositionCloseResult {
  readonly success: boolean;
  readonly positionId: string;
  readonly tradeId?: string;
  readonly realizedPnl: number;
  readonly closedLot: number;
  readonly closePrice: number;
  readonly timestamp: number;
  readonly error?: string;
}

export interface ProtectionModificationResult {
  readonly success: boolean;
  readonly positionId: string;
  readonly protectionStatus: ProtectionStatus;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly error?: string;
}

export interface BrokerCapabilities {
  readonly supportsPendingOrders: boolean;
  readonly supportsBrokerSideProtection: boolean;
  readonly supportsTrailingStop: boolean;
  readonly supportsPartialClose: boolean;
  readonly supportsMarketOrders: boolean;
}

export interface BrokerHealth {
  readonly name: string;
  readonly connected: boolean;
  readonly status: "READY" | "DEGRADED" | "DISCONNECTED" | "NOT_CONFIGURED";
  readonly isSimulated: boolean;
  readonly latencyMs: number;
  readonly serverTime: number;
  readonly detail: string;
  readonly capabilities: BrokerCapabilities;
}

/**
 * Normalized Broker Adapter interface.
 * All broker implementations (Paper, Simulated, MT5, FIX, cTrader) adhere strictly to this contract.
 */
export interface BrokerAdapter {
  readonly name: string;
  readonly isSimulated: boolean;
  getHealth(): Promise<BrokerHealth>;
  getAccountInfo(): Promise<BrokerAccountInfo>;
  getInstrumentSpec(symbol: string): Promise<InstrumentSpec>;
  getQuote(symbol: string): Promise<BrokerQuote | null>;
  getOpenPositions(): Promise<readonly BrokerPosition[]>;
  getPendingOrders(): Promise<readonly BrokerOrder[]>;
  submitOrder(request: OrderSubmissionRequest): Promise<OrderExecutionResult>;
  cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }>;
  closePosition(positionId: string, lotSize?: number, closePrice?: number): Promise<PositionCloseResult>;
  modifyProtection(spec: {
    positionId: string;
    tradeId?: string;
    symbol: string;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<ProtectionModificationResult>;
  getOrderStatus(orderId: string): Promise<BrokerOrder | null>;
}
