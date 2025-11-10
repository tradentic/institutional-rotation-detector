import { describe, expect, test, vi } from 'vitest';
import * as supabaseModule from '../lib/supabase.ts';
import { buildEdges } from '../activities/sankey.activities.ts';

describe('Sankey builder', () => {
  test('balances flows with remainder node', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue({
      from: () => ({ upsert }),
    } as any);
    const result = await buildEdges(
      [
        { entityId: 'seller', cusip: '000', equityDelta: -100, optionsDelta: 0 },
      ],
      [
        { entityId: 'buyer', cusip: '000', equityDelta: 60, optionsDelta: 0 },
      ],
      { start: '2024-01-01', end: '2024-03-31' },
      '0000320193'
    );
    const total = result.links.reduce((sum, link) => sum + link.equity, 0);
    expect(total).toBeGreaterThan(0);
    expect(upsert).toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0]?.root_issuer_cik).toBe('0000320193');
  });
});
