import { createSupabaseClient } from '../lib/supabase.js';
import { createOpenAIClient } from '../lib/openai.js';
import { createSecClient } from '../lib/secClient.js';

/**
 * Chunk a filing into smaller pieces for embedding and retrieval.
 * Uses a sliding window approach with overlap for better context.
 */
export interface ChunkFilingInput {
  accession: string;
  chunkSize?: number; // Characters per chunk
  overlap?: number; // Character overlap between chunks
}

export interface ChunkFilingResult {
  accession: string;
  chunksCreated: number;
  embeddingsGenerated: number;
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
 * Generate embeddings for text chunks using OpenAI.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const openai = createOpenAIClient();

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text.slice(0, 8000), // Limit to ~8K chars for safety
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Chunk a filing and generate embeddings for semantic search.
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
  const filingText = await sec.fetchFilingText(filing.url);

  // Chunk the text
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = input.overlap ?? DEFAULT_OVERLAP;
  const chunks = chunkText(filingText, chunkSize, overlap);

  // Generate embeddings and store chunks
  let embeddingsGenerated = 0;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];

    // Generate embedding
    const embedding = await generateEmbedding(content);
    embeddingsGenerated++;

    // Store chunk with embedding
    const { error: upsertError } = await supabase
      .from('filing_chunks')
      .upsert(
        {
          accession: input.accession,
          chunk_no: i,
          content,
          embedding,
        },
        { onConflict: 'accession,chunk_no' }
      );

    if (upsertError) throw upsertError;
  }

  return {
    accession: input.accession,
    chunksCreated: chunks.length,
    embeddingsGenerated,
  };
}

/**
 * Create a cluster summary node for explainability and retrieval.
 * This generates a narrative summary of a rotation cluster and stores it
 * as a graph node with embeddings for semantic search.
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

  // Generate narrative summary
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

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
  });

  const summary = response.choices[0]?.message?.content ?? 'No summary generated.';

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

  // Generate embedding for the summary
  const embedding = await generateEmbedding(summary);

  // Store summary with embedding
  const { error: summaryError } = await supabase.from('cluster_summaries').upsert(
    {
      cluster_id: input.clusterId,
      summary,
      embedding,
    },
    { onConflict: 'cluster_id' }
  );

  if (summaryError) {
    // Table might not exist yet - this is optional
    console.warn('Could not store cluster summary:', summaryError);
  }

  return {
    clusterId: input.clusterId,
    nodeId,
    summary,
  };
}
