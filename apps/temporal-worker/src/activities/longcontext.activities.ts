import { randomUUID } from 'crypto';
import { createSupabaseClient } from '../lib/supabase.js';
import { createOpenAIClient, runResponses } from '../lib/openai.js';

export interface BundleForSynthesisInput {
  edgeIds: string[];
  question?: string;
  tokenBudget?: number;
}

export interface SynthesisBundle {
  edges: {
    edgeId: string;
    relation: string;
    weight: number;
    attrs: Record<string, unknown> | null;
  }[];
  filings: {
    accession: string;
    excerpts: string[];
  }[];
  question?: string;
}

export async function bundleForSynthesis(input: BundleForSynthesisInput): Promise<SynthesisBundle> {
  const supabase = createSupabaseClient();
  const tokenBudget = input.tokenBudget ?? 12000;
  const { data: edges, error } = await supabase
    .from('graph_edges')
    .select('edge_id,relation,weight,attrs')
    .in('edge_id', input.edgeIds);
  if (error) throw error;
  const bundleEdges = (edges ?? []).map((edge) => ({
    edgeId: edge.edge_id,
    relation: edge.relation,
    weight: Number(edge.weight ?? 0),
    attrs: edge.attrs ?? null,
  }));

  const accessionSet = new Set<string>();
  for (const edge of bundleEdges) {
    const attrs = edge.attrs ?? {};
    const accessions = Array.isArray((attrs as any).accessions)
      ? ((attrs as any).accessions as string[])
      : (attrs as any).accession
      ? [(attrs as any).accession as string]
      : [];
    for (const accession of accessions) {
      if (typeof accession === 'string' && accession.length > 0) {
        accessionSet.add(accession);
      }
    }
  }
  const accessionList = [...accessionSet];
  const { data: chunks, error: chunksError } = accessionList.length
    ? await supabase
        .from('filing_chunks')
        .select('accession,chunk_no,content')
        .in('accession', accessionList)
        .order('chunk_no', { ascending: true })
    : { data: [], error: null };
  if (chunksError) throw chunksError;
  const grouped = new Map<string, string[]>();
  for (const chunk of chunks ?? []) {
    const list = grouped.get(chunk.accession) ?? [];
    if (list.length < 20) {
      list.push(chunk.content);
    }
    grouped.set(chunk.accession, list);
  }
  const perFilingBudget = tokenBudget / Math.max(accessionList.length, 1);
  const filings = accessionList.map((accession) => ({
    accession,
    excerpts: (grouped.get(accession) ?? []).reduce<string[]>((acc, text) => {
      const tokens = text.split(/\s+/);
      let running = '';
      for (const token of tokens) {
        if ((running + ' ' + token).trim().length > perFilingBudget) {
          acc.push(running.trim());
          running = token;
        } else {
          running = running.length ? `${running} ${token}` : token;
        }
      }
      if (running.trim()) acc.push(running.trim());
      return acc;
    }, []),
  }));
  return { edges: bundleEdges, filings, question: input.question };
}

export interface SynthesizeInput {
  bundle: SynthesisBundle;
}

export interface SynthesizeResult {
  explanationId: string;
  content: string;
  accessions: string[];
}

export async function synthesizeWithOpenAI(input: SynthesizeInput): Promise<SynthesizeResult> {
  if (input.bundle.edges.length === 0) {
    return { explanationId: randomUUID(), content: 'No edges supplied for explanation.', accessions: [] };
  }
  const client = createOpenAIClient();
  const accessions = input.bundle.filings.map((f) => f.accession);
  const prompt = `You explain investor rotation edges using provided data.
Edges: ${input.bundle.edges
    .map((edge) => `${edge.edgeId} ${edge.relation} weight=${edge.weight}`)
    .join('; ')}
Accessions: ${accessions.join(', ')}
Question: ${input.bundle.question ?? 'Summarise notable flow relationships.'}
In 3 paragraphs max, answer and cite accession IDs inline.`;

  const content = await runResponses({
    client,
    input: {
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: 'Use only supplied facts. Provide accession citations like [ACC].',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...input.bundle.filings.flatMap((filing) =>
              filing.excerpts.slice(0, 5).map((excerpt) => ({
                type: 'text' as const,
                text: `[${filing.accession}] ${excerpt.slice(0, 500)}`,
              }))
            ),
          ],
        },
      ],
    },
  });

  const supabase = createSupabaseClient();
  const { error, data } = await supabase
    .from('graph_explanations')
    .insert({
      explanation_id: randomUUID(),
      question: input.bundle.question ?? null,
      edge_ids: input.bundle.edges.map((edge) => edge.edgeId),
      accessions,
      content,
    })
    .select('explanation_id')
    .maybeSingle();
  if (error) throw error;
  if (!data?.explanation_id) throw new Error('Failed to store explanation');
  return { explanationId: data.explanation_id, content, accessions };
}
