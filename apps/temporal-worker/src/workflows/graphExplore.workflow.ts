import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  ExploreGraphInput,
  ExploreGraphResult,
} from '../activities/graph-exploration.activities.js';

const { exploreGraph } = proxyActivities<{
  exploreGraph(input: ExploreGraphInput): Promise<ExploreGraphResult>;
}>(
  {
    startToCloseTimeout: '5 minutes',
    scheduleToCloseTimeout: '10 minutes',
  }
);

export interface GraphExploreWorkflowInput {
  ticker?: string;
  cik?: string;
  periodStart: string;
  periodEnd: string;
  questions: string[];
  runKind?: 'query' | 'analysis';
}

/**
 * Interactive Graph Exploration Workflow
 *
 * Enables multi-turn Q&A about the institutional investor graph with
 * Chain of Thought context preservation.
 *
 * Example questions:
 * 1. "Which institutions rotated out of AAPL in Q1 2024?"
 * 2. "Did those same institutions rotate into other tech stocks?"
 * 3. "What was the total dollar value of these flows?"
 *
 * Each question builds on previous context, saving 60%+ tokens.
 */
export async function graphExploreWorkflow(
  input: GraphExploreWorkflowInput
): Promise<ExploreGraphResult> {
  const runKind = input.runKind ?? 'query';
  const windowKey = `graph-explore:${input.periodStart}:${input.periodEnd}`;

  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind,
    windowKey,
    periodEnd: input.periodEnd,
    batchId: `graph-explore:${runKind}:${Date.now()}`,
  });

  const result = await exploreGraph({
    ticker: input.ticker,
    cik: input.cik,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    questions: input.questions,
  });

  return result;
}
