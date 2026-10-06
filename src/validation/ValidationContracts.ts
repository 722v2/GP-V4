import type { BacktestPerformanceMetrics } from "../backtest/BacktestRunner.js";

export interface DataQualityMetrics {
  readonly duplicateCount: number;
  readonly invalidRangeCount: number;
  readonly invalidValueCount: number;
  readonly unexpectedGapsCount: number;
  readonly expectedSessionGapsCount: number;
  readonly outOfOrderCount: number;
  readonly symbolMismatches: number;
  readonly timeframeMismatches: number;
}

export interface DataQualityIssue {
  readonly severity: "ERROR" | "WARNING" | "INFO";
  readonly message: string;
  readonly index?: number;
  readonly timestamp?: number;
}

export interface DataQualityReport {
  readonly valid: boolean;
  readonly totalCandles: number;
  readonly symbol?: string;
  readonly timeframe?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly metrics: DataQualityMetrics;
  readonly issues: readonly DataQualityIssue[];
}

export interface BaselineComparisonReport {
  readonly datasetId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly unfiltered: {
    readonly totalSignals: number;
    readonly metrics: BacktestPerformanceMetrics;
  };
  readonly filtered: {
    readonly totalSignals: number;
    readonly metrics: BacktestPerformanceMetrics;
  };
  readonly comparison: {
    readonly signalReductionPct: number;
    readonly netProfitDiff: number;
    readonly winRateDiff: number;
    readonly drawdownDiff: number;
  };
}

export interface WalkForwardWindowResult {
  readonly windowIndex: number;
  readonly inSampleRange: {
    readonly start: number;
    readonly end: number;
    readonly startDate?: string;
    readonly endDate?: string;
  };
  readonly outOfSampleRange: {
    readonly start: number;
    readonly end: number;
    readonly startDate?: string;
    readonly endDate?: string;
  };
  readonly inSampleMetrics: BacktestPerformanceMetrics;
  readonly outOfSampleMetrics: BacktestPerformanceMetrics;
}

export interface WalkForwardReport {
  readonly totalWindows: number;
  readonly windows: readonly WalkForwardWindowResult[];
  readonly aggregateOutOfSampleMetrics: BacktestPerformanceMetrics;
  readonly walkForwardEfficiency: number;
}

export interface AiComparisonReport {
  readonly status: "COMPLETED" | "PENDING_RECORDED_DATA";
  readonly note: string;
  readonly aiExcludedMetrics: BacktestPerformanceMetrics;
  readonly aiIncludedMetrics?: BacktestPerformanceMetrics;
}

export interface HistoricalValidationReport {
  readonly datasetInfo: {
    readonly id: string;
    readonly symbol: string;
    readonly timeframe: string;
    readonly startDate?: string;
    readonly endDate?: string;
    readonly totalCandles: number;
    readonly isRealBrokerData: boolean;
  };
  readonly dataQuality: DataQualityReport;
  readonly baselineComparison: BaselineComparisonReport;
  readonly walkForward: WalkForwardReport;
  readonly aiComparison: AiComparisonReport;
  readonly status: "COMPLETED" | "PARTIAL_PENDING_DATA";
  readonly summary: string;
}
