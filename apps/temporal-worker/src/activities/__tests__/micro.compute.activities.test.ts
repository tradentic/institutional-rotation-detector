import { beforeEach, describe, expect, test, vi } from 'vitest';

let clientFactory: () => any;

vi.mock('../../lib/supabase.js', () => ({
  createSupabaseClient: () => clientFactory(),
}));

import { computeWeeklyOfficial, computeDailyApprox } from '../micro.compute.activities.js';

interface Row {
  [key: string]: any;
}

interface MockDatabase {
  [table: string]: Row[];
}

let mockDb: MockDatabase;

class MockQueryBuilder {
  constructor(private table: string, private db: MockDatabase) {}

  private filters: ((row: Row) => boolean)[] = [];
  private selected: string[] | null = null;
  private ordered: { column: string; ascending: boolean } | null = null;
  private single = false;

  select(columns?: string) {
    if (columns && columns !== '*') {
      this.selected = columns.split(',').map((col) => col.trim());
    }
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  in(column: string, values: any[]) {
    const lookup = new Set(values);
    this.filters.push((row) => lookup.has(row[column]));
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.ordered = { column, ascending: options.ascending !== false };
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  async upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (!this.db[this.table]) {
      this.db[this.table] = [];
    }
    const conflictKeys = options?.onConflict ? options.onConflict.split(',') : [];
    for (const row of rows) {
      const target = conflictKeys.length
        ? this.db[this.table].findIndex((existing) =>
            conflictKeys.every((key) => existing[key] === row[key])
          )
        : -1;
      if (target >= 0) {
        this.db[this.table][target] = { ...this.db[this.table][target], ...row };
        continue;
      }
      this.db[this.table].push({ ...row });
    }
    return { data: rows, error: null };
  }

  async then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    try {
      const rows = [...(this.db[this.table] ?? [])];
      let filtered = rows.filter((row) => this.filters.every((fn) => fn(row)));
      if (this.ordered) {
        const { column, ascending } = this.ordered;
        filtered.sort((a, b) => {
          if (a[column] === b[column]) return 0;
          return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1);
        });
      }
      if (this.selected) {
        filtered = filtered.map((row) => {
          const shaped: Row = {};
          for (const column of this.selected ?? []) {
            shaped[column] = row[column];
          }
          return shaped;
        });
      }
      const result = this.single
        ? { data: filtered[0] ?? null, error: null }
        : { data: filtered, error: null };
      this.single = false;
      return Promise.resolve(result).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).catch(onrejected as any);
    }
  }
}

function createMockSupabaseClient() {
  return {
    from(table: string) {
      return new MockQueryBuilder(table, mockDb);
    },
  };
}

const SYMBOL = 'MICRO';

beforeEach(() => {
  clientFactory = () => createMockSupabaseClient();
  mockDb = {
    micro_offex_symbol_weekly: [
      { symbol: SYMBOL, week_end: '2024-05-03', ats_shares: 400000, nonats_shares: 200000 },
    ],
    micro_consolidated_volume_daily: [
      { symbol: SYMBOL, trade_date: '2024-04-29', total_shares: 300000 },
      { symbol: SYMBOL, trade_date: '2024-04-30', total_shares: 320000 },
      { symbol: SYMBOL, trade_date: '2024-05-01', total_shares: 280000 },
      { symbol: SYMBOL, trade_date: '2024-05-02', total_shares: 260000 },
      { symbol: SYMBOL, trade_date: '2024-05-03', total_shares: 290000 },
    ],
    micro_iex_volume_daily: [
      { symbol: SYMBOL, trade_date: '2024-04-29', matched_shares: 100000 },
      { symbol: SYMBOL, trade_date: '2024-04-30', matched_shares: 120000 },
      { symbol: SYMBOL, trade_date: '2024-05-01', matched_shares: 110000 },
      { symbol: SYMBOL, trade_date: '2024-05-02', matched_shares: 90000 },
      { symbol: SYMBOL, trade_date: '2024-05-03', matched_shares: 95000 },
    ],
    micro_offex_ratio: [],
  };
});

describe('microstructure compute activities', () => {
  test('computeWeeklyOfficial stores official ratios when consolidated totals exist', async () => {
    await computeWeeklyOfficial(SYMBOL, '2024-05-03');
    expect(mockDb.micro_offex_ratio.length).toBe(1);
    const row = mockDb.micro_offex_ratio[0];
    expect(row.quality_flag).toBe('official');
    expect(row.offex_pct).toBeGreaterThan(0);
  });

  test('computeWeeklyOfficial marks partial when consolidated totals missing', async () => {
    mockDb.micro_consolidated_volume_daily = [];
    mockDb.micro_offex_ratio = [];
    await computeWeeklyOfficial(SYMBOL, '2024-05-03');
    expect(mockDb.micro_offex_ratio[0].quality_flag).toBe('official_partial');
  });

  test('computeDailyApprox distributes daily shares from consolidated totals idempotently', async () => {
    await computeDailyApprox(SYMBOL, '2024-05-03');
    const firstRun = mockDb.micro_offex_ratio.filter((row) => row.granularity === 'daily');
    expect(firstRun.length).toBeGreaterThan(0);
    expect(firstRun.every((row) => row.quality_flag === 'approx')).toBe(true);
    await computeDailyApprox(SYMBOL, '2024-05-03');
    const secondRun = mockDb.micro_offex_ratio.filter((row) => row.granularity === 'daily');
    expect(secondRun.length).toBe(firstRun.length);
  });

  test('computeDailyApprox falls back to IEX proxy when consolidated totals absent', async () => {
    mockDb.micro_offex_ratio = [];
    mockDb.micro_consolidated_volume_daily = [];
    await computeDailyApprox(SYMBOL, '2024-05-03');
    const rows = mockDb.micro_offex_ratio.filter((row) => row.granularity === 'daily');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.quality_flag === 'iex_proxy')).toBe(true);
  });
});
