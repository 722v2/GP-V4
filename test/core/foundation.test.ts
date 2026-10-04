import { describe, expect, it } from "vitest";
import { createConsoleLogger, redact } from "../../src/core/logging/Logger.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { TIMEFRAME_MS, isTimeframe } from "../../src/core/types/MarketTypes.js";
import { evidenceScore } from "../../src/core/types/Setup.js";

describe("logger redaction", () => {
  it("redacts secret-shaped keys at any depth", () => {
    const out = redact({
      apiKey: "sk-123",
      nested: { AUTH_HEADER: "Bearer x", safe: 1 },
      Authorization: "Bearer y",
      items: [{ api_key: "z", name: "ok" }],
    });
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).AUTH_HEADER).toBe("[REDACTED]");
    expect(out.Authorization).toBe("[REDACTED]");
    expect((out.items as Record<string, unknown>[])[0]!.api_key).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).safe).toBe(1);
  });

  it("logger is constructable and scoped children share redaction", () => {
    const log = createConsoleLogger("test");
    expect(() => log.child("ai").info("hello", { apiKey: "x" })).not.toThrow();
  });
});

describe("EventBus", () => {
  it("delivers events to subscribers in order and isolates handler failures", async () => {
    const bus = new EventBus((m) => { throw new Error(m); });
    const seen: string[] = [];
    bus.on("candle.closed", "a", () => { seen.push("a"); });
    bus.on("candle.closed", "bad", () => { throw new Error("boom"); });
    bus.on("candle.closed", "c", () => { seen.push("c"); });
    await bus.publish({ name: "candle.closed", timestamp: 1, payload: {} });
    expect(seen).toEqual(["a", "c"]);
  });
});

describe("market types", () => {
  it("has correct timeframe durations", () => {
    expect(TIMEFRAME_MS.M5).toBe(300_000);
    expect(TIMEFRAME_MS.H1).toBe(3_600_000);
    expect(isTimeframe("M5")).toBe(true);
    expect(isTimeframe("M7")).toBe(false);
  });
});

describe("evidence scoring", () => {
  it("signs weights by direction", () => {
    const evidence = [
      { source: "structure", kind: "bos", detail: "", weight: 0.6 },
      { source: "macd", kind: "cross", detail: "", weight: 0.3 },
    ];
    expect(evidenceScore(evidence, "LONG")).toBeCloseTo(0.9);
    expect(evidenceScore(evidence, "SHORT")).toBeCloseTo(-0.9);
  });
});
