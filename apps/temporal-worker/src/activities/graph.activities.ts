import { createSupabaseClient } from '../lib/supabase.ts';
import {
  GraphBuilder,
  type GraphBuilderResult,
  type GraphBuildSource,
  type GraphNodeInput,
  type GraphStore,
} from '../lib/graph.ts';

export interface GraphBuildActivityInput {
  quarterStart: string;
  quarterEnd: string;
  cik: string;
  ticker?: string;
  cursor?: string;
}

interface SupabaseGraphStore extends GraphStore {
  loadSource(input: GraphBuildActivityInput): Promise<GraphBuildSource>;
}

function createSupabaseGraphStore(): SupabaseGraphStore {
  const supabase = createSupabaseClient();
  return {
    async ensureNode(input: GraphNodeInput): Promise<string> {
      const { data: binding, error: bindingError } = await supabase
        .from('node_bindings')
        .select('node_id')
        .eq('kind', input.kind)
        .eq('key_txt', input.key)
        .maybeSingle();
      if (bindingError) throw bindingError;
      if (binding?.node_id) {
        return binding.node_id;
      }
      const insert = await supabase
        .from('graph_nodes')
        .upsert(
          {
            kind: input.kind,
            key_txt: input.key,
            name: input.name ?? null,
            meta: input.meta ?? {},
          },
          { onConflict: 'kind,key_txt' }
        )
        .select('node_id')
        .maybeSingle();
      if (insert.error) throw insert.error;
      let nodeId = insert.data?.node_id;
      if (!nodeId) {
        const lookup = await supabase
          .from('graph_nodes')
          .select('node_id')
          .eq('kind', input.kind)
          .eq('key_txt', input.key)
          .maybeSingle();
        if (lookup.error) throw lookup.error;
        nodeId = lookup.data?.node_id ?? undefined;
      }
      if (!nodeId) throw new Error('Failed to upsert node');
      const bindingInsert = await supabase.from('node_bindings').upsert({
        kind: input.kind,
        key_txt: input.key,
        node_id: nodeId,
      });
      if (bindingInsert.error) throw bindingInsert.error;
      return nodeId;
    },
    async upsertEdge(edge) {
      const result = await supabase
        .from('graph_edges')
        .upsert(
          {
            src: edge.src,
            dst: edge.dst,
            relation: edge.relation,
            asof: edge.asof,
            weight: edge.weight,
            attrs: edge.attrs ?? {},
          },
          { onConflict: 'src,dst,relation,asof' }
        )
        .select('edge_id')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data?.edge_id) throw new Error('Failed to upsert edge');
      return result.data.edge_id;
    },
    async loadSource(input) {
      const [positions, entities, cusipIssuers, filings, boSnapshots, uhfPositions] = await Promise.all([
        supabase
          .from('positions_13f')
          .select('entity_id,cusip,asof,shares,opt_put_shares,opt_call_shares,accession')
          .gte('asof', input.quarterStart)
          .lte('asof', input.quarterEnd),
        supabase.from('entities').select('entity_id,cik,name,kind'),
        supabase.from('cusip_issuer_map').select('cusip,issuer_cik'),
        supabase
          .from('filings')
          .select(
            'accession,cik,form,filed_date,period_end,event_date,cadence,expected_publish_at,published_at,is_amendment,amendment_of_accession'
          )
          .gte('filed_date', input.quarterStart)
          .lte('filed_date', input.quarterEnd),
        supabase
          .from('bo_snapshots')
          .select('issuer_cik,holder_cik,event_date,filed_date,pct_of_class,shares_est,accession')
          .gte('event_date', input.quarterStart)
          .lte('event_date', input.quarterEnd),
        supabase
          .from('uhf_positions')
          .select('holder_id,cusip,asof,shares,source')
          .gte('asof', input.quarterStart)
          .lte('asof', input.quarterEnd),
      ]);
      if (positions.error) throw positions.error;
      if (entities.error) throw entities.error;
      if (cusipIssuers.error) throw cusipIssuers.error;
      if (filings.error) throw filings.error;
      if (boSnapshots.error) throw boSnapshots.error;
      if (uhfPositions.error) throw uhfPositions.error;
      return {
        positions: positions.data ?? [],
        entities: entities.data ?? [],
        cusipIssuers: cusipIssuers.data ?? [],
        filings: filings.data ?? [],
        boSnapshots: boSnapshots.data ?? [],
        uhfPositions: uhfPositions.data ?? [],
      } satisfies GraphBuildSource;
    },
  } satisfies SupabaseGraphStore;
}

export async function buildGraphForQuarter(input: GraphBuildActivityInput): Promise<GraphBuilderResult> {
  const store = createSupabaseGraphStore();
  const builder = new GraphBuilder(store);
  const source = await store.loadSource(input);
  return builder.build(source);
}

export interface ResolveIssuerNodeInput {
  ticker?: string;
  cik?: string;
}

export interface ResolveIssuerNodeResult {
  nodeId: string;
  cik: string;
  ticker?: string;
  name?: string;
}

export async function resolveIssuerNode(input: ResolveIssuerNodeInput): Promise<ResolveIssuerNodeResult> {
  const supabase = createSupabaseClient();
  let cik = input.cik ?? null;
  if (!cik && input.ticker) {
    const { data, error } = await supabase
      .from('entities')
      .select('cik,name')
      .eq('kind', 'issuer')
      .ilike('name', `%${input.ticker}%`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    cik = data?.cik ?? null;
  }
  if (!cik) {
    throw new Error('Unable to resolve issuer CIK');
  }
  const nodeStore = createSupabaseGraphStore();
  const nodeId = await nodeStore.ensureNode({ kind: 'issuer', key: cik });
  return { nodeId, cik, ticker: input.ticker };
}
