import { proxyActivities } from '@temporalio/workflow';
import type { generateQAReport, exportQAReport } from '../activities/qa.activities';

const { generateQAReport: generateQAReportActivity, exportQAReport: exportQAReportActivity } = proxyActivities<{
  generateQAReport: typeof generateQAReport;
  exportQAReport: typeof exportQAReport;
}>({
  startToCloseTimeout: '2 minutes',
});

export interface QAReportInput {
  ticker: string;
  from: string;
  to: string;
  minPct?: number;
}

/**
 * QA Report Workflow
 *
 * Generates a comprehensive diagnostic report for ticker data ingestion.
 * This workflow validates what data was actually ingested vs what should
 * have been ingested, identifying gaps and issues.
 *
 * Usage:
 * ```bash
 * temporal workflow start \
 *   --namespace ird \
 *   --task-queue rotation-detector \
 *   --type qaReportWorkflow \
 *   --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
 * ```
 */
export async function qaReportWorkflow(input: QAReportInput) {
  const report = await generateQAReportActivity(input);
  return report;
}

/**
 * QA Report Export Workflow
 *
 * Same as qaReportWorkflow but returns the report as formatted JSON string
 * for easy export and analysis.
 */
export async function qaReportExportWorkflow(input: QAReportInput) {
  const jsonReport = await exportQAReportActivity(input);
  return jsonReport;
}
