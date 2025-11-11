/**
 * Statistical Analysis Activities with E2B Code Execution
 *
 * Enables ad-hoc statistical analysis on rotation data using GPT-5 + E2B.
 * The model generates Python code, executes it on large datasets, and analyzes results.
 *
 * Use cases:
 * - Correlation analysis across 1000s of securities
 * - Custom metrics calculation
 * - Statistical tests (t-tests, chi-square, regressions)
 * - Anomaly detection with ML models
 */

import { createClient, createCodeSession } from '@libs/openai-client';
import { createSupabaseClient } from '../lib/supabase.js';

export interface StatisticalAnalysisInput {
  analysisType: 'correlation' | 'regression' | 'anomaly' | 'custom';
  dataQuery: {
    table: 'rotation_events' | 'rotation_edges' | 'graph_edges';
    filters?: Record<string, any>;
    periodStart?: string;
    periodEnd?: string;
    limit?: number;
  };
  question: string;
  customCode?: string; // Optional: User provides their own Python code
}

export interface StatisticalAnalysisResult {
  sessionId: string;
  analysis: {
    planningPhase: string;
    codeGenerated: string;
    executionOutput: string;
    interpretation: string;
    conclusions: string;
  };
  data: {
    rowsAnalyzed: number;
    computationTime: number;
  };
  tokensUsed: {
    input: number;
    output: number;
    reasoning: number;
  };
}

/**
 * Perform statistical analysis on rotation data using E2B code execution.
 *
 * This function demonstrates the full power of GPT-5 + E2B:
 * 1. Model plans the statistical approach (CoT)
 * 2. Generates Python code for analysis
 * 3. Executes code on actual data in E2B sandbox
 * 4. Analyzes results (CoT preserved from planning)
 * 5. Draws conclusions (CoT preserved from all steps)
 */
export async function performStatisticalAnalysis(
  input: StatisticalAnalysisInput
): Promise<StatisticalAnalysisResult> {
  const supabase = createSupabaseClient();

  // Fetch data based on query
  let query = supabase.from(input.dataQuery.table).select('*');

  if (input.dataQuery.filters) {
    Object.entries(input.dataQuery.filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }

  if (input.dataQuery.periodStart) {
    query = query.gte('created_at', input.dataQuery.periodStart);
  }

  if (input.dataQuery.periodEnd) {
    query = query.lte('created_at', input.dataQuery.periodEnd);
  }

  const limit = input.dataQuery.limit ?? 10000;
  query = query.limit(limit);

  const { data, error } = await query;

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('No data found for analysis');
  }

  // Create code session with E2B enabled
  const client = createClient({ model: 'gpt-5' });
  const session = createCodeSession({
    client,
    systemPrompt: `You are a quantitative analyst and Python expert.
Your job is to perform statistical analysis on institutional rotation data.

**Available Libraries:**
- pandas (data manipulation)
- numpy (numerical operations)
- scipy.stats (statistical tests)
- sklearn (machine learning, if needed)
- matplotlib (visualization - results returned as text descriptions)

**Your Approach:**
1. Plan the statistical analysis methodology
2. Generate clean, well-documented Python code
3. Execute code on the data
4. Interpret results with statistical rigor
5. Draw actionable conclusions

Be thorough, quantitative, and cite specific statistical metrics.`,
    enableE2B: true,
  });

  const startTime = Date.now();

  // Turn 1: Plan the analysis
  const planningPhase = await session.respond(`
I need to perform ${input.analysisType} analysis on institutional rotation data.

**Question:** ${input.question}

**Dataset:**
- Table: ${input.dataQuery.table}
- Rows: ${data.length}
- Sample data (first 5 rows):
${JSON.stringify(data.slice(0, 5), null, 2)}

**Your task:**
1. What statistical approach should we use?
2. What are the key metrics to calculate?
3. What tests should we run to validate findings?
4. Outline the analysis plan.
  `);

  // Turn 2: Generate and execute code (CoT preserved)
  let codeGenerated = '';
  let executionOutput = '';
  let interpretation = '';

  if (input.customCode) {
    // User provided custom code
    const { code, executionResult, analysis } = await session.executeAndAnalyze(
      `Execute this user-provided Python code on the dataset:\n\n${input.customCode}\n\nDataset:\n${JSON.stringify(data)}`,
      'Interpret the results of this code execution in the context of rotation analysis.'
    );

    codeGenerated = code;
    executionOutput = executionResult;
    interpretation = analysis;
  } else {
    // Model generates code based on analysis plan
    const { code, executionResult, analysis } = await session.executeAndAnalyze(
      `Based on your analysis plan, generate Python code to perform the statistical analysis.

Dataset (as JSON):
${JSON.stringify(data)}

Your code should:
1. Load the data
2. Perform the statistical analysis
3. Calculate key metrics
4. Run statistical tests if applicable
5. Print results in a clear format

Output should be printed to stdout.`,
      'Interpret these statistical results in the context of institutional rotation patterns.'
    );

    codeGenerated = code;
    executionOutput = executionResult;
    interpretation = analysis;
  }

  // Turn 3: Draw conclusions (CoT preserved from all previous turns)
  const conclusions = await session.respond(`
Based on our complete analysis:
1. The statistical approach we planned
2. The code we executed
3. The results we obtained

**Provide final conclusions:**
1. Key findings (3-5 bullet points with statistical evidence)
2. Confidence level in findings (low/medium/high)
3. Limitations of the analysis
4. Recommendations for traders/analysts

Be specific and quantitative.
  `);

  const computationTime = Date.now() - startTime;
  const summary = session.getSummary();

  return {
    sessionId: summary.sessionId,
    analysis: {
      planningPhase,
      codeGenerated,
      executionOutput,
      interpretation,
      conclusions,
    },
    data: {
      rowsAnalyzed: data.length,
      computationTime,
    },
    tokensUsed: summary.totalTokens,
  };
}

/**
 * Quick correlation analysis between two variables.
 *
 * Example: "Is there correlation between dump Z-score and CAR?"
 */
export async function analyzeCorrelation(input: {
  variable1: string;
  variable2: string;
  periodStart: string;
  periodEnd: string;
}): Promise<string> {
  const result = await performStatisticalAnalysis({
    analysisType: 'correlation',
    dataQuery: {
      table: 'rotation_events',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      limit: 5000,
    },
    question: `What is the correlation between ${input.variable1} and ${input.variable2}? Is it statistically significant?`,
  });

  return result.analysis.conclusions;
}

/**
 * Anomaly detection across rotation events.
 *
 * Identifies outliers and unusual patterns using statistical methods.
 */
export async function detectAnomalies(input: {
  periodStart: string;
  periodEnd: string;
  metric: string;
  threshold?: number;
}): Promise<StatisticalAnalysisResult> {
  return performStatisticalAnalysis({
    analysisType: 'anomaly',
    dataQuery: {
      table: 'rotation_events',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      limit: 10000,
    },
    question: `Detect anomalies in ${input.metric}. Use statistical methods (z-score, IQR, isolation forest). Threshold: ${input.threshold ?? 'auto-detect'}.`,
  });
}
