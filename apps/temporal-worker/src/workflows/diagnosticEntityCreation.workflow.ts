import { proxyActivities } from '@temporalio/workflow';
import type { resolveCIK } from '../activities/edgar.activities';

const { resolveCIK: resolveCIKActivity } = proxyActivities<{
  resolveCIK: typeof resolveCIK;
}>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 1, // Don't retry - we want to see the real error
  },
});

export interface DiagnosticEntityCreationInput {
  ticker: string;
}

/**
 * Diagnostic workflow to test entity creation in isolation
 *
 * This workflow ONLY runs resolveCIK to create the entity and CUSIP mappings,
 * then returns. Use this to diagnose why entity creation is failing.
 *
 * Usage:
 * ```bash
 * temporal workflow start \
 *   --namespace ird \
 *   --task-queue rotation-detector \
 *   --type diagnosticEntityCreationWorkflow \
 *   --input '{"ticker": "AAPL"}'
 * ```
 */
export async function diagnosticEntityCreationWorkflow(
  input: DiagnosticEntityCreationInput
): Promise<{ cik: string; cusips: string[]; success: boolean }> {
  try {
    const result = await resolveCIKActivity(input.ticker);
    return {
      ...result,
      success: true,
    };
  } catch (error) {
    console.error('[diagnosticEntityCreationWorkflow] Failed:', error);
    throw error;
  }
}
