import { AppError, ErrorCode, type Logger } from "../core/logging/Logger.js";
import {
  ChatCompletionResponseSchema,
  type AiProvider,
  type AiProviderResult,
  type ChatCompletionRequest,
} from "./types.js";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * Generic OpenAI-compatible AI provider (NVIDIA NIM / DeepSeek / vLLM / OpenAI).
 * Safely resolves chat completion endpoints (e.g., https://integrate.api.nvidia.com/v1/chat/completions).
 * Network transport is injected so tests exercise full parse/validate path offline.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";

  constructor(
    private readonly cfg: OpenAiCompatibleConfig,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isConfigured(): boolean {
    return this.cfg.baseUrl !== "" && this.cfg.apiKey !== "" && this.cfg.model !== "";
  }

  /**
   * Resolves the full chat completions URL without stripping base URL paths like /v1.
   */
  getEndpointUrl(): string {
    const base = this.cfg.baseUrl.endsWith("/") ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`;
    return new URL("chat/completions", base).toString();
  }

  async complete(
    req: ChatCompletionRequest,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<AiProviderResult> {
    if (!this.isConfigured()) {
      throw new AppError(
        ErrorCode.EXTERNAL_UNAVAILABLE,
        "AI provider not configured — set AI_BASE_URL, AI_API_KEY, AI_MODEL"
      );
    }

    const url = this.getEndpointUrl();
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts.signal ?? controller.signal;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({ ...req, model: req.model || this.cfg.model }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        throw new AppError(ErrorCode.AI_TIMEOUT, `AI request timed out after ${timeoutMs}ms`);
      }
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "AI request failed", undefined, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, `AI HTTP ${res.status}`, { status: res.status });
    }

    const body: unknown = await res.json();
    const parsed = ChatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "AI response did not match expected schema", {
        issues: parsed.error.issues.map((i) => i.path.join(".")),
      });
    }

    const choice = parsed.data.choices[0]!;
    const content = choice.message.content ?? "";
    if (content.trim() === "") {
      throw new AppError(ErrorCode.AI_INVALID_OUTPUT, "AI returned empty content");
    }

    const usage = parsed.data.usage;
    this.log.debug("ai completion ok", {
      model: parsed.data.model ?? this.cfg.model,
      finish: choice.finish_reason ?? null,
    });

    return {
      content,
      usage: { prompt: usage?.prompt_tokens ?? 0, completion: usage?.completion_tokens ?? 0 },
      model: parsed.data.model ?? this.cfg.model,
    };
  }
}
