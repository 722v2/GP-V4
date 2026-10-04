/** Circuit breaker: closed -> open after N failures -> half-open after cooldown -> closed on success. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  get status(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    if (this.state === "OPEN") {
      if (this.now() - (this.openedAt ?? 0) >= this.cooldownMs) return "HALF_OPEN";
    }
    return this.state;
  }

  /** True when a request is allowed to proceed. */
  canRequest(): boolean {
    return this.status !== "OPEN";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }
}
