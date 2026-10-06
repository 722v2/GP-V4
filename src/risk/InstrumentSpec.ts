/**
 * Configuration-driven instrument specification abstraction.
 * Ensures RiskEngine and Execution code contain no hard-coded contract assumptions.
 */
export interface InstrumentSpec {
  readonly symbol: string;
  readonly canonicalSymbol?: string;
  readonly brokerSymbol?: string;
  readonly baseCurrency?: string;
  readonly quoteCurrency?: string;
  readonly digits?: number;
  readonly pointSize: number;
  readonly tickSize: number;
  readonly tickValue: number;
  readonly contractSize: number;
  readonly minLot: number;
  readonly maxLot: number;
  readonly lotStep: number;
  readonly minStopDistancePts?: number;
  readonly freezeLevelPts?: number;
  readonly tradingSessions?: readonly string[];
  readonly marginRate?: number;
}

/** Standard canonical XAUUSD default specification (1 standard lot = 100 troy oz gold). */
export const DEFAULT_XAUUSD_SPEC: InstrumentSpec = {
  symbol: "XAUUSD",
  canonicalSymbol: "XAUUSD",
  brokerSymbol: "XAUUSD",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pointSize: 1.0,
  tickSize: 0.01,
  tickValue: 1.0,
  contractSize: 100,
  minLot: 0.01,
  maxLot: 10.0,
  lotStep: 0.01,
  minStopDistancePts: 1.0,
  freezeLevelPts: 0.0,
  tradingSessions: ["23:00-22:00 UTC"],
  marginRate: 0.01, // 1:100 leverage typical base
};

export interface InstrumentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates an instrument specification to ensure no execution occurs on invalid parameters.
 */
export function validateInstrumentSpec(spec?: InstrumentSpec | null): InstrumentValidationResult {
  const errors: string[] = [];
  if (!spec) {
    return { valid: false, errors: ["Instrument specification is missing"] };
  }
  if (!spec.symbol || spec.symbol.trim() === "") {
    errors.push("Symbol is required");
  }
  if (!Number.isFinite(spec.pointSize) || spec.pointSize <= 0) {
    errors.push(`Invalid pointSize: ${spec.pointSize} (must be > 0)`);
  }
  if (!Number.isFinite(spec.tickSize) || spec.tickSize <= 0) {
    errors.push(`Invalid tickSize: ${spec.tickSize} (must be > 0)`);
  }
  if (!Number.isFinite(spec.tickValue) || spec.tickValue <= 0) {
    errors.push(`Invalid tickValue: ${spec.tickValue} (must be > 0)`);
  }
  if (!Number.isFinite(spec.contractSize) || spec.contractSize <= 0) {
    errors.push(`Invalid contractSize: ${spec.contractSize} (must be > 0)`);
  }
  if (!Number.isFinite(spec.minLot) || spec.minLot <= 0) {
    errors.push(`Invalid minLot: ${spec.minLot} (must be > 0)`);
  }
  if (!Number.isFinite(spec.maxLot) || spec.maxLot < spec.minLot) {
    errors.push(`Invalid maxLot: ${spec.maxLot} (must be >= minLot ${spec.minLot})`);
  }
  if (!Number.isFinite(spec.lotStep) || spec.lotStep <= 0) {
    errors.push(`Invalid lotStep: ${spec.lotStep} (must be > 0)`);
  }
  if (spec.minStopDistancePts !== undefined && (!Number.isFinite(spec.minStopDistancePts) || spec.minStopDistancePts < 0)) {
    errors.push(`Invalid minStopDistancePts: ${spec.minStopDistancePts} (must be >= 0)`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
