import type { RuntimeConfigStore } from "../config/RuntimeConfigStore.js";
import type { TelegramNotifier } from "./TelegramNotifier.js";
import type { Logger } from "../core/logging/Logger.js";
import { AppError, ErrorCode } from "../core/logging/Logger.js";

export interface DiscoveryStatus {
  status: "UNCONFIGURED" | "PENDING" | "VERIFIED";
  claimCode: string | null;
  claimExpiresAt: number;
  verifiedChatId: string | null;
  isPollingActive: boolean;
  diagnostic?: string;
}

export class TelegramDiscoveryService {
  private claimCode: string | null = null;
  private claimExpiresAt: number = 0;
  private lastUpdateId: number = 0;
  private status: "UNCONFIGURED" | "PENDING" | "VERIFIED" = "UNCONFIGURED";
  private verifiedChatId: string | null = null;
  private isPollingActive: boolean = false;
  private pollingTimer: any = null;
  private readonly processedUpdateIds = new Set<number>();
  private diagnosticMessage: string | undefined = undefined;
  private sleepUntil: number = 0;

  constructor(
    private readonly configStore: RuntimeConfigStore,
    private readonly telegram: TelegramNotifier,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    // Sync initial state from persisted configuration if already verified
    const cfg = this.configStore.get();
    if (cfg.telegram.chatId) {
      this.status = "VERIFIED";
      this.verifiedChatId = cfg.telegram.chatId;
    } else if (cfg.telegram.discoveryStatus?.status === "VERIFIED" && cfg.telegram.discoveryStatus.chatId) {
      this.status = "VERIFIED";
      this.verifiedChatId = cfg.telegram.discoveryStatus.chatId;
    }
  }

  getStatus(): DiscoveryStatus {
    // If claim has expired, clean up status
    if (this.claimCode && Date.now() > this.claimExpiresAt) {
      this.claimCode = null;
      if (this.status === "PENDING") {
        this.status = "UNCONFIGURED";
      }
    }

    return {
      status: this.status,
      claimCode: this.claimCode,
      claimExpiresAt: this.claimExpiresAt,
      verifiedChatId: this.verifiedChatId,
      isPollingActive: this.isPollingActive,
      diagnostic: this.diagnosticMessage,
    };
  }

  async generateClaimCode(): Promise<DiscoveryStatus> {
    const cfg = this.configStore.get();
    if (!cfg.features.telegramEnabled || !cfg.telegram.botToken) {
      throw new Error("Telegram integrations must be enabled with a valid Bot Token before discovery.");
    }

    // Cryptographically random 6-character hex code
    let code = "";
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(3);
      crypto.getRandomValues(bytes);
      code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    } else {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    this.claimCode = code;
    this.claimExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration
    this.status = "PENDING";
    this.diagnosticMessage = "Active claim code generated. Awaiting private Telegram message.";
    
    this.log.info("generated new Telegram discovery claim code", { code, expiresAt: this.claimExpiresAt });

    this.startPolling();
    return this.getStatus();
  }

  startPolling(): void {
    if (this.isPollingActive) return;
    this.isPollingActive = true;
    this.log.info("starting Telegram getUpdates auto-discovery polling loop");
    this.pollLoop();
  }

  stopPolling(): void {
    this.isPollingActive = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.log.info("stopped Telegram auto-discovery polling loop");
  }

  private async pollLoop(): Promise<void> {
    if (!this.isPollingActive) return;

    try {
      await this.poll();
    } catch (err: any) {
      this.log.error("error during Telegram auto-discovery poll", err);
    }

    // Schedule next poll unless stopped or status became verified
    if (this.isPollingActive && this.status !== "VERIFIED") {
      const delay = Date.now() < this.sleepUntil ? Math.max(1000, this.sleepUntil - Date.now()) : 2000;
      this.pollingTimer = setTimeout(() => this.pollLoop(), delay);
    } else if (this.status === "VERIFIED") {
      this.stopPolling();
    }
  }

  async poll(): Promise<void> {
    const cfg = this.configStore.get();
    const botToken = cfg.telegram.botToken;
    if (!botToken) {
      this.diagnosticMessage = "Missing Bot Token";
      this.stopPolling();
      return;
    }

    if (Date.now() < this.sleepUntil) {
      return;
    }

    // Handle claim code expiration
    if (this.claimCode && Date.now() > this.claimExpiresAt) {
      this.claimCode = null;
      this.status = "UNCONFIGURED";
      this.diagnosticMessage = "Claim code expired";
      this.stopPolling();
      return;
    }

    const offset = this.lastUpdateId > 0 ? this.lastUpdateId + 1 : 0;
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?timeout=10&offset=${offset}`;

    try {
      const res = await this.fetchImpl(url, { method: "GET" });
      
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 5;
        this.sleepUntil = Date.now() + retryAfter * 1000;
        this.log.warn("Telegram API rate limited (429), sleeping", { retryAfter });
        this.diagnosticMessage = `Rate limited: retry after ${retryAfter}s`;
        return;
      }

      if (!res.ok) {
        this.log.warn(`Telegram getUpdates failed with status ${res.status}`);
        this.diagnosticMessage = `HTTP failure ${res.status}`;
        return;
      }

      const body = (await res.json()) as any;
      if (!body.ok) {
        this.log.warn("Telegram getUpdates returned error response", body);
        this.diagnosticMessage = body.description || "API Error";
        return;
      }

      const updates = body.result || [];
      for (const update of updates) {
        const updateId = update.update_id;
        if (updateId) {
          this.lastUpdateId = Math.max(this.lastUpdateId, updateId);
        }

        // Duplicate protection
        if (this.processedUpdateIds.has(updateId)) {
          continue;
        }
        this.processedUpdateIds.add(updateId);

        const message = update.message;
        if (!message || !message.chat || !message.text) {
          continue;
        }

        const chatId = String(message.chat.id);
        const chatType = message.chat.type;
        const text = message.text.trim();

        // Check if message matches active claim code (case-insensitive)
        if (this.claimCode && text.toUpperCase() === this.claimCode) {
          // Check claim expiration
          if (Date.now() > this.claimExpiresAt) {
            this.claimCode = null;
            this.status = "UNCONFIGURED";
            this.diagnosticMessage = "Expired claim code submitted and ignored";
            continue;
          }

          // Restrict to private chats only
          if (chatType !== "private") {
            this.log.warn("rejected non-private chat claim attempt", { chatType, chatId });
            this.diagnosticMessage = `Rejected non-private chat type: ${chatType}`;
            continue;
          }

          this.log.info("successfully verified Telegram discovery claim code!", { chatId, chatType });
          
          this.verifiedChatId = chatId;
          this.status = "VERIFIED";
          this.claimCode = null;
          this.diagnosticMessage = "Verification successful";

          // Atomically update configuration store, persists to file + DB and runs hot-reload
          await this.configStore.update({
            telegram: {
              chatId,
              discoveryStatus: {
                status: "VERIFIED",
                chatId,
                verifiedAt: Date.now(),
              },
            },
          }, "telegram-auto-discovery");

          break;
        }
      }
    } catch (err: any) {
      this.log.error("Telegram network / fetch failure during getUpdates", err);
      this.diagnosticMessage = err.message || "Network failure";
    }
  }
}
