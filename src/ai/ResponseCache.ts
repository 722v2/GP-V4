/** TTL cache keyed by a deterministic prompt signature. */
export class ResponseCache {
  private store = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(private readonly ttlMs: number) {}

  get<T>(key: string, now: number): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, now: number): void {
    this.store.set(key, { expiresAt: now + this.ttlMs, value });
  }

  /** Deterministic hash of a prompt pair — stable across runs. */
  static signature(system: string, user: string): string {
    const combined = system + "\u0000" + user;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < combined.length; i++) {
      const ch = combined.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }
}