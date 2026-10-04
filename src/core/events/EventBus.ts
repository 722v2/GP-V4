import type { SystemEvent, EventName } from "../types/Events.js";

type Handler = (event: SystemEvent<never>) => void | Promise<void>;

/**
 * Internal synchronous-first event bus. Handlers run sequentially in
 * subscription order; a throwing handler is caught and logged so one bad
 * subscriber cannot take down the pipeline.
 */
export class EventBus {
  private handlers = new Map<EventName, { subscriberName: string; handler: Handler }[]>();
  private log: (msg: string, err?: Error) => void;

  constructor(log: (msg: string, err?: Error) => void = () => {}) {
    this.log = log;
  }

  on(eventName: EventName, subscriberName: string, handler: Handler): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push({ subscriberName, handler });
    this.handlers.set(eventName, list);
  }

  async publish<T>(event: SystemEvent<T>): Promise<void> {
    const list = this.handlers.get(event.name);
    if (!list) return;
    for (const { subscriberName, handler } of list) {
      try {
        await handler(event as SystemEvent<never>);
      } catch (err) {
        try {
          this.log(
            `event-bus: handler "${subscriberName}" failed on "${event.name}"`,
            err instanceof Error ? err : new Error(String(err))
          );
        } catch {
          // A broken log sink must not break event delivery.
        }
      }
    }
  }
}
