export interface NewsEvent {
  readonly id: string;
  readonly symbol: string;
  readonly title: string;
  readonly impact: "HIGH" | "MEDIUM" | "LOW";
  readonly scheduledAt: number; // UTC timestamp
}

export interface NewsProvider {
  readonly name: string;
  isConfigured(): boolean;
  getEvents(symbol: string, fromTimestamp: number, toTimestamp: number): Promise<readonly NewsEvent[]>;
}

export interface NewsFilterConfig {
  readonly enabled: boolean;
  readonly newsWindowMinutes: number;
}

export interface NewsFilterResult {
  readonly passed: boolean;
  readonly status: "AVAILABLE" | "UNAVAILABLE" | "DISABLED";
  readonly event?: NewsEvent;
  readonly reason?: string;
}

export async function evaluateNewsFilter(
  symbol: string,
  timestamp: number,
  cfg: NewsFilterConfig,
  provider?: NewsProvider | null
): Promise<NewsFilterResult> {
  if (!cfg.enabled) {
    return { passed: true, status: "DISABLED" };
  }

  if (!provider || !provider.isConfigured()) {
    return {
      passed: false,
      status: "UNAVAILABLE",
      reason: `NEWS_FILTER_UNAVAILABLE: News filter enabled but no news provider is configured`,
    };
  }

  const windowMs = (cfg.newsWindowMinutes ?? 30) * 60_000;
  const fromTime = timestamp - windowMs;
  const toTime = timestamp + windowMs;

  try {
    const events = await provider.getEvents(symbol, fromTime, toTime);
    const highImpact = events.find(
      (e) => e.impact === "HIGH" && Math.abs(e.scheduledAt - timestamp) <= windowMs
    );

    if (highImpact) {
      const eventTimeStr = new Date(highImpact.scheduledAt).toISOString().slice(11, 16);
      return {
        passed: false,
        status: "AVAILABLE",
        event: highImpact,
        reason: `NEWS_FILTER_BLOCKED: High-impact news event '${highImpact.title}' scheduled at ${eventTimeStr} UTC within ${cfg.newsWindowMinutes} min window`,
      };
    }

    return { passed: true, status: "AVAILABLE" };
  } catch (err) {
    return {
      passed: false,
      status: "UNAVAILABLE",
      reason: `NEWS_FILTER_UNAVAILABLE: Error retrieving news events: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
