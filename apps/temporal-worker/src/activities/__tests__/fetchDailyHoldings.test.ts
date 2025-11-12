import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const insertedRows: any[] = [];
let existingRows: any[] = [];
let entitiesQueryCount = 0;

class EntitiesQuery {
  private filters = new Map<string, any>();

  select() {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.set(column, value);
    return this;
  }

  async maybeSingle() {
    entitiesQueryCount += 1;
    const kind = this.filters.get('kind');
    const ticker = this.filters.get('ticker');
    if (kind === 'etf' && ticker === 'IWB') {
      return { data: { entity_id: 'etf-iwb' }, error: null };
    }
    return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
  }
}

class UhfPositionsQuery {
  private filters = new Map<string, any>();

  select() {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.set(column, value);
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    const holderId = this.filters.get('holder_id');
    const asof = this.filters.get('asof');
    const source = this.filters.get('source');
    const match = existingRows.find(
      (row) => row.holder_id === holderId && row.asof === asof && row.source === source
    );
    if (match) {
      return { data: match, error: null };
    }
    return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
  }

  async upsert(rows: any[]) {
    insertedRows.push(...rows);
    return { data: rows, error: null };
  }
}

const createSupabaseClient = vi.fn(() => ({
  from(table: string) {
    if (table === 'entities') {
      return new EntitiesQuery();
    }
    if (table === 'uhf_positions') {
      return new UhfPositionsQuery();
    }
    throw new Error(`Unexpected table ${table}`);
  },
}));

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient,
}));

describe('fetchDailyHoldings', () => {
  beforeEach(() => {
    existingRows = [];
    insertedRows.length = 0;
    entitiesQueryCount = 0;
    createSupabaseClient.mockClear();
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
    vi.resetModules();
  });

  test('resolves ETF entity and upserts holdings with UUID holder id', async () => {
    const jsonPayload = {
      aaData: [
        [
          'AAPL',
          '',
          '',
          '',
          '',
          { raw: 0.1234 },
          '',
          { raw: 100.6 },
          '037833100',
          '',
          '',
        ],
      ],
    };
    const csvPayload = 'Fund Holdings as of,"2025-01-02"\n';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(jsonPayload),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => csvPayload,
      } as any);

    globalThis.fetch = fetchMock;

    const { fetchDailyHoldings } = await import('../etf.activities.js');

    const inserted = await fetchDailyHoldings(['037833100'], ['IWB']);

    expect(inserted).toBe(1);
    expect(entitiesQueryCount).toBe(1);
    expect(insertedRows).toEqual([
      {
        holder_id: 'etf-iwb',
        cusip: '037833100',
        asof: '2025-01-02',
        shares: 101,
        source: 'ETF',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('fileType=json'),
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('fileType=csv'),
      expect.any(Object)
    );
  });
});
