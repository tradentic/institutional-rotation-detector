/**
 * Deployment Tier Configuration
 *
 * Provides configuration-based deployment modes to optimize for different
 * use cases and budgets:
 * - MINIMAL: Core rotation signals only (~$150-300/mo)
 * - STANDARD: Production trading with validation (~$500-800/mo)
 * - ADVANCED: Full feature set for research (~$1,200-2,000/mo)
 *
 * See: docs/architecture/DEPLOYMENT_TIERS.md
 */

export enum DeploymentTier {
  MINIMAL = 'minimal',
  STANDARD = 'standard',
  ADVANCED = 'advanced',
}

export interface TierConfig {
  tier: DeploymentTier;
  enabledWorkflows: string[];
  optionsFlow: OptionsFlowConfig;
  microstructure: MicrostructureConfig;
  graphAnalysis: GraphAnalysisConfig;
  form4Tracking: Form4TrackingConfig;
  researchTools: ResearchToolsConfig;
}

export interface OptionsFlowConfig {
  enabled: boolean;
  tier?: 'minimal' | 'standard' | 'deep';
  endpoints?: string[];
  includeGreeks?: boolean;
  includeGEX?: boolean;
}

export interface MicrostructureConfig {
  enabled: boolean;
  includeVPIN?: boolean;
  includeKylesLambda?: boolean;
  includeOffexRatio?: boolean;
  includeFlip50?: boolean;
  includeShortInterest?: boolean;
}

export interface GraphAnalysisConfig {
  enabled: boolean;
  includeAdvanced?: boolean; // Cross-community, enrichment
}

export interface Form4TrackingConfig {
  enabled: boolean;
}

export interface ResearchToolsConfig {
  enabled: boolean;
  includeStatisticalAnalysis?: boolean;
}

/**
 * Create tier configuration based on deployment tier
 */
export function createTierConfig(tier: DeploymentTier): TierConfig {
  const baseWorkflows = [
    'ingestIssuer',
    'ingestQuarter',
    'rotationDetect',
    'eventStudy',
    'edgarSubmissionsPoller',
    'nportMonthlyTimer',
    'etfDailyCron',
  ];

  switch (tier) {
    case DeploymentTier.MINIMAL:
      return {
        tier,
        enabledWorkflows: baseWorkflows,
        optionsFlow: { enabled: false },
        microstructure: { enabled: false },
        graphAnalysis: { enabled: false },
        form4Tracking: { enabled: false },
        researchTools: { enabled: false },
      };

    case DeploymentTier.STANDARD:
      return {
        tier,
        enabledWorkflows: [
          ...baseWorkflows,
          'optionsIngest',
          'unusualOptionsActivityCron',
          'form4Ingest',
          'form4DailyCron',
          'graphBuild',
          'graphSummarize',
        ],
        optionsFlow: {
          enabled: true,
          tier: 'minimal',
          endpoints: ['contracts', 'flow', 'alerts'],
          includeGreeks: false,
          includeGEX: false,
        },
        microstructure: { enabled: false },
        graphAnalysis: {
          enabled: true,
          includeAdvanced: false,
        },
        form4Tracking: { enabled: true },
        researchTools: { enabled: false },
      };

    case DeploymentTier.ADVANCED:
      return {
        tier,
        enabledWorkflows: [
          ...baseWorkflows,
          // Options
          'optionsIngest',
          'unusualOptionsActivityCron',
          'optionsBatch',
          // Form 4
          'form4Ingest',
          'form4DailyCron',
          // Graph
          'graphBuild',
          'graphSummarize',
          'graphExplore',
          'crossCommunityAnalysis',
          'clusterEnrichment',
          // Microstructure
          'finraOtcWeeklyIngest',
          'iexDailyIngest',
          'offexRatioCompute',
          'flip50Detect',
          'shortInterestIngest',
          'microstructureAnalysis',
          // Research
          'statisticalAnalysis',
        ],
        optionsFlow: {
          enabled: true,
          tier: 'deep',
          endpoints: ['contracts', 'flow', 'alerts', 'greeks', 'gex'],
          includeGreeks: true,
          includeGEX: true,
        },
        microstructure: {
          enabled: true,
          includeVPIN: true,
          includeKylesLambda: true,
          includeOffexRatio: true,
          includeFlip50: true,
          includeShortInterest: true,
        },
        graphAnalysis: {
          enabled: true,
          includeAdvanced: true,
        },
        form4Tracking: { enabled: true },
        researchTools: {
          enabled: true,
          includeStatisticalAnalysis: true,
        },
      };
  }
}

/**
 * Load tier configuration from environment variables
 */
export function loadTierConfigFromEnv(): TierConfig {
  const tierStr = process.env.DEPLOYMENT_TIER || 'minimal';
  const tier = tierStr as DeploymentTier;

  if (!Object.values(DeploymentTier).includes(tier)) {
    throw new Error(
      `Invalid DEPLOYMENT_TIER: ${tierStr}. ` +
        `Must be one of: ${Object.values(DeploymentTier).join(', ')}`
    );
  }

  // Create base config from tier
  const config = createTierConfig(tier);

  // Allow environment variable overrides for individual features
  if (process.env.ENABLE_OPTIONS_FLOW !== undefined) {
    config.optionsFlow.enabled = process.env.ENABLE_OPTIONS_FLOW === 'true';
  }

  if (process.env.OPTIONS_TIER !== undefined) {
    const optionsTier = process.env.OPTIONS_TIER as 'minimal' | 'standard' | 'deep';
    if (['minimal', 'standard', 'deep'].includes(optionsTier)) {
      config.optionsFlow.tier = optionsTier;
    }
  }

  if (process.env.ENABLE_MICROSTRUCTURE !== undefined) {
    config.microstructure.enabled = process.env.ENABLE_MICROSTRUCTURE === 'true';
  }

  if (process.env.ENABLE_GRAPH_ANALYSIS !== undefined) {
    config.graphAnalysis.enabled = process.env.ENABLE_GRAPH_ANALYSIS === 'true';
  }

  if (process.env.ENABLE_FORM4_TRACKING !== undefined) {
    config.form4Tracking.enabled = process.env.ENABLE_FORM4_TRACKING === 'true';
  }

  if (process.env.ENABLE_RESEARCH_WORKFLOWS !== undefined) {
    config.researchTools.enabled = process.env.ENABLE_RESEARCH_WORKFLOWS === 'true';
  }

  return config;
}

/**
 * Check if a workflow is enabled in the current deployment tier
 */
export function isWorkflowEnabled(workflowName: string): boolean {
  const config = loadTierConfigFromEnv();
  return config.enabledWorkflows.includes(workflowName);
}

/**
 * Throw error if workflow is not enabled in current tier
 */
export function requireWorkflow(workflowName: string): void {
  if (!isWorkflowEnabled(workflowName)) {
    const config = loadTierConfigFromEnv();
    throw new Error(
      `Workflow '${workflowName}' is not enabled in ${config.tier} tier. ` +
        `Upgrade to a higher tier or enable manually via environment variables.`
    );
  }
}

/**
 * Get estimated monthly cost for a deployment tier
 */
export function getEstimatedMonthlyCost(tier: DeploymentTier): {
  min: number;
  max: number;
  components: { name: string; cost: number }[];
} {
  switch (tier) {
    case DeploymentTier.MINIMAL:
      return {
        min: 150,
        max: 300,
        components: [
          { name: 'SEC EDGAR API', cost: 0 },
          { name: 'Supabase', cost: 10 },
          { name: 'GPT-5 CoT (AI analysis)', cost: 6 },
          { name: 'Compute (worker)', cost: 140 },
        ],
      };

    case DeploymentTier.STANDARD:
      return {
        min: 500,
        max: 800,
        components: [
          { name: 'Minimal tier base', cost: 156 },
          { name: 'UnusualWhales API (Tier 1)', cost: 100 },
          { name: 'Form 4 ingestion', cost: 0 },
          { name: 'Graph compute', cost: 50 },
          { name: 'Increased DB usage', cost: 20 },
          { name: 'Additional workers', cost: 174 },
        ],
      };

    case DeploymentTier.ADVANCED:
      return {
        min: 1200,
        max: 2000,
        components: [
          { name: 'Standard tier base', cost: 500 },
          { name: 'UnusualWhales Tier 2/3', cost: 300 },
          { name: 'FINRA API', cost: 100 },
          { name: 'IEX API', cost: 150 },
          { name: 'Microstructure compute', cost: 200 },
          { name: 'Advanced graph', cost: 100 },
        ],
      };
  }
}

/**
 * Get feature availability for a deployment tier
 */
export function getFeatureAvailability(tier: DeploymentTier): Record<string, boolean> {
  const config = createTierConfig(tier);

  return {
    coreRotationDetection: true, // Always available
    aiPoweredAnalysis: true, // Always available
    eventStudyValidation: true, // Always available
    thirteenFIngestion: true, // Always available
    etfTracking: true, // Always available
    optionsFlowMinimal: config.optionsFlow.enabled && config.optionsFlow.tier === 'minimal',
    optionsFlowDeep: config.optionsFlow.enabled && config.optionsFlow.tier === 'deep',
    form4InsiderTracking: config.form4Tracking.enabled,
    graphAnalysisBasic: config.graphAnalysis.enabled && !config.graphAnalysis.includeAdvanced,
    graphAnalysisAdvanced: config.graphAnalysis.enabled && config.graphAnalysis.includeAdvanced,
    microstructureVPIN: config.microstructure.enabled,
    microstructureKylesLambda: config.microstructure.enabled,
    researchWorkflows: config.researchTools.enabled,
  };
}
