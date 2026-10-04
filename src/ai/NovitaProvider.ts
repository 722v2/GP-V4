import { AppError, ErrorCode, type Logger } from "../core/logging/Logger.js";
import {
  ChatCompletionResponseSchema,
  type AiProvider,
  type AiProviderResult,
  type ChatCompletionRequest,
} from "./types.js";

export interface NovitaConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * Novita AI provider (OpenAI-compatible chat completions). Network transport is
 * injected so tests exercise the full parse/validate path without a live API.
 * Returns NOT_CONFIGURED until baseUrl/apiKey/model are supplied.
 */
export class NovitaProvider implements AiProvider {
  readonly name = "novita";

  constructor(
    private readonly cfg: NovitaConfig,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isConfigured(): boolean {
    return this.cfg.baseUrl !== "" && this.cfg.apiKey !== "" && this.cfg.model !== "";
  }

  async complete(req: ChatCompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<AiProviderResult> {
    if (!this.isConfigured()) {
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "Novita provider not configured — set NOVITA_BASE_URL, NOVITA_API_KEY, NOVITA_MODEL");
    }
    const url = new URL("/v3/openai/chat/completions", this.cfg.baseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const signal = opts.signal ?? controller.signal;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({ ...req, model: this.cfg.model }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AppError(ErrorCode.AI_TIMEOUT, `Novita request timed out after ${this.cfg.timeoutMs}ms`);
      }
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "Novita request failed", undefined, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, `Novita HTTP ${res.status}`, { status: res.status });
    }
    const body: unknown = await res.json();
    const parsed = ChatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "Novita response did not match expected schema", {
        issues: parsed.error.issues.map((i) => i.path.join(".")),
      });
    }
    const choice = parsed.data.choices[0]!;
    const content = choice.message.content ?? "";
    if (content.trim() === "") {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "Novita returned empty content");
    }
    const usage = parsed.data.usage;
    this.log.debug("novita completion", { model: parsed.data.model ?? this.cfg.model, finish: choice.finish_reason ?? null });
    return {
      content,
      usage: { prompt: usage?.prompt_tokens ?? 0, completion: usage?.completion_tokens ?? 0 },
      model: parsed.data.model ?? this.cfg.model,
    };
  }
}
