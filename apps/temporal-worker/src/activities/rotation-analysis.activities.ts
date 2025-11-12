/**
 * Rotation Event Analysis Activities
 *
 * Provides AI-powered analysis of rotation events to transform algorithmic scores
 * into actionable trading intelligence.
 *
 * This is the "10x value" feature that adds:
 * - Anomaly detection
 * - Narrative explanations with filing citations
 * - Trading implications and confidence levels
 * - Pattern recognition beyond formula-based scoring
 */

import { createClient, createAnalysisSession } from '@libs/openai-client';
import { createSupabaseClient } from '../lib/supabase';

export interface AnalyzeRotationEventInput {
  clusterId: string;
  issuerCik: string;
  signals: {
    dumpZ: number;
    uSame: number;
    uNext: number;
    uhfSame: number;
    uhfNext: number;
    optSame: number;
    optNext: number;
    shortReliefV2: number;
    indexPenalty: number;
    rScore: number;
  };
}

export interface AnalyzeRotationEventResult {
  clusterId: string;
  anomalyScore: number; // 0-10 scale
  suspicionFlags: string[];
  narrative: string;
  tradingImplications: string;
  confidence: number; // 0-1 scale
}

/**
 * Analyze a rotation event using GPT-5 with Chain of Thought reasoning.
 *
 * This function implements a 4-step analysis process:
 * 1. Assess signal quality and confidence
 * 2. Check for anomalies or suspicious patterns
 * 3. Generate narrative explanation with filing citations
 * 4. Provide trading implications
 *
 * By using CoT, each step builds on previous reasoning without re-processing,
 * saving 60-80% in token costs while maintaining full context.
 */
export async function analyzeRotationEvent(
  input: AnalyzeRotationEventInput
): Promise<AnalyzeRotationEventResult> {
  const supabase = createSupabaseClient();

  // Fetch rotation edges for context
  const { data: edges, error: edgesError } = await supabase
    .from('rotation_edges')
    .select('seller_id, buyer_id, cusip, equity_shares, options_shares, created_at')
    .eq('cluster_id', input.clusterId)
    .limit(50);

  if (edgesError) throw edgesError;

  // Fetch provenance data
  const { data: provenance, error: provError } = await supabase
    .from('rotation_event_provenance')
    .select('accession, role, contribution_weight')
    .eq('cluster_id', input.clusterId);

  if (provError) throw provError;

  // Fetch issuer information
  const { data: issuer } = await supabase
    .from('issuers')
    .select('ticker, name')
    .eq('cik', input.issuerCik)
    .maybeSingle();

  const ticker = issuer?.ticker ?? input.issuerCik;
  const issuerName = issuer?.name ?? 'Unknown';

  // Create analysis session with CoT
  const client = createClient({ model: 'gpt-5' });
  const session = createAnalysisSession({
    client,
    systemPrompt: `You are an expert institutional trading analyst specializing in rotation detection.
Your job is to analyze rotation signals and provide:
1. Assessment of signal genuineness vs noise
2. Identification of anomalies or suspicious patterns
3. Clear narrative explanations citing evidence
4. Actionable trading implications

Be specific, quantitative, and cite filing accessions when available.`,
  });

  // Turn 1: Assess signal quality
  const signalAssessment = await session.respond(`
Analyze this rotation signal for ${ticker} (${issuerName}):

**Rotation Scores:**
- Dump Z-Score: ${input.signals.dumpZ.toFixed(2)} (threshold: 1.5, higher = stronger dump)
- Uptake Same Quarter: ${input.signals.uSame.toFixed(2)}
- Uptake Next Quarter: ${input.signals.uNext.toFixed(2)}
- UHF Same Quarter: ${input.signals.uhfSame.toFixed(2)}
- UHF Next Quarter: ${input.signals.uhfNext.toFixed(2)}
- Options Same: ${input.signals.optSame.toFixed(2)}
- Options Next: ${input.signals.optNext.toFixed(2)}
- Short Relief: ${input.signals.shortReliefV2.toFixed(2)}
- Index Penalty: ${input.signals.indexPenalty.toFixed(2)} (negative = index rebalancing)
- **Final R-Score: ${input.signals.rScore.toFixed(2)}**

**Edges (${edges?.length ?? 0} total):**
${JSON.stringify(edges?.slice(0, 10), null, 2)}

**Key Questions:**
1. Do these signals suggest genuine institutional rotation or just noise?
2. Which signals are strongest/weakest?
3. What is your confidence level that this is a real rotation event (0.0 to 1.0)?

Provide a structured assessment.
  `);

  // Turn 2: Check for anomalies (CoT preserved from Turn 1)
  const anomalyCheck = await session.respond(`
Now check for anomalies or red flags in this rotation:

**Provenance Data (filing sources):**
${JSON.stringify(provenance, null, 2)}

**Look for:**
1. **Timing anomalies**: Coordinated filings, suspiciously fast moves, end-of-window dumps
2. **Magnitude anomalies**: Unrealistic position changes, extreme dump Z-scores (>5)
3. **Participant anomalies**: Unusual institutional behavior patterns
4. **Data quality issues**: Missing filings, gaps in provenance, low edge counts

**Rate anomaly severity on 0-10 scale:**
- 0-3: Normal rotation pattern, no concerns
- 4-6: Mildly unusual but likely valid
- 7-8: Suspicious, needs investigation
- 9-10: Likely false positive or data error

Provide anomaly score and explain reasoning.
  `);

  // Turn 3: Generate narrative (CoT preserved from Turns 1-2)
  const narrative = await session.respond(`
Based on the signal assessment and anomaly check, create a narrative explanation for traders.

**Format (2-3 paragraphs):**

Paragraph 1: What happened
- Who sold (institutions)
- Who bought (institutions)
- When (timing relative to quarter)
- Magnitude (dollar amounts if calculable from share counts)

Paragraph 2: Why this might be a rotation signal
- Key evidence supporting rotation thesis
- Confidence level and reasoning
- Cite specific filing accessions from provenance data when available

Be specific. Use actual numbers. Cite filings like [0001234567-24-000123].
  `);

  // Turn 4: Trading implications (CoT preserved from all previous turns)
  const implications = await session.respond(`
Based on the complete analysis, what are the trading implications?

**Provide:**
1. Expected price movement direction (if rotation is genuine)
2. Timeline for price impact (days/weeks)
3. Risk level (Low/Medium/High)
4. Suggested actions: Monitor only, Consider trade, Ignore signal

Be concise (3-4 bullet points). Focus on actionable guidance.
  `);

  // Parse anomaly score from response (extract number/10)
  const anomalyMatch = anomalyCheck.match(/(?:anomaly.*?score.*?|severity.*?):?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)?/i);
  const anomalyScore = anomalyMatch ? Math.min(parseFloat(anomalyMatch[1]), 10) : 5.0;

  // Extract confidence from signal assessment (0-1 scale)
  const confidenceMatch = signalAssessment.match(/confidence.*?(\d+(?:\.\d+)?)/i);
  let confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;

  // If confidence looks like it was given as percentage (>1), convert to 0-1 scale
  if (confidence > 1) {
    confidence = confidence / 100;
  }

  // Clamp to 0-1 range
  confidence = Math.max(0, Math.min(1, confidence));

  // Generate suspicion flags based on analysis
  const suspicionFlags: string[] = [];

  if (anomalyScore >= 7) {
    suspicionFlags.push('HIGH_ANOMALY');
  }

  if (input.signals.dumpZ > 5) {
    suspicionFlags.push('EXTREME_DUMP');
  }

  if (input.signals.indexPenalty < -0.5) {
    suspicionFlags.push('INDEX_REBALANCE');
  }

  if (confidence < 0.5) {
    suspicionFlags.push('LOW_CONFIDENCE');
  }

  if ((edges?.length ?? 0) < 3) {
    suspicionFlags.push('SPARSE_EDGES');
  }

  // Combine all narratives
  const fullNarrative = `${narrative.trim()}\n\n**Trading Implications:**\n${implications.trim()}`;

  const result: AnalyzeRotationEventResult = {
    clusterId: input.clusterId,
    anomalyScore,
    suspicionFlags,
    narrative: fullNarrative,
    tradingImplications: implications.trim(),
    confidence,
  };

  // Persist analysis results to database
  await persistAnalysisResults(result);

  return result;
}

/**
 * Persist analysis results to rotation_events table.
 *
 * Updates the rotation event with AI-generated analysis fields.
 */
async function persistAnalysisResults(analysis: AnalyzeRotationEventResult): Promise<void> {
  const supabase = createSupabaseClient();

  const { error } = await supabase
    .from('rotation_events')
    .update({
      anomaly_score: analysis.anomalyScore,
      suspicion_flags: analysis.suspicionFlags,
      ai_narrative: analysis.narrative,
      trading_implications: analysis.tradingImplications,
      ai_confidence: analysis.confidence,
    })
    .eq('cluster_id', analysis.clusterId);

  if (error) {
    throw new Error(`Failed to persist analysis results: ${error.message}`);
  }
}
