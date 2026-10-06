import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import type { PersistenceRepository } from "../persistence/Persistence.js";

export interface ScannerActivityEntry {
  id: string;
  timestamp: number;
  symbol: string;
  timeframe: string;
  durationMs: number;
  status: "SUCCESS" | "WARNING" | "ERROR" | "SKIPPED";
  candlesFetched: number;
  newBars: number;
  setupsFound: number;
  signalsGenerated: number;
  errorCount: number;
  errorMessage: string | null;
  runId: string;
}

export class ScannerActivityStore {
  private history: ScannerActivityEntry[] = [];
  private readonly maxEntries = 100;

  constructor(private readonly repo: PersistenceRepository) {}

  async load(): Promise<void> {
    try {
      if (this.repo.getSettings) {
        const settings = await this.repo.getSettings();
        if (settings && Array.isArray(settings.scannerHistory)) {
          this.history = settings.scannerHistory as ScannerActivityEntry[];
        }
      }
    } catch {
      // Fallback to in-memory if repo fails
    }
  }

  async record(entry: Omit<ScannerActivityEntry, "id" | "timestamp" | "runId">): Promise<ScannerActivityEntry> {
    const fullEntry: ScannerActivityEntry = {
      ...entry,
      id: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      runId: `run-${Math.random().toString(36).substring(2, 9)}`,
    };

    this.history.unshift(fullEntry);
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }

    try {
      if (this.repo.saveSettings && this.repo.getSettings) {
        const settings = (await this.repo.getSettings()) || {};
        await this.repo.saveSettings({
          ...settings,
          scannerHistory: this.history,
        }, "system");
      }
    } catch {
      // Safe fallback to in-memory only
    }

    return fullEntry;
  }

  getRecent(limit = 30): ScannerActivityEntry[] {
    return this.history.slice(0, limit);
  }

  clear(): void {
    this.history = [];
  }
}
