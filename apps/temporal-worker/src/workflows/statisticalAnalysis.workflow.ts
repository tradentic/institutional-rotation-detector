import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';
import type {
  StatisticalAnalysisInput,
  StatisticalAnalysisResult,
} from '../activities/statistical-analysis.activities';

const { performStatisticalAnalysis } = proxyActivities<{
  performStatisticalAnalysis(input: StatisticalAnalysisInput): Promise<StatisticalAnalysisResult>;
}>(
  {
    startToCloseTimeout: '10 minutes', // Longer timeout for code execution
    scheduleToCloseTimeout: '15 minutes',
  }
);

export interface StatisticalAnalysisWorkflowInput {
  analysisType: 'correlation' | 'regression' | 'anomaly' | 'custom';
  dataQuery: {
    table: 'rotation_events' | 'rotation_edges' | 'graph_edges';
    filters?: Record<string, any>;
    periodStart?: string;
    periodEnd?: string;
    limit?: number;
  };
  question: string;
  customCode?: string;
  runKind?: 'analysis' | 'research';
}

/**
 * Statistical Analysis Workflow with E2B Code Execution
 *
 * Enables ad-hoc statistical analysis on rotation data using GPT-5 + E2B.
 *
 * Example use cases:
 *
 * 1. Correlation Analysis:
 *    "Is there correlation between dump Z-score and cumulative abnormal returns?"
 *
 * 2. Anomaly Detection:
 *    "Find outliers in rotation events using isolation forest"
 *
 * 3. Regression Analysis:
 *    "Does uptake predict CAR? Run linear regression with significance tests"
 *
 * 4. Custom Analysis:
 *    Provide your own Python code for complex statistical tests
 *
 * The workflow:
 * 1. Fetches data from database
 * 2. GPT-5 plans statistical approach (CoT)
 * 3. Generates Python code
 * 4. Executes code in E2B sandbox
 * 5. Analyzes results (CoT preserved)
 * 6. Draws conclusions (CoT preserved)
 */
export async function statisticalAnalysisWorkflow(
  input: StatisticalAnalysisWorkflowInput
): Promise<StatisticalAnalysisResult> {
  const runKind = input.runKind ?? 'analysis';
  const periodStart = input.dataQuery.periodStart ?? 'unknown';
  const periodEnd = input.dataQuery.periodEnd ?? 'unknown';

  await upsertWorkflowSearchAttributes({
    runKind,
    windowKey: `stats-analysis:${periodStart}:${periodEnd}`,
    periodEnd,
    batchId: `statistical-analysis:${runKind}:${Date.now()}`,
    dataset: input.dataQuery.table.toUpperCase(),
  });

  const result = await performStatisticalAnalysis({
    analysisType: input.analysisType,
    dataQuery: input.dataQuery,
    question: input.question,
    customCode: input.customCode,
  });

  return result;
}
