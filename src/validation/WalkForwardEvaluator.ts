import type { Candle } from "../core/types/Candle.js";
import type { RiskConfig } from "../risk/RiskEngine.js";
import { BacktestRunner, BacktestStore, SpreadSlippageModel, calculatePerformanceMetrics } from "../backtest/BacktestRunner.js";
import type { TradeLifecycleState } from "../execution/TradeLifecycle.js";
import type { WalkForwardReport, WalkForwardWindowResult } from "./ValidationContracts.js";

export interface WalkForwardConfig {
  readonly inSampleBars: number;
  readonly outOfSampleBars: number;
  readonly stepBars: number;
  readonly riskConfig: RiskConfig;
  readonly spreadModel: SpreadSlippageModel;
  readonly warmupBars?: number;
}

export class WalkForwardEvaluator {
  static async evaluate(
    candles: readonly Candle[],
    config: WalkForwardConfig
  ): Promise<WalkForwardReport> {
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const { inSampleBars, outOfSampleBars, stepBars, riskConfig, spreadModel, warmupBars = 5 } = config;

    const windows: WalkForwardWindowResult[] = [];
    const allOosClosedTrades: TradeLifecycleState[] = [];

    let start = 0;
    let windowIndex = 0;

    while (start + inSampleBars + outOfSampleBars <= sorted.length) {
      const isCandles = sorted.slice(start, start + inSampleBars);
      const oosCandles = sorted.slice(start + inSampleBars, start + inSampleBars + outOfSampleBars);

      if (isCandles.length < warmupBars + 1 || oosCandles.length === 0) {
        break;
      }

      // 1. Run In-Sample
      const isStore = new BacktestStore();
      const isRunner = new BacktestRunner(isCandles, isStore, spreadModel, riskConfig, warmupBars);
      const isResult = await isRunner.run();

      // 2. Run Out-Of-Sample
      const oosStore = new BacktestStore();
      const oosRunner = new BacktestRunner(oosCandles, oosStore, spreadModel, riskConfig, Math.min(warmupBars, Math.floor(oosCandles.length / 2)));
      const oosResult = await oosRunner.run();

      allOosClosedTrades.push(...oosStore.closed);

      const isFirst = isCandles[0]!;
      const isLast = isCandles[isCandles.length - 1]!;
      const oosFirst = oosCandles[0]!;
      const oosLast = oosCandles[oosCandles.length - 1]!;

      windows.push({
        windowIndex,
        inSampleRange: {
          start: isFirst.openTime,
          end: isLast.closeTime,
          startDate: new Date(isFirst.openTime).toISOString(),
          endDate: new Date(isLast.closeTime).toISOString(),
        },
        outOfSampleRange: {
          start: oosFirst.openTime,
          end: oosLast.closeTime,
          startDate: new Date(oosFirst.openTime).toISOString(),
          endDate: new Date(oosLast.closeTime).toISOString(),
        },
        inSampleMetrics: isResult.metrics,
        outOfSampleMetrics: oosResult.metrics,
      });

      start += stepBars;
      windowIndex += 1;
    }

    const aggregateOutOfSampleMetrics = calculatePerformanceMetrics(allOosClosedTrades, riskConfig.accountEquity);

    // Compute Walk-Forward Efficiency (Ratio of OOS Net Profit / IS Net Profit, or 1.0 if IS net profit is 0)
    let totalIsNetProfit = 0;
    for (const w of windows) {
      totalIsNetProfit += w.inSampleMetrics.netProfit;
    }

    let walkForwardEfficiency = 1.0;
    if (totalIsNetProfit > 0) {
      walkForwardEfficiency = Math.round((aggregateOutOfSampleMetrics.netProfit / totalIsNetProfit) * 100) / 100;
    } else if (aggregateOutOfSampleMetrics.netProfit < 0) {
      walkForwardEfficiency = 0;
    }

    return {
      totalWindows: windows.length,
      windows,
      aggregateOutOfSampleMetrics,
      walkForwardEfficiency,
    };
  }
}
