import { describe, expect, test } from 'vitest';
import { GraphBuilder } from '../lib/graph.ts';
import type { GraphBuildSource, GraphEdgeInput, GraphNodeInput, GraphStore } from '../lib/graph.ts';
import { louvainLikeCommunities } from '../lib/pagerank_louvain.ts';

class InMemoryGraphStore implements GraphStore {
  public nodes = new Map<string, { id: string; input: GraphNodeInput }>();
  public edges = new Map<string, { id: string; input: GraphEdgeInput }>();
  async ensureNode(input: GraphNodeInput): Promise<string> {
    const key = `${input.kind}:${input.key}`;
    const existing = this.nodes.get(key);
    if (existing) return existing.id;
    const id = `node-${this.nodes.size + 1}`;
    this.nodes.set(key, { id, input });
    return id;
  }
  async upsertEdge(edge: GraphEdgeInput): Promise<string> {
    const key = `${edge.src}:${edge.dst}:${edge.relation}:${edge.asof}`;
    const existing = this.edges.get(key);
    if (existing) {
      existing.input = edge;
      return existing.id;
    }
    const id = `edge-${this.edges.size + 1}`;
    this.edges.set(key, { id, input: edge });
    return id;
  }
}

describe('GraphBuilder', () => {
  const source: GraphBuildSource = {
    positions: [
      {
        entity_id: 'mgr-1',
        cusip: '123456789',
        asof: '2024-01-01',
        shares: 100,
        opt_put_shares: 0,
        opt_call_shares: 0,
        accession: 'A',
      },
      {
        entity_id: 'mgr-1',
        cusip: '123456789',
        asof: '2024-03-31',
        shares: 10,
        opt_put_shares: 20,
        opt_call_shares: 0,
        accession: 'B',
      },
    ],
    entities: [
      { entity_id: 'mgr-1', cik: '0000000001', name: 'Manager One', kind: 'manager' },
      { entity_id: 'issuer-1', cik: '0000000002', name: 'Issuer One', kind: 'issuer' },
    ],
    cusipIssuers: [{ cusip: '123456789', issuer_cik: '0000000002' }],
    filings: [
      {
        accession: 'A',
        cik: '0000000001',
        form: '13F-HR',
        filed_date: '2024-02-14',
        period_end: '2023-12-31',
        event_date: null,
      },
      {
        accession: 'B',
        cik: '0000000001',
        form: '13F-HR',
        filed_date: '2024-05-15',
        period_end: '2024-03-31',
        event_date: null,
      },
    ],
    boSnapshots: [],
    uhfPositions: [],
  };

  test('build is idempotent across runs', async () => {
    const store = new InMemoryGraphStore();
    const builder = new GraphBuilder(store);
    const first = await builder.build(source);
    expect(store.edges.size).toBe(4);
    expect(new Set(first.processedAccessions)).toEqual(new Set(['A', 'B']));
    const second = await builder.build(source);
    expect(store.edges.size).toBe(4);
    expect(second.processedAccessions.sort()).toEqual(['A', 'B']);
  });
});

describe('louvainLikeCommunities', () => {
  test('deterministic grouping by weighted connections', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [
      { src: 'a', dst: 'b', weight: 3 },
      { src: 'b', dst: 'c', weight: 1 },
      { src: 'c', dst: 'd', weight: 4 },
    ];
    const result = louvainLikeCommunities(nodes, edges);
    const communitySizes = result.map((c) => c.nodes.length);
    expect(communitySizes.reduce((sum, size) => sum + size, 0)).toBe(nodes.length);
    expect(result[0]?.nodes).toContain('a');
  });
});
