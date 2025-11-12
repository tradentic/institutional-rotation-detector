#!/usr/bin/env node
/**
 * Temporal Worker Entry Point
 *
 * Starts a Temporal worker that processes workflows and activities
 * for the institutional rotation detector.
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as activities from './activities/all-activities';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  // Read configuration from environment
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'rotation-detector';

  console.log('🚀 Starting Temporal Worker...');
  console.log(`   Temporal Address: ${temporalAddress}`);
  console.log(`   Namespace: ${namespace}`);
  console.log(`   Task Queue: ${taskQueue}`);

  // Connect to Temporal
  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  console.log('✅ Connected to Temporal server');

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: join(__dirname, 'workflows'),
    activities,
    // Increased timeouts for data-heavy operations
    maxCachedWorkflows: 100,
    // Allow long-running activities (SEC API, data processing)
    maxConcurrentActivityTaskExecutions: 50,
    maxConcurrentWorkflowTaskExecutions: 20,
  });

  console.log('✅ Worker created successfully');
  console.log('');
  console.log('📋 Registered Workflows:');
  console.log('   - ingestIssuerWorkflow');
  console.log('   - ingestQuarterWorkflow');
  console.log('   - rotationDetectWorkflow');
  console.log('   - eventStudyWorkflow');
  console.log('   - graphBuildWorkflow');
  console.log('   - graphSummarizeWorkflow');
  console.log('   - graphQueryWorkflow');
  console.log('   - edgarSubmissionsPollerWorkflow');
  console.log('   - nportMonthlyTimerWorkflow');
  console.log('   - etfDailyCronWorkflow');
  console.log('   - finraShortPublishWorkflow');
  console.log('   - finraOtcWeeklyIngestWorkflow');
  console.log('   - iexDailyIngestWorkflow');
  console.log('   - offexRatioComputeWorkflow');
  console.log('   - flip50DetectWorkflow');
  console.log('   - shortInterestIngestWorkflow');
  console.log('   - microstructureAnalysisWorkflow');
  console.log('   - form4IngestWorkflow');
  console.log('   - form4DailyCronWorkflow');
  console.log('   - optionsIngestWorkflow');
  console.log('   - optionsMinimalIngestWorkflow');
  console.log('   - unusualOptionsActivityCronWorkflow');
  console.log('   - optionsBatchIngestWorkflow');
  console.log('   - optionsDeepAnalysisWorkflow');
  console.log('');
  console.log('🎯 Worker is ready and listening for tasks...');
  console.log('   Press Ctrl+C to stop');
  console.log('');

  // Run the worker
  await worker.run();
}

run().catch((err) => {
  console.error('❌ Worker failed:', err);
  process.exit(1);
});
