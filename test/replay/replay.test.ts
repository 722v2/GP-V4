import { describe, expect, it } from "vitest";
import { ReplayRecorder, ReplayProvider } from "../../src/ai/ReplayProvider.js";
import type { ChatCompletionRequest } from "../../src/ai/types.js";
import type { AiDecision } from "../../src/core/types/AiDecision.js";

const REQUEST: ChatCompletionRequest = {
  model: "",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "user" },
  ],
};

function decision(over: Partial<AiDecision> = {}): AiDecision {
  return {
    decision: "TRADE_CANDIDATE",
    confidence: 0.8,
    evidence: [],
    risk_notes: [],
    reassessment_conditions: [],
    reason_codes: [],
    ...over,
  };
}

describe("ReplayRecorder", () => {
  it("round-trips record and lookup", () => {
    const r = new ReplayRecorder();
    r.record("k1", { ok: true, decision: decision(), cached: false, costUsd: 0, tokens: { prompt: 1, completion: 1 } });
    expect(r.size).toBe(1);
    expect(r.lookup("k1")?.ok).toBe(true);
    expect(r.lookup("missing")).toBeUndefined();
  });

  it("serializes and restores from JSON", () => {
    const r = new ReplayRecorder();
    r.record("k1", { ok: false, failure: { kind: "TIMEOUT", message: "x" } });
    const restored = ReplayRecorder.fromJSON(r.toJSON());
    expect(restored.lookup("k1")?.ok).toBe(false);
  });
});

describe("ReplayProvider", () => {
  it("serves recorded decisions without a network call", async () => {
    const recorder = new ReplayRecorder();
    recorder.record("sig", { ok: true, decision: decision(), cached: false, costUsd: 0, tokens: { prompt: 0, completion: 0 } });
    const provider = new ReplayProvider(recorder, () => "sig");
    const out = await provider.complete(REQUEST);
    const parsed = JSON.parse(out.content) as AiDecision;
    expect(parsed.decision).toBe("TRADE_CANDIDATE");
    expect(out.model).toBe("replay");
  });

  it("throws for recorded failures in strict replay", async () => {
    const recorder = new ReplayRecorder();
    recorder.record("sig", { ok: false, failure: { kind: "PROVIDER_ERROR", message: "boom" } });
    const provider = new ReplayProvider(recorder, () => "sig");
    await expect(provider.complete(REQUEST)).rejects.toThrow(/PROVIDER_ERROR/);
  });

  it("records fresh results from a fallback provider", async () => {
    const recorder = new ReplayRecorder();
    const recorded: string[] = [];
    const fallback = {
      name: "fallback",
      complete: async () => ({ content: JSON.stringify(decision({ decision: "NO_TRADE" })), usage: { prompt: 1, completion: 1 }, model: "fb" }),
    };
    const provider = new ReplayProvider(recorder, () => "sig", fallback, (sig) => recorded.push(sig));
    const out = await provider.complete(REQUEST);
    expect(JSON.parse(out.content).decision).toBe("NO_TRADE");
    expect(recorded).toEqual(["sig"]);
    expect(recorder.lookup("sig")?.ok).toBe(true);
  });

  it("fails without a fallback when the signature is unrecorded", async () => {
    const provider = new ReplayProvider(new ReplayRecorder(), () => "nope");
    await expect(provider.complete(REQUEST)).rejects.toThrow(/no recorded output/);
  });
});
