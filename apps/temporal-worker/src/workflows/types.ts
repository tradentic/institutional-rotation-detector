/**
 * Workflow Result Types
 *
 * These types define structured return values for workflows to provide
 * meaningful information in the Temporal UI for debugging and monitoring.
 */

export interface WorkflowExecutionSummary {
  /** Workflow execution status */
  status: 'success' | 'partial_success' | 'failed';

  /** Brief summary message */
  message: string;

  /** Detailed metrics and counts */
  metrics: {
    /** Items processed (filings, quarters, etc.) */
    processed: number;
    /** Items successfully created/updated */
    succeeded: number;
    /** Items that failed */
    failed: number;
    /** Items skipped (already exists, etc.) */
    skipped: number;
  };

  /** Execution timing information */
  timing?: {
    /** Start time (ISO string) */
    startedAt: string;
    /** End time (ISO string) */
    completedAt: string;
    /** Duration in milliseconds */
    durationMs: number;
  };

  /** Entity identification */
  entity: {
    /** Ticker symbol (if applicable) */
    ticker?: string;
    /** CIK number */
    cik?: string;
    /** CUSIPs */
    cusips?: string[];
  };

  /** Date range processed */
  dateRange?: {
    start: string;
    end: string;
  };

  /** Warnings encountered (non-fatal) */
  warnings?: string[];

  /** Errors encountered (non-fatal) */
  errors?: string[];

  /** Links to created/updated data */
  links?: {
    /** Rotation events created */
    rotationEvents?: string[];
    /** Filings processed */
    filings?: string[];
    /** Database query examples */
    queries?: string[];
  };
}

export interface IngestIssuerResult extends WorkflowExecutionSummary {
  /** Quarters processed in this execution */
  quarters: string[];

  /** Whether there are more quarters to process (continueAsNew) */
  hasMoreQuarters: boolean;

  /** Per-quarter breakdown */
  quarterResults?: Array<{
    quarter: string;
    status: 'success' | 'failed' | 'skipped';
    message?: string;
  }>;
}

export interface IngestQuarterResult extends WorkflowExecutionSummary {
  /** Quarter processed */
  quarter: string;

  /** Activity-level results */
  activities: {
    /** Filings fetched count */
    filingsFetched?: number;
    /** 13F records parsed */
    positions13f?: number;
    /** 13G/13D records parsed */
    positions13g13d?: number;
    /** N-PORT holdings fetched */
    nportHoldings?: number;
    /** ETF holdings fetched */
    etfHoldings?: number;
    /** Short interest records */
    shortInterest?: number;
    /** ATS weekly records */
    atsWeekly?: number;
  };
}

export interface RotationDetectResult extends WorkflowExecutionSummary {
  /** Quarter analyzed */
  quarter: string;

  /** Rotation events detected */
  rotationEvents: {
    /** Number of dump events detected */
    dumpEventsDetected: number;
    /** Number of high-confidence rotations (R-score > threshold) */
    highConfidenceCount: number;
    /** List of cluster IDs */
    clusterIds: string[];
  };

  /** Signals computed */
  signals: {
    /** Uptake metrics */
    uptake: { uSame: number; uNext: number };
    /** UHF metrics */
    uhf: { uhfSame: number; uhfNext: number };
    /** Options overlay */
    options: { optSame: number; optNext: number };
    /** Short relief */
    shortRelief: number;
  };

  /** AI analysis summary */
  aiAnalysis?: {
    /** Number of events analyzed by AI */
    eventsAnalyzed: number;
    /** Average confidence score */
    avgConfidence: number;
    /** Number of high anomaly events (score >= 7) */
    highAnomalyCount: number;
  };
}

export interface ValidationResult extends WorkflowExecutionSummary {
  /** Validation checks performed */
  checks: {
    /** CUSIP validation passed */
    cusipValid: boolean;
    /** ATS data validation passed */
    atsValid: boolean;
    /** ETF data validation passed */
    etfValid: boolean;
  };

  /** Issues found by category */
  issuesByCategory: Record<string, number>;

  /** Total error count */
  totalErrors: number;

  /** Total warning count */
  totalWarnings: number;
}
