import { OpenAI } from 'openai';
import { createSupabaseClient } from '../lib/supabase.js';

export interface ExplainEdgeInput {
  edgeId: string;
}

let openAIFactory = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function setOpenAIFactory(factory: () => OpenAI) {
  openAIFactory = factory;
}

export async function ingestFilingChunk(
  accession: string,
  chunkNo: number,
  content: string,
  embedding: number[]
) {
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

export async function explainEdge({ edgeId }: ExplainEdgeInput) {
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
