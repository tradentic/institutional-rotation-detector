import type { WorkflowInput } from './workflow-schemas';

/**
 * Workflow Presets
 *
 * Pre-filled examples for quick testing of workflows.
 */

export interface WorkflowPreset {
  id: string;
  name: string;
  workflowId: string;
  input: WorkflowInput;
}

export const workflowPresets: WorkflowPreset[] = [
  // Ingest Issuer Presets
  {
    id: 'ingest-aapl-2024',
    name: 'AAPL 2024 (All Quarters)',
    workflowId: 'ingest-issuer',
    input: {
      ticker: 'AAPL',
      from: '2024-01-01',
      to: '2024-12-31',
      runKind: 'daily',
      minPct: 5,
      quarterBatch: 8,
    },
  },
  {
    id: 'ingest-msft-q1',
    name: 'MSFT Q1 2024',
    workflowId: 'ingest-issuer',
    input: {
      ticker: 'MSFT',
      from: '2024-01-01',
      to: '2024-03-31',
      runKind: 'daily',
      minPct: 5,
    },
  },
  {
    id: 'ingest-tsla-recent',
    name: 'TSLA Q3-Q4 2024',
    workflowId: 'ingest-issuer',
    input: {
      ticker: 'TSLA',
      from: '2024-07-01',
      to: '2024-12-31',
      runKind: 'daily',
      minPct: 5,
    },
  },

  // Rotation Detect Presets
  {
    id: 'rotation-aapl-q1',
    name: 'AAPL Q1 2024',
    workflowId: 'rotation-detect',
    input: {
      cik: '0000320193',
      cusips: ['037833100'],
      quarter: '2024Q1',
      ticker: 'AAPL',
      runKind: 'daily',
      quarterStart: '2024-01-01',
      quarterEnd: '2024-03-31',
    },
  },

  // Graph Build Presets
  {
    id: 'graph-build-aapl',
    name: 'AAPL Q1 2024 Graph',
    workflowId: 'graph-build',
    input: {
      cik: '0000320193',
      quarter: '2024Q1',
      ticker: 'AAPL',
      runKind: 'daily',
    },
  },
  {
    id: 'graph-build-msft',
    name: 'MSFT Q1 2024 Graph',
    workflowId: 'graph-build',
    input: {
      cik: '0000789019',
      quarter: '2024Q1',
      ticker: 'MSFT',
      runKind: 'daily',
    },
  },

  // Graph Summarize Presets
  {
    id: 'graph-summarize-aapl',
    name: 'AAPL Q1 2024 Communities',
    workflowId: 'graph-summarize',
    input: {
      cik: '0000320193',
      quarter: '2024Q1',
      ticker: 'AAPL',
      runKind: 'daily',
    },
  },

  // Graph Explore Presets
  {
    id: 'explore-aapl-rotations',
    name: "Who's rotating AAPL Q1?",
    workflowId: 'graph-explore',
    input: {
      ticker: 'AAPL',
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      hops: 2,
      questions: [
        'What institutions are rotating in and out?',
        'Are these the same institutions that rotated in Q4 2023?',
        'What are the 3 most important insights?',
      ],
    },
  },
  {
    id: 'explore-tech-sector',
    name: 'Tech sector patterns',
    workflowId: 'graph-explore',
    input: {
      ticker: 'QQQ',
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      hops: 2,
      questions: [
        'What tech stocks are seeing institutional rotation?',
        'Which funds are most active in tech rotations?',
        'Any coordination patterns across tech names?',
      ],
    },
  },

  // Event Study Presets
  {
    id: 'event-study-aapl',
    name: 'AAPL Event Study',
    workflowId: 'event-study',
    input: {
      anchorDate: '2024-03-15',
      cik: '0000320193',
      ticker: 'AAPL',
      runKind: 'daily',
      quarterStart: '2024-01-01',
      quarterEnd: '2024-03-31',
    },
  },

  // Statistical Analysis Presets
  {
    id: 'stat-correlation',
    name: 'Dump vs CAR Correlation',
    workflowId: 'statistical-analysis',
    input: {
      analysisType: 'correlation',
      periodStart: '2023-01-01',
      periodEnd: '2024-12-31',
      variables: ['dumpz', 'car_m5_p20'],
    },
  },
  {
    id: 'stat-outliers',
    name: 'Find Outlier Events',
    workflowId: 'statistical-analysis',
    input: {
      analysisType: 'anomaly',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      method: 'isolation_forest',
    },
  },
  {
    id: 'stat-regression',
    name: 'Signals → R-score Regression',
    workflowId: 'statistical-analysis',
    input: {
      analysisType: 'regression',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      dependent: 'r_score',
      independent: ['dumpz', 'u_same', 'uhf_same', 'opt_same'],
    },
  },

  // Cross-Community Presets
  {
    id: 'cross-community-q1',
    name: 'Q1 2024 Systemic Patterns',
    workflowId: 'cross-community',
    input: {
      periodStart: '2024-01-01',
      periodEnd: '2024-03-31',
      minCommunities: 3,
      runKind: 'analysis',
    },
  },
  {
    id: 'cross-community-h1',
    name: 'H1 2024 Coordinated Behavior',
    workflowId: 'cross-community',
    input: {
      periodStart: '2024-01-01',
      periodEnd: '2024-06-30',
      minCommunities: 5,
      runKind: 'analysis',
    },
  },
];

// Helper to get presets by workflow ID
export function getPresetsByWorkflowId(workflowId: string): WorkflowPreset[] {
  return workflowPresets.filter((p) => p.workflowId === workflowId);
}

// Helper to get preset by ID
export function getPresetById(id: string): WorkflowPreset | undefined {
  return workflowPresets.find((p) => p.id === id);
}
