import { describe, expect, test, vi } from 'vitest';
import { bundleForSynthesis } from '../activities/longcontext.activities.ts';

const edgeRows = [
  {
    edge_id: 'edge-1',
    relation: 'REPORTS_POSITION',
    weight: 100,
    attrs: { accessions: ['0001'] },
  },
];

const chunkRows = Array.from({ length: 3 }).map((_, idx) => ({
  accession: '0001',
  chunk_no: idx,
  content: 'Lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(10),
}));

vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'graph_edges') {
        return {
          select: () => ({
            in: () => ({ data: edgeRows, error: null }),
          }),
        };
      }
      if (table === 'filing_chunks') {
        return {
          select: () => ({
            in: () => ({
              order: () => ({ data: chunkRows, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

describe('bundleForSynthesis', () => {
  test('splits excerpts according to token budget', async () => {
    const bundle = await bundleForSynthesis({ edgeIds: ['edge-1'], tokenBudget: 120 });
    expect(bundle.edges).toHaveLength(1);
    expect(bundle.filings[0]?.accession).toBe('0001');
    const maxExcerptLength = Math.max(...bundle.filings[0]!.excerpts.map((excerpt) => excerpt.length));
    expect(maxExcerptLength).toBeLessThanOrEqual(120);
  });
});
