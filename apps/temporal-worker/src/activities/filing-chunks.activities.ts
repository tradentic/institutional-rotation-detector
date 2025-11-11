import { createSupabaseClient } from '../lib/supabase.ts';
import { createOpenAIClient } from '../lib/openai.ts';
import { createSecClient } from '../lib/secClient.ts';

/**
 * Chunk a filing into smaller pieces for long context synthesis.
 * Uses a sliding window approach with overlap for better context.
 *
 * Note: This does NOT generate embeddings. The system uses long context
 * windows (128K+) instead of semantic search.
 */
export interface ChunkFilingInput {
  accession: string;
  chunkSize?: number; // Characters per chunk
  overlap?: number; // Character overlap between chunks
}

export interface ChunkFilingResult {
  accession: string;
  chunksCreated: number;
}

const DEFAULT_CHUNK_SIZE = 2000; // ~500 tokens
const DEFAULT_OVERLAP = 200; // 10% overlap

/**
 * Split text into overlapping chunks.
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));

    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Chunk a filing for long context synthesis (no embeddings).
 */
export async function chunkFiling(input: ChunkFilingInput): Promise<ChunkFilingResult> {
  const supabase = createSupabaseClient();
  const sec = createSecClient();

  // Get filing metadata
  const { data: filing, error: filingError } = await supabase
    .from('filings')
    .select('accession, url, cik, form')
    .eq('accession', input.accession)
    .maybeSingle();

  if (filingError) throw filingError;
  if (!filing) throw new Error(`Filing not found: ${input.accession}`);

  // Fetch filing text from SEC
  const response = await sec.get(filing.url);
  const filingText = await response.text();

  // Chunk the text
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = input.overlap ?? DEFAULT_OVERLAP;
  const chunks = chunkText(filingText, chunkSize, overlap);

  // Store chunks (text only, no embeddings)
  for (let i = 0; i < chunks.length; i++) {
    const { error: upsertError } = await supabase
      .from('filing_chunks')
      .upsert(
        {
          accession: input.accession,
          chunk_no: i,
          content: chunks[i],
          // Note: embedding column still exists in DB but is not populated
        },
        { onConflict: 'accession,chunk_no' }
      );

    if (upsertError) throw upsertError;
  }

  return {
    accession: input.accession,
    chunksCreated: chunks.length,
  };
}

/**
 * Create a cluster summary for explainability.
 * Generates a narrative summary of a rotation cluster.
 *
 * Note: This does NOT generate embeddings. The system uses graph structure
 * and long context windows instead of semantic search.
 */
export interface CreateClusterSummaryInput {
  clusterId: string;
}

export interface CreateClusterSummaryResult {
  clusterId: string;
  nodeId: string;
  summary: string;
}

export async function createClusterSummary(
  input: CreateClusterSummaryInput
): Promise<CreateClusterSummaryResult> {
  const supabase = createSupabaseClient();

  // Fetch cluster data
  const { data: event, error: eventError } = await supabase
    .from('rotation_events')
    .select('*')
    .eq('cluster_id', input.clusterId)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!event) throw new Error(`Cluster not found: ${input.clusterId}`);

  // Fetch edges
  const { data: edges, error: edgesError } = await supabase
    .from('rotation_edges')
    .select('seller_id, buyer_id, cusip, equity_shares, options_shares')
    .eq('cluster_id', input.clusterId)
    .limit(20);

  if (edgesError) throw edgesError;

  // Fetch provenance
  const { data: provenance, error: provError } = await supabase
    .from('rotation_event_provenance')
    .select('accession, role, contribution_weight')
    .eq('cluster_id', input.clusterId);

  if (provError) throw provError;

  // Generate narrative summary using GPT-5
  const openai = createOpenAIClient();
  const prompt = `Summarize this institutional rotation cluster for an investor audience:

Cluster ID: ${input.clusterId}
Issuer CIK: ${event.issuer_cik}
R-Score: ${event.r_score}
CAR (−5 to +20): ${event.car_m5_p20}
Dump Z-Score: ${event.dumpz}
Short Relief: ${event.shortrelief_v2}
EOW Flag: ${event.eow}

Sellers: ${edges?.filter((e) => e.seller_id).length ?? 0}
Buyers: ${edges?.filter((e) => e.buyer_id).length ?? 0}
Total Shares: ${edges?.reduce((sum, e) => sum + (Number(e.equity_shares) || 0), 0) ?? 0}

Key filings: ${provenance
    ?.filter((p) => p.role === 'anchor' || p.role === 'seller')
    .map((p) => p.accession)
    .slice(0, 5)
    .join(', ') ?? 'none'}

Write 2-3 sentences explaining what happened and why it might be a rotation signal.`;

  // Use GPT-5 Responses API (gpt-5-mini for simple summarization)
  const { runResponse } = await import('../lib/openai.js');
  const summary = await runResponse({
    client: openai,
    model: 'gpt-5-mini',
    prompt,
    effort: 'minimal',
    verbosity: 'low',
    maxTokens: 300,
  });

  // Store as a graph node
  const nodeId = `cluster:${input.clusterId}`;

  const { error: nodeError } = await supabase.from('graph_nodes').upsert(
    {
      node_id: nodeId,
      kind: 'cluster_summary',
      meta: {
        cluster_id: input.clusterId,
        issuer_cik: event.issuer_cik,
        r_score: event.r_score,
        summary,
      },
    },
    { onConflict: 'node_id' }
  );

  if (nodeError) throw nodeError;

  return {
    clusterId: input.clusterId,
    nodeId,
    summary,
  };
}
