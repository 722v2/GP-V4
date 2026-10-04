import type { Logger } from "../core/logging/Logger.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

/**
 * Telegram notifier. Transport is injected for tests; when disabled or
 * unconfigured every method is a silent no-op so the pipeline never breaks on
 * notification failure.
 */
export class TelegramNotifier {
  constructor(
    private readonly cfg: TelegramConfig,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get isOn(): boolean {
    return this.cfg.enabled && this.cfg.botToken !== "" && this.cfg.chatId !== "";
  }

  async notify(message: string): Promise<boolean> {
    if (!this.isOn) return false;
    try {
      const url = `https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.cfg.chatId, text: message, parse_mode: "Markdown" }),
      });
      if (!res.ok) {
        this.log.warn(`telegram send failed with HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.log.warn("telegram send error", { err: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /** Formats a trade decision for Telegram. */
  static formatDecision(symbol: string, direction: string, entry: number, sl: number, tp1: number, tp2: number, mode: string): string {
    return [
      `*${symbol} ${direction}* [${mode}]`,
      `Entry: ${entry}`,
      `SL: ${sl}`,
      `TP1: ${tp1}`,
      `TP2: ${tp2}`,
    ].join("\n");
  }
}