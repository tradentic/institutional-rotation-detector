import { z } from 'zod';

/**
 * Workflow Schemas and Types
 *
 * Defines Zod schemas and TypeScript types for all workflows.
 */

// Common types
export const runKindSchema = z.enum(['backfill', 'daily', 'analysis', 'research', 'query']);

// ============================================================
// Data Ingestion Workflows
// ============================================================

export const ingestIssuerSchema = z.object({
  ticker: z.string().min(1, 'Ticker is required').toUpperCase(),
  from: z.string().min(1, 'Start date is required'),
  to: z.string().min(1, 'End date is required'),
  runKind: runKindSchema.default('daily'),
  minPct: z.coerce.number().min(1).max(100).default(5),
  quarterBatch: z.coerce.number().min(1).max(20).optional(),
});

export const rotationDetectSchema = z.object({
  cik: z.string().min(1, 'CIK is required'),
  cusips: z.array(z.string()).min(1, 'At least one CUSIP required'),
  quarter: z.string().min(1, 'Quarter is required'),
  ticker: z.string().min(1, 'Ticker is required'),
  runKind: runKindSchema.default('daily'),
  quarterStart: z.string().min(1, 'Quarter start date is required'),
  quarterEnd: z.string().min(1, 'Quarter end date is required'),
});

// ============================================================
// Graph Workflows
// ============================================================

export const graphBuildSchema = z.object({
  cik: z.string().min(1, 'CIK is required'),
  quarter: z.string().min(1, 'Quarter is required'),
  ticker: z.string().optional(),
  runKind: runKindSchema.default('daily'),
  maxEdgesBeforeContinue: z.coerce.number().optional(),
});

export const graphSummarizeSchema = z.object({
  cik: z.string().min(1, 'CIK is required'),
  quarter: z.string().min(1, 'Quarter is required'),
  ticker: z.string().optional(),
  runKind: runKindSchema.default('daily'),
  rootNodeId: z.string().optional(),
});

export const graphExploreSchema = z.object({
  ticker: z.string().optional(),
  cik: z.string().optional(),
  rootNodeId: z.string().optional(),
  periodStart: z.string().min(1, 'Start date is required'),
  periodEnd: z.string().min(1, 'End date is required'),
  questions: z.array(z.string()).min(1, 'At least one question required'),
  hops: z.coerce.number().min(1).max(3).default(2),
});

// ============================================================
// Advanced Analytics Workflows
// ============================================================

export const eventStudySchema = z.object({
  anchorDate: z.string().min(1, 'Anchor date is required'),
  cik: z.string().min(1, 'CIK is required'),
  ticker: z.string().min(1, 'Ticker is required'),
  runKind: runKindSchema.default('daily'),
  quarterStart: z.string().min(1, 'Quarter start is required'),
  quarterEnd: z.string().min(1, 'Quarter end is required'),
});

export const statisticalAnalysisSchema = z.object({
  analysisType: z.enum(['correlation', 'regression', 'anomaly', 'custom']),
  periodStart: z.string().min(1, 'Start date is required'),
  periodEnd: z.string().min(1, 'End date is required'),
  variables: z.array(z.string()).optional(),
  dependent: z.string().optional(),
  independent: z.array(z.string()).optional(),
  method: z.string().optional(),
  customCode: z.string().optional(),
});

export const crossCommunityAnalysisSchema = z.object({
  periodStart: z.string().min(1, 'Start date is required'),
  periodEnd: z.string().min(1, 'End date is required'),
  minCommunities: z.coerce.number().min(1).optional(),
  runKind: runKindSchema.default('analysis'),
});

// ============================================================
// TypeScript Types
// ============================================================

export type IngestIssuerInput = z.infer<typeof ingestIssuerSchema>;
export type RotationDetectInput = z.infer<typeof rotationDetectSchema>;
export type GraphBuildInput = z.infer<typeof graphBuildSchema>;
export type GraphSummarizeInput = z.infer<typeof graphSummarizeSchema>;
export type GraphExploreInput = z.infer<typeof graphExploreSchema>;
export type EventStudyInput = z.infer<typeof eventStudySchema>;
export type StatisticalAnalysisInput = z.infer<typeof statisticalAnalysisSchema>;
export type CrossCommunityAnalysisInput = z.infer<typeof crossCommunityAnalysisSchema>;

export type WorkflowInput =
  | IngestIssuerInput
  | RotationDetectInput
  | GraphBuildInput
  | GraphSummarizeInput
  | GraphExploreInput
  | EventStudyInput
  | StatisticalAnalysisInput
  | CrossCommunityAnalysisInput;

// ============================================================
// Workflow Metadata
// ============================================================

export interface WorkflowMetadata {
  id: string;
  name: string;
  description: string;
  category: 'ingestion' | 'graph' | 'analytics';
  schema: z.ZodSchema;
  workflowType: string;
  icon: string;
  estimatedDuration: string;
}

export const workflows: WorkflowMetadata[] = [
  // Data Ingestion
  {
    id: 'ingest-issuer',
    name: 'Ingest Issuer',
    description: 'Fetch all filings for a ticker across multiple quarters',
    category: 'ingestion',
    schema: ingestIssuerSchema,
    workflowType: 'ingestIssuerWorkflow',
    icon: '📥',
    estimatedDuration: '1-4 hours',
  },
  {
    id: 'rotation-detect',
    name: 'Rotation Detect',
    description: 'Detect and score institutional rotation events with AI analysis',
    category: 'ingestion',
    schema: rotationDetectSchema,
    workflowType: 'rotationDetectWorkflow',
    icon: '🔄',
    estimatedDuration: '5-10 min',
  },

  // Graph Analysis
  {
    id: 'graph-build',
    name: 'Build Graph',
    description: 'Construct knowledge graph from rotation edges',
    category: 'graph',
    schema: graphBuildSchema,
    workflowType: 'graphBuildWorkflow',
    icon: '🌐',
    estimatedDuration: '5-15 min',
  },
  {
    id: 'graph-summarize',
    name: 'Summarize Graph',
    description: 'Detect communities and generate AI summaries',
    category: 'graph',
    schema: graphSummarizeSchema,
    workflowType: 'graphSummarizeWorkflow',
    icon: '🔍',
    estimatedDuration: '5-10 min',
  },
  {
    id: 'graph-explore',
    name: 'Explore Graph',
    description: 'Interactive multi-turn graph exploration with CoT',
    category: 'graph',
    schema: graphExploreSchema,
    workflowType: 'graphExploreWorkflow',
    icon: '💬',
    estimatedDuration: '1-3 min',
  },

  // Advanced Analytics
  {
    id: 'event-study',
    name: 'Event Study',
    description: 'Calculate cumulative abnormal returns around events',
    category: 'analytics',
    schema: eventStudySchema,
    workflowType: 'eventStudyWorkflow',
    icon: '📈',
    estimatedDuration: '2-5 min',
  },
  {
    id: 'statistical-analysis',
    name: 'Statistical Analysis',
    description: 'E2B-powered statistical analysis with Python',
    category: 'analytics',
    schema: statisticalAnalysisSchema,
    workflowType: 'statisticalAnalysisWorkflow',
    icon: '🧮',
    estimatedDuration: '3-8 min',
  },
  {
    id: 'cross-community',
    name: 'Cross-Community Analysis',
    description: 'Identify systemic patterns across multiple communities',
    category: 'analytics',
    schema: crossCommunityAnalysisSchema,
    workflowType: 'crossCommunityAnalysisWorkflow',
    icon: '🔗',
    estimatedDuration: '5-12 min',
  },
];

// Helper to get workflow by ID
export function getWorkflowById(id: string): WorkflowMetadata | undefined {
  return workflows.find((w) => w.id === id);
}

// Helper to get workflows by category
export function getWorkflowsByCategory(category: WorkflowMetadata['category']): WorkflowMetadata[] {
  return workflows.filter((w) => w.category === category);
}
