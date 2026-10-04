import type { AiDecision, AiResult } from "../core/types/AiDecision.js";
import type { AiProvider, AiProviderResult, ChatCompletionRequest } from "./types.js";

/**
 * Records live AI outputs (or replays recorded ones) keyed by prompt signature,
 * so BACKTEST/REPLAY runs reproduce the exact decision the live model made
 * without calling the provider. Recording and replay are mutually exclusive.
 */
export class ReplayRecorder {
  private readonly entries = new Map<string, AiResult>();

  record(signature: string, result: AiResult): void {
    this.entries.set(signature, result);
  }

  lookup(signature: string): AiResult | undefined {
    return this.entries.get(signature);
  }

  get size(): number {
    return this.entries.size;
  }

  toJSON(): Record<string, AiResult> {
    return Object.fromEntries(this.entries);
  }

  static fromJSON(data: Record<string, AiResult>): ReplayRecorder {
    const r = new ReplayRecorder();
    for (const [k, v] of Object.entries(data)) r.record(k, v);
    return r;
  }
}

/**
 * Provider that answers from a ReplayRecorder. When a signature is missing it
 * can either fail (strict replay) or delegate to a fallback provider (record mode).
 */
export class ReplayProvider implements AiProvider {
  readonly name = "replay";

  constructor(
    private readonly recorder: ReplayRecorder,
    private readonly signatureOf: (req: ChatCompletionRequest) => string,
    private readonly fallback: AiProvider | null = null,
    private readonly onRecord: (signature: string, result: AiProviderResult) => void = () => {}
  ) {}

  async complete(req: ChatCompletionRequest): Promise<AiProviderResult> {
    const signature = this.signatureOf(req);
    const recorded = this.recorder.lookup(signature);
    if (recorded && recorded.ok) {
      return toProviderResult(recorded.decision);
    }
    if (recorded && !recorded.ok) {
      throw new Error(`replay: recorded failure ${recorded.failure.kind}`);
    }
    if (!this.fallback) {
      throw new Error("replay: no recorded output for prompt and no fallback provider");
    }
    const fresh = await this.fallback.complete(req);
    this.recorder.record(signature, {
      ok: true,
      decision: parseDecision(fresh.content),
      cached: false,
      costUsd: 0,
      tokens: fresh.usage,
    });
    this.onRecord(signature, fresh);
    return fresh;
  }
}

function toProviderResult(decision: AiDecision): AiProviderResult {
  return {
    content: JSON.stringify(decision),
    usage: { prompt: 0, completion: 0 },
    model: "replay",
  };
}

function parseDecision(content: string): AiDecision {
  return JSON.parse(content) as AiDecision;
}
