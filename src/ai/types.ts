import { z } from "zod";

/**
 * Minimal OpenAI-compatible chat-completions contract. Novita exposes this shape.
 * The exact model name and base URL come from config — never hard-coded.
 */
export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })
  ),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  response_format: z.object({ type: z.literal("json_object") }).optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export const ChatCompletionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().optional(),
        message: z.object({ role: z.string().optional(), content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

/** Provider boundary. Implementations may call a network API or replay fixtures. */
export interface AiProvider {
  readonly name: string;
  complete(req: ChatCompletionRequest, opts?: { signal?: AbortSignal }): Promise<AiProviderResult>;
}

export interface AiTokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

export interface AiProviderResult {
  readonly content: string;
  readonly usage: AiTokenUsage;
  readonly model: string;
}
