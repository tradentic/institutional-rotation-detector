/**
 * @deprecated This file contains legacy vector store RAG functions.
 *
 * The system has pivoted to GraphRAG + Long Context approach:
 * - Use graph algorithms (Louvain, PageRank) for structure
 * - Use long context windows (128K+) for synthesis
 * - No semantic pre-filtering needed
 *
 * These functions will be removed in a future release.
 * Use graphQueryWorkflow + longcontext.activities instead.
 */

import { OpenAI } from 'openai';
import { createSupabaseClient } from '../lib/supabase.js';

export interface ExplainEdgeInput {
  edgeId: string;
}

let openAIFactory = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function setOpenAIFactory(factory: () => OpenAI) {
  openAIFactory = factory;
}

/**
 * @deprecated Not used. Embeddings are no longer generated.
 * Will be removed in future release.
 */
export async function ingestFilingChunk(
  accession: string,
  chunkNo: number,
  content: string,
  embedding: number[]
) {
  console.warn('DEPRECATED: ingestFilingChunk is not used. System uses long context synthesis without embeddings.');
  const supabase = createSupabaseClient();
  await supabase.from('filing_chunks').upsert(
    {
      accession,
      chunk_no: chunkNo,
      content,
      embedding,
    },
    { onConflict: 'accession,chunk_no' }
  );
}

/**
 * @deprecated Uses dummy embedding (not real semantic search).
 * Use graphQueryWorkflow + longcontext.activities instead.
 * Will be removed in future release.
 */
export async function explainEdge({ edgeId }: ExplainEdgeInput) {
  console.warn('DEPRECATED: explainEdge uses dummy embedding. Use graphQueryWorkflow instead.');
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('rotation_edges')
    .select('cluster_id,cusip')
    .eq('cluster_id', edgeId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Edge not found');

  const { data: chunks } = await supabase
    .rpc('match_filing_chunks', {
      query_embedding: new Array(1536).fill(0),
      match_count: 5,
    })
    .order('chunk_no');

  const openai = openAIFactory();
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: 'You explain institutional rotation edges concisely.',
      },
      {
        role: 'user',
        content: `Edge ${edgeId} for cusip ${data.cusip}. Context: ${
          chunks?.map((c: any) => c.content).join('\n') ?? 'none'
        }`,
      },
    ],
    max_output_tokens: 400,
  });

  return response.output_text;
}
