import { describe, expect, test, vi } from 'vitest';
import * as supabaseModule from '../lib/supabase.js';
import { explainEdge, setOpenAIFactory } from '../activities/rag.activities.js';

describe('RAG explain activity', () => {
  test('generates rationale from retrieved chunks', async () => {
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'rotation_edges') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { cluster_id: 'edge', cusip: '000' } }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const rpcMock = vi.fn().mockReturnValue({
      order: () => Promise.resolve({ data: [{ content: 'context snippet' }] }),
    });

    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    } as any);

    const create = vi.fn().mockResolvedValue({ output_text: 'explanation with context snippet' });
    setOpenAIFactory(() => ({ responses: { create } } as any));
    const explanation = await explainEdge({ edgeId: 'edge' });
    expect(explanation).toContain('explanation');
    expect(create).toHaveBeenCalled();
  });
});
