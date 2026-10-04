export const SYMBOLS = ["XAUUSD"] as const;
export type Symbol = (typeof SYMBOLS)[number];

export const TIMEFRAMES = ["M1", "M5", "M15", "H1", "H4", "D1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
};

export function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === "string" && (TIMEFRAMES as readonly string[]).includes(v);
}
