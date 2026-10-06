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
import { DEFAULT_XAUUSD_SPEC } from "../../risk/InstrumentSpec.js";

export class NullBrokerAdapter implements BrokerAdapter {
  readonly name = "NullBrokerAdapter (Unconnected)";
  readonly isSimulated = false;

  async getHealth(): Promise<BrokerHealth> {
    return {
      name: this.name,
      connected: false,
      status: "NOT_CONFIGURED",
      isSimulated: false,
      latencyMs: 0,
      serverTime: Date.now(),
      detail: "Live Broker integration is not connected (Phase 3.2 scope). Live trading is strictly blocked.",
      capabilities: {
        supportsPendingOrders: false,
        supportsBrokerSideProtection: false,
        supportsTrailingStop: false,
        supportsPartialClose: false,
        supportsMarketOrders: false,
      },
    };
  }

  async getAccountInfo(): Promise<BrokerAccountInfo> {
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
    return {
      ...DEFAULT_XAUUSD_SPEC,
      symbol,
    };
  }

  async getQuote(_symbol: string): Promise<BrokerQuote | null> {
    return null;
  }

  async getOpenPositions(): Promise<readonly BrokerPosition[]> {
    return [];
  }

  async getPendingOrders(): Promise<readonly BrokerOrder[]> {
    return [];
  }

  async submitOrder(request: OrderSubmissionRequest): Promise<OrderExecutionResult> {
    return {
      success: false,
      clientOrderId: request.clientOrderId,
      tradeId: request.tradeId,
      status: "ORDER_REJECTED",
      filledLot: 0,
      fillPrice: 0,
      slippagePoints: 0,
      commission: 0,
      timestamp: Date.now(),
      rejectionReason: "Live Broker is not connected — AUTO_TRADING is blocked",
      protectionStatus: "UNPROTECTED",
    };
  }

  async cancelOrder(_orderId: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: "Broker not connected" };
  }

  async closePosition(positionId: string): Promise<PositionCloseResult> {
    return {
      success: false,
      positionId,
      realizedPnl: 0,
      closedLot: 0,
      closePrice: 0,
      timestamp: Date.now(),
      error: "Broker not connected",
    };
  }

  async modifyProtection(spec: { positionId: string; symbol: string }): Promise<ProtectionModificationResult> {
    return {
      success: false,
      positionId: spec.positionId,
      protectionStatus: "UNPROTECTED",
      error: "Broker not connected",
    };
  }

  async getOrderStatus(_orderId: string): Promise<BrokerOrder | null> {
    return null;
  }
}
