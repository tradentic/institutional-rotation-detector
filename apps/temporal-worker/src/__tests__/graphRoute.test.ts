import { afterEach, describe, expect, test, vi } from 'vitest';
import { GET } from '../../../api/routes/graph.get';
import * as supabaseModule from '../lib/supabase';

describe('GET /api/graph', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('resolves issuer by ticker and returns graph payload', async () => {
    const issuerMaybeSingle = vi.fn().mockResolvedValue({ data: { cik: '0000320193' }, error: null });
    const entitiesIlike = vi.fn().mockReturnValue({ maybeSingle: issuerMaybeSingle });
    const entitiesEq = vi.fn().mockReturnValue({ ilike: entitiesIlike });
    const entitiesSelect = vi.fn().mockReturnValue({ eq: entitiesEq });

    const edges = [
      {
        cluster_id: 'c1',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        seller_id: 'seller-entity',
        buyer_id: 'buyer-entity',
        cusip: '000000000',
        equity_shares: 100,
        options_shares: 25,
        root_issuer_cik: '0000320193',
      },
    ];
    const rootEq = vi.fn().mockResolvedValue({ data: edges, error: null });
    const periodEq = vi.fn().mockReturnValue({ eq: rootEq });
    const edgesSelect = vi.fn().mockReturnValue({ eq: periodEq });

    const supabaseStub = {
      from: vi.fn((table: string) => {
        if (table === 'entities') {
          return { select: entitiesSelect } as any;
        }
        if (table === 'rotation_edges') {
          return { select: edgesSelect } as any;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue(supabaseStub as any);

    const request = new Request('http://localhost/api/graph?ticker=AAPL&period=2024-01');
    const response = await GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.links).toEqual([
      {
        source: 'seller-entity',
        target: 'buyer-entity',
        value: 125,
        equity: 100,
        options: 25,
      },
    ]);
    expect(payload.nodes).toEqual([
      { id: 'seller-entity', label: 'seller-entity' },
      { id: 'buyer-entity', label: 'buyer-entity' },
    ]);
    expect(supabaseStub.from).toHaveBeenCalledWith('entities');
    expect(supabaseStub.from).toHaveBeenCalledWith('rotation_edges');
  });

  test('skips issuer lookup when cik provided', async () => {
    const edges = [
      {
        cluster_id: 'c1',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        seller_id: 'seller',
        buyer_id: 'buyer',
        cusip: '000000000',
        equity_shares: 50,
        options_shares: 10,
        root_issuer_cik: '0000000000',
      },
    ];
    const rootEq = vi.fn().mockResolvedValue({ data: edges, error: null });
    const periodEq = vi.fn().mockReturnValue({ eq: rootEq });
    const edgesSelect = vi.fn().mockReturnValue({ eq: periodEq });

    const supabaseStub = {
      from: vi.fn((table: string) => {
        if (table === 'rotation_edges') {
          return { select: edgesSelect } as any;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue(supabaseStub as any);

    const request = new Request('http://localhost/api/graph?cik=0000000000&period=2024-01');
    const response = await GET(request);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.links[0]).toMatchObject({ source: 'seller', target: 'buyer', equity: 50, options: 10 });
    expect(supabaseStub.from).toHaveBeenCalledTimes(1);
    expect(supabaseStub.from).toHaveBeenCalledWith('rotation_edges');
  });
});
