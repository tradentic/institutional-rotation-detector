import { createHash, randomUUID } from 'crypto';
import { createSupabaseClient } from '../lib/supabase.ts';
import { createOpenAIClient, runResponses } from '../lib/openai.ts';
import { louvainLikeCommunities, topNodes } from '../lib/pagerank_louvain.ts';

export interface ComputeCommunitiesInput {
  periodStart: string;
  periodEnd: string;
  rootNodeId?: string;
}

export interface ComputeCommunitiesResult {
  communityIds: string[];
}

export async function computeCommunities(input: ComputeCommunitiesInput): Promise<ComputeCommunitiesResult> {
  const supabase = createSupabaseClient();
  const { data: edgesData, error: edgesError } = await supabase
    .from('graph_edges')
    .select('edge_id,src,dst,weight,asof,relation')
    .gte('asof', input.periodStart)
    .lte('asof', input.periodEnd);
  if (edgesError) throw edgesError;
  if (!edgesData || edgesData.length === 0) {
    return { communityIds: [] };
  }
  const nodeIds = new Set<string>();
  for (const edge of edgesData) {
    nodeIds.add(edge.src);
    nodeIds.add(edge.dst);
  }
  const communities = louvainLikeCommunities([...nodeIds], edgesData.map((edge) => ({
    src: edge.src,
    dst: edge.dst,
    weight: Number(edge.weight ?? 0) || 0,
  })));
  const created: string[] = [];
  for (const community of communities) {
    const summary = `Community with top nodes ${topNodes(community).join(', ') || 'n/a'} during ${input.periodStart} to ${input.periodEnd}.`;
    const hash = createHash('sha1')
      .update(`${input.periodStart}-${input.periodEnd}-${community.nodes.join('|')}`)
      .digest('hex');
    const existing = await supabase
      .from('graph_communities')
      .select('community_id')
      .eq('period_start', input.periodStart)
      .eq('period_end', input.periodEnd)
      .eq('method', 'louvain')
      .contains('meta', { hash })
      .maybeSingle();
    if (existing.error && existing.error.code !== 'PGRST116') {
      throw existing.error;
    }
    const communityId = existing.data?.community_id ?? randomUUID();
    const payload = {
      community_id: communityId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      method: 'louvain',
      summary,
      meta: {
        nodes: community.nodes,
        edge_count: community.edges.length,
        root_node: input.rootNodeId,
        score: community.score,
        hash,
      },
    } as const;
    const upsert = await supabase
      .from('graph_communities')
      .upsert(payload, { onConflict: 'community_id' })
      .select('community_id')
      .maybeSingle();
    if (upsert.error) throw upsert.error;
    if (upsert.data?.community_id) {
      created.push(upsert.data.community_id);
    }
  }
  return { communityIds: created };
}

export interface SummarizeCommunityInput {
  communityId: string;
  enableCodeExecution?: boolean; // Enable e2b code execution tool
}

export async function summarizeCommunity(input: SummarizeCommunityInput): Promise<string> {
  const supabase = createSupabaseClient();
  const { data: community, error } = await supabase
    .from('graph_communities')
    .select('community_id,summary,meta,period_start,period_end')
    .eq('community_id', input.communityId)
    .maybeSingle();
  if (error) throw error;
  if (!community) throw new Error('Community not found');

  const nodeList = (community.meta?.nodes as string[] | undefined) ?? [];
  const { data: edges, error: edgesError } = await supabase
    .from('graph_edges')
    .select('edge_id,relation,attrs,src,dst,weight')
    .gte('asof', community.period_start)
    .lte('asof', community.period_end)
    .in('src', nodeList)
    .in('dst', nodeList);
  if (edgesError) throw edgesError;

  const facts = edges
    ?.slice(0, 25)
    .map((edge) => ({
      relation: edge.relation,
      weight: edge.weight,
      attrs: edge.attrs,
      edgeId: edge.edge_id,
    })) ?? [];

  const prompt = `You are summarising an investor flow community from ${community.period_start} to ${community.period_end}.
Nodes: ${nodeList.join(', ')}
Key relations: ${facts
    .map((fact) => `${fact.relation} weight=${fact.weight}`)
    .join('; ')}
Write two paragraphs highlighting the drivers. Cite accessions if present.`;

  const client = createOpenAIClient();
  const text = await runResponses({
    client,
    input: {
      model: 'gpt-4.1',
      input: [
        {
          role: 'system',
          content: 'You are summarizing investor flow communities. You can use code execution for calculations or data analysis when needed.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      enableCodeExecution: input.enableCodeExecution ?? false,
      maxToolRounds: 5,
    },
  });
  const update = await supabase
    .from('graph_communities')
    .update({ summary: text || community.summary })
    .eq('community_id', input.communityId);
  if (update.error) throw update.error;
  return text || community.summary;
}

export interface KHopInput {
  rootNodeId: string;
  hops: number;
  periodStart: string;
  periodEnd: string;
}

export interface PathEdge {
  edgeId: string;
  src: string;
  dst: string;
  relation: string;
  weight: number;
  attrs: Record<string, unknown> | null;
}

export interface NeighborhoodResult {
  nodes: string[];
  edges: PathEdge[];
  paths: { score: number; nodeIds: string[]; edgeIds: string[] }[];
}

export async function kHopNeighborhood(input: KHopInput): Promise<NeighborhoodResult> {
  const supabase = createSupabaseClient();
  const { data: edges, error } = await supabase
    .from('graph_edges')
    .select('edge_id,src,dst,relation,weight,attrs,asof')
    .gte('asof', input.periodStart)
    .lte('asof', input.periodEnd);
  if (error) throw error;
  const relevantEdges = (edges ?? []).filter((edge) => edge.weight && edge.weight > 0);
  const nodes = new Set<string>([input.rootNodeId]);
  const adjacency = new Map<string, PathEdge[]>();
  for (const edge of relevantEdges) {
    const pathEdge: PathEdge = {
      edgeId: edge.edge_id,
      src: edge.src,
      dst: edge.dst,
      relation: edge.relation,
      weight: Number(edge.weight ?? 0),
      attrs: edge.attrs ?? null,
    };
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
    adjacency.get(edge.src)!.push(pathEdge);
  }
  const queue: [string, number, string[]][] = [[input.rootNodeId, 0, []]];
  const visited = new Set<string>([input.rootNodeId]);
  const paths: NeighborhoodResult['paths'] = [];
  while (queue.length) {
    const [node, depth, edgeTrail] = queue.shift()!;
    if (depth >= input.hops) continue;
    const nextEdges = adjacency.get(node) ?? [];
    for (const edge of nextEdges.sort((a, b) => b.weight - a.weight || a.edgeId.localeCompare(b.edgeId))) {
      nodes.add(edge.dst);
      const nextDepth = depth + 1;
      const trail = [...edgeTrail, edge.edgeId];
      paths.push({
        score: edge.weight / (nextDepth || 1),
        nodeIds: [...new Set([...edgeTrail.map((id) => relevantEdges.find((e) => e.edge_id === id)?.dst ?? ''), edge.dst].filter(Boolean))],
        edgeIds: trail,
      });
      if (!visited.has(edge.dst)) {
        visited.add(edge.dst);
        queue.push([edge.dst, nextDepth, trail]);
      }
    }
  }
  return {
    nodes: [...nodes],
    edges: relevantEdges.map((edge) => ({
      edgeId: edge.edge_id,
      src: edge.src,
      dst: edge.dst,
      relation: edge.relation,
      weight: Number(edge.weight ?? 0),
      attrs: edge.attrs ?? null,
    })),
    paths: paths.sort((a, b) => b.score - a.score).slice(0, 25),
  };
}
