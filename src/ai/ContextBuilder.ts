import type { Candle } from "../core/types/Candle.js";
import type { ConfluenceResult } from "../strategies/ConfluenceEngine.js";
import type { Setup } from "../core/types/Setup.js";
import type { EngineContext } from "../strategies/Engine.js";

/**
 * Builds the analysis prompt for the AI router. Deterministic: same inputs →
 * same prompt string, which makes responses cacheable and replays consistent.
 */
export class ContextBuilder {
  constructor(private readonly maxCandles = 100) {}

  buildSetupPrompt(
    ctx: EngineContext,
    confluence: ConfluenceResult,
    setup: Setup,
    accountEquity: number,
    mode: string
  ): { system: string; user: string } {
    const candles = ctx.candles.slice(-this.maxCandles);
    const rows = candles
      .map((c: Candle) => `${iso(c.openTime)},${fmt(c.open)},${fmt(c.high)},${fmt(c.low)},${fmt(c.close)},${c.volume}`)
      .join("\n");
    const evidence = confluence.evidence
      .map((e) => `- [${e.source}] ${e.kind}: ${e.detail} (weight ${e.weight.toFixed(2)})`)
      .join("\n");
    const levels = confluence.levels.map((l) => `${l.kind}@${l.price.toFixed(2)}`).join(", ");

    const system = [
      "You are a disciplined XAU/USD trading analyst.",
      "Respond ONLY with a single JSON object matching this schema:",
      '{"decision":"NO_TRADE|WATCH|TRADE_CANDIDATE","direction":"LONG|SHORT","setup_id":string,"entry":number,"SL":number,"TP1":number,"TP2":number,"invalidation":number,"confidence":0-1,"evidence":[{"source":string,"detail":string}],"risk_notes":[string],"management_plan":string,"reassessment_conditions":[string],"reason_codes":[string]}',
      "confidence is your self-assessed certainty in [0,1], NOT win probability.",
      "When evidence is mixed or insufficient, choose NO_TRADE or WATCH.",
      "Never propose lot sizes; risk sizing is computed separately.",
    ].join("\n");

    const user = [
      `MODE: ${mode}`,
      `SYMBOL: ${ctx.symbol} TF: ${ctx.timeframe}`,
      `ACCOUNT_EQUITY_USD: ${accountEquity}`,
      `CONFLUENCE_SCORE: ${confluence.score.toFixed(2)} (direction: ${confluence.direction ?? "none"})`,
      `LEVELS: ${levels || "none"}`,
      "EVIDENCE:",
      evidence || "- none",
      "STRATEGY SETUP:",
      JSON.stringify({
        id: setup.id,
        direction: setup.direction,
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        takeProfit1: setup.takeProfit1,
        takeProfit2: setup.takeProfit2,
        rationale: setup.rationale,
      }),
      "CLOSED CANDLES (UTC open time,OHLCV, most recent last):",
      rows,
    ].join("\n");

    return { system, user };
  }
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

function fmt(n: number): string {
  return n.toFixed(2);
}
