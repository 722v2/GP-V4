import type { TradePlan } from "../core/types/Trade.js";
import type { Mode } from "../pipeline/types.js";
import type { KillSwitch } from "../risk/KillSwitch.js";
import type { InstrumentSpec } from "../risk/InstrumentSpec.js";
import { DEFAULT_XAUUSD_SPEC, validateInstrumentSpec } from "../risk/InstrumentSpec.js";
import type { BrokerAdapter, OrderExecutionResult, OrderSubmissionRequest, ProtectionStatus } from "./broker/BrokerAdapter.js";
import type { EventBus } from "../core/events/EventBus.js";
import type { PersistenceRepository } from "../persistence/Persistence.js";
import type { Logger } from "../core/logging/Logger.js";

export interface ExecutionEngineDeps {
  readonly broker: BrokerAdapter;
  readonly bus: EventBus;
  readonly repo: PersistenceRepository;
  readonly killSwitch?: KillSwitch;
  readonly instrumentSpec?: InstrumentSpec;
  readonly log?: Logger;
  readonly now?: () => number;
}

export class ExecutionEngine {
  private readonly executedClientOrders = new Map<string, OrderExecutionResult>();
  private readonly broker: BrokerAdapter;
  private readonly bus: EventBus;
  private readonly repo: PersistenceRepository;
  private readonly killSwitch?: KillSwitch;
  private readonly spec: InstrumentSpec;
  private readonly log?: Logger;
  private readonly now: () => number;

  constructor(deps: ExecutionEngineDeps) {
    this.broker = deps.broker;
    this.bus = deps.bus;
    this.repo = deps.repo;
    this.killSwitch = deps.killSwitch;
    this.spec = deps.instrumentSpec ?? DEFAULT_XAUUSD_SPEC;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
  }

  async executePlan(plan: TradePlan, mode: Mode): Promise<OrderExecutionResult> {
    const timestamp = this.now();
    const clientOrderId = `CL-ORD-${plan.id}`;

    // 1. Check Execution Idempotency
    const existing = this.executedClientOrders.get(clientOrderId);
    if (existing) {
      this.log?.info("idempotent order execution skipped duplicate submission", {
        tradeId: plan.id,
        clientOrderId,
        status: existing.status,
      });
      return existing;
    }

    // 2. Enforce KillSwitch Gating
    if (this.killSwitch && this.killSwitch.level !== "NONE") {
      this.log?.warn("order execution blocked by KillSwitch", {
        level: this.killSwitch.level,
        tradeId: plan.id,
      });
      const rejectedResult: OrderExecutionResult = {
        success: false,
        clientOrderId,
        tradeId: plan.id,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: `Blocked by active KillSwitch (${this.killSwitch.level})`,
        protectionStatus: "UNPROTECTED",
      };
      this.executedClientOrders.set(clientOrderId, rejectedResult);
      return rejectedResult;
    }

    // 3. Enforce Mode Gating
    if (mode === "ANALYSIS_ONLY") {
      const rejectedResult: OrderExecutionResult = {
        success: false,
        clientOrderId,
        tradeId: plan.id,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: "ANALYSIS_ONLY mode — order submission disabled",
        protectionStatus: "UNPROTECTED",
      };
      return rejectedResult;
    }

    if (mode === "AUTO_TRADING" && this.broker.isSimulated) {
      this.log?.error("AUTO_TRADING attempted without live verified broker adapter");
      const rejectedResult: OrderExecutionResult = {
        success: false,
        clientOrderId,
        tradeId: plan.id,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: "AUTO_TRADING requires verified live broker adapter",
        protectionStatus: "UNPROTECTED",
      };
      this.executedClientOrders.set(clientOrderId, rejectedResult);
      return rejectedResult;
    }

    // 4. Validate Instrument Specification
    const val = validateInstrumentSpec(this.spec);
    if (!val.valid) {
      const rejectedResult: OrderExecutionResult = {
        success: false,
        clientOrderId,
        tradeId: plan.id,
        status: "ORDER_REJECTED",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: `Invalid instrument specification: ${val.errors.join("; ")}`,
        protectionStatus: "UNPROTECTED",
      };
      this.executedClientOrders.set(clientOrderId, rejectedResult);
      return rejectedResult;
    }

    // 5. Build Normalized Order Request
    const request: OrderSubmissionRequest = {
      clientOrderId,
      tradeId: plan.id,
      symbol: plan.symbol,
      direction: plan.direction,
      lotSize: plan.lotSize,
      orderType: "MARKET",
      targetPrice: plan.entry,
      stopLoss: plan.stopLoss,
      takeProfit1: plan.takeProfit1,
      takeProfit2: plan.takeProfit2,
      comment: `GP-V4-${mode}`,
    };

    // 6. Submit to Broker Adapter
    let executionResult: OrderExecutionResult;
    try {
      executionResult = await this.broker.submitOrder(request);
    } catch (err) {
      this.log?.error("broker order submission exception", {
        tradeId: plan.id,
        err: err instanceof Error ? err.message : String(err),
      });
      executionResult = {
        success: false,
        clientOrderId,
        tradeId: plan.id,
        status: "ORDER_UNKNOWN",
        filledLot: 0,
        fillPrice: 0,
        slippagePoints: 0,
        commission: 0,
        timestamp,
        rejectionReason: `Broker exception: ${err instanceof Error ? err.message : String(err)}`,
        protectionStatus: "UNKNOWN",
      };
    }

    // Cache execution result for idempotency
    this.executedClientOrders.set(clientOrderId, executionResult);

    // 7. Publish Events & Update Persistence if Filled
    if (executionResult.success && executionResult.status === "ORDER_FILLED") {
      await this.bus.publish({
        name: "trade.submitted",
        timestamp,
        payload: {
          tradeId: plan.id,
          orderId: executionResult.orderId,
          lotSize: executionResult.filledLot,
          entry: executionResult.fillPrice,
          symbol: plan.symbol,
          direction: plan.direction,
          stopLoss: plan.stopLoss,
          takeProfit1: plan.takeProfit1,
          takeProfit2: plan.takeProfit2,
          plan,
        },
      });
    }

    return executionResult;
  }

  getExecution(clientOrderId: string): OrderExecutionResult | undefined {
    return this.executedClientOrders.get(clientOrderId);
  }
}
