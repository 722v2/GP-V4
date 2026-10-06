/**
 * Live account capital / equity source interface for broker adapters.
 * Allows RiskEngine to consume live account equity without tight coupling.
 */
export interface AccountCapitalSource {
  readonly name: string;
  getEquity(): Promise<number | null>;
}

export class ConfiguredCapitalSource implements AccountCapitalSource {
  readonly name = "configured";

  constructor(private readonly equityFn: () => number) {}

  async getEquity(): Promise<number | null> {
    const eq = this.equityFn();
    return Number.isFinite(eq) && eq > 0 ? eq : null;
  }
}
