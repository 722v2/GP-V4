export const EVENT_NAMES = [
  "candle.closed",
  "scan.completed",
  "setup.created",
  "setup.updated",
  "setup.stateChanged",
  "signal.generated",
  "risk.approved",
  "risk.rejected",
  "trade.planned",
  "trade.submitted",
  "trade.stateChanged",
  "trade.closed",
  "ai.requested",
  "ai.completed",
  "ai.failed",
  "killswitch.changed",
  "health.degraded",
  "health.recovered",
  "persistence.failed",
  "system.error",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface SystemEvent<T = unknown> {
  readonly name: EventName;
  readonly timestamp: number;
  readonly payload: T;
}

export interface EventSubscription {
  readonly eventName: EventName;
  readonly handler: (event: SystemEvent<never>) => void | Promise<void>;
  readonly subscriberName: string;
}
