import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  __setSupabaseClientFactory,
  __clearDumpContextCache,
  detectDumpEvents,
  eventStudy,
  optionsOverlay,
  shortReliefV2,
  uhf,
  uptakeFromFilings,
} from '../compute.activities';
import type { UpsertCusipMappingResult } from '../entity-utils';

const { upsertCusipMappingMock } = vi.hoisted(() => ({
  upsertCusipMappingMock: vi
    .fn<[], Promise<UpsertCusipMappingResult>>()
    .mockResolvedValue({ cusipsAdded: 0, source: 'existing' }),
}));

vi.mock('../entity-utils', () => ({
  upsertCusipMapping: upsertCusipMappingMock,
}));
import { computeRotationScore } from '../../lib/scoring';

type Row = Record<string, any>;

interface MockDatabase {
  [table: string]: Row[];
}

const BASE_QUARTER = { start: '2024-01-01', end: '2024-03-31' } as const;
const ISSUER_CIK = '000TEST';

let mockDb: MockDatabase;

class MockQueryBuilder {
  constructor(private table: string, private db: MockDatabase) {}

  private selectedColumns: string[] | null = null;
  private filters: ((row: Row) => boolean)[] = [];
  private limitCount: number | null = null;
  private orderKey: { column: string; ascending: boolean } | null = null;
  private single = false;

  select(columns?: string) {
    if (columns && columns !== '*') {
      this.selectedColumns = columns.split(',').map((part) => part.trim());
    }
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    const lookup = new Set(values);
    this.filters.push((row) => lookup.has(row[column]));
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

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderKey = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  private execute() {
    const rows = [...(this.db[this.table] ?? [])].map((row) => ({ ...row }));
    let result = rows.filter((row) => this.filters.every((fn) => fn(row)));
    if (this.orderKey) {
      const { column, ascending } = this.orderKey;
      result.sort((a, b) => {
        if (a[column] === b[column]) return 0;
        return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }
    if (this.selectedColumns) {
      result = result.map((row) => {
        const picked: Row = {};
        for (const column of this.selectedColumns ?? []) {
          picked[column] = row[column];
        }
        return picked;
      });
    }
    if (this.single) {
      return result[0] ?? null;
    }
    return result;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    try {
      const data = this.execute();
      const result = { data, error: null };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    } catch (error) {
      if (onrejected) {
        return Promise.resolve().then(() => onrejected(error));
      }
      return Promise.reject(error);
    }
  }

  async upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (!this.db[this.table]) {
      this.db[this.table] = [];
    }
    const tableRows = this.db[this.table];
    const conflictKeys = options?.onConflict ? options.onConflict.split(',') : [];
    for (const row of rows) {
      if (conflictKeys.length > 0) {
        const index = tableRows.findIndex((existing) =>
          conflictKeys.every((key) => existing[key] === row[key])
        );
        if (index >= 0) {
          tableRows[index] = { ...tableRows[index], ...row };
          continue;
        }
      }
      tableRows.push({ ...row });
    }
    return { data: rows, error: null };
  }
}

function createMockSupabaseClient() {
  return {
    from(table: string) {
      return new MockQueryBuilder(table, mockDb);
    },
  } as any;
}

function generateDailyReturns(): Row[] {
  const start = new Date('2024-03-25T00:00:00Z');
  const rows: Row[] = [];
  for (let i = 0; i < 45; i++) {
    const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10);
    rows.push({
      cik: ISSUER_CIK,
      trade_date: iso,
      return: 0.01 + i * 0.0002,
      benchmark_return: 0.004 + i * 0.0001,
    });
  }
  return rows;
}

function resetDatabase() {
  mockDb = {
    cusip_issuer_map: [{ cusip: '111111111', issuer_cik: ISSUER_CIK }],
    positions_13f: [
      {
        entity_id: 'seller-1',
        cusip: '111111111',
        asof: '2023-12-31',
        shares: 1000000,
        opt_put_shares: 120000,
        opt_call_shares: 40000,
      },
      {
        entity_id: 'seller-1',
        cusip: '111111111',
        asof: '2024-03-31',
        shares: 600000,
        opt_put_shares: 80000,
        opt_call_shares: 20000,
      },
      {
        entity_id: 'seller-1',
        cusip: '111111111',
        asof: '2024-06-30',
        shares: 550000,
        opt_put_shares: 70000,
        opt_call_shares: 22000,
      },
      {
        entity_id: 'buyer-1',
        cusip: '111111111',
        asof: '2023-12-31',
        shares: 200000,
        opt_put_shares: 10000,
        opt_call_shares: 15000,
      },
      {
        entity_id: 'buyer-1',
        cusip: '111111111',
        asof: '2024-03-31',
        shares: 350000,
        opt_put_shares: 5000,
        opt_call_shares: 40000,
      },
      {
        entity_id: 'buyer-1',
        cusip: '111111111',
        asof: '2024-06-30',
        shares: 500000,
        opt_put_shares: 5000,
        opt_call_shares: 60000,
      },
    ],
    bo_snapshots: [
      {
        issuer_cik: ISSUER_CIK,
        holder_cik: 'holder-1',
        event_date: '2024-02-15',
        shares_est: 100000,
        pct_of_class: null,
      },
      {
        issuer_cik: ISSUER_CIK,
        holder_cik: 'holder-1',
        event_date: '2024-03-20',
        shares_est: 70000,
        pct_of_class: null,
      },
    ],
    uhf_positions: [
      { holder_id: 'uhf-1', cusip: '111111111', asof: '2023-12-20', shares: 10000, source: 'ETF' },
      { holder_id: 'uhf-1', cusip: '111111111', asof: '2024-01-31', shares: 30000, source: 'ETF' },
      { holder_id: 'uhf-1', cusip: '111111111', asof: '2024-03-15', shares: 45000, source: 'ETF' },
      { holder_id: 'uhf-1', cusip: '111111111', asof: '2024-04-30', shares: 60000, source: 'ETF' },
      { holder_id: 'uhf-1', cusip: '111111111', asof: '2024-06-15', shares: 75000, source: 'ETF' },
    ],
    short_interest: [
      { cik: ISSUER_CIK, settle_date: '2024-03-15', short_shares: 1000000 },
      { cik: ISSUER_CIK, settle_date: '2024-04-15', short_shares: 700000 },
      { cik: ISSUER_CIK, settle_date: '2024-05-15', short_shares: 650000 },
    ],
    daily_returns: generateDailyReturns(),
    rotation_events: [],
  };
}

beforeEach(() => {
  resetDatabase();
  __setSupabaseClientFactory(() => createMockSupabaseClient());
  upsertCusipMappingMock.mockClear();
});

afterEach(() => {
  __clearDumpContextCache();
});

describe('compute activities integration', () => {
  test('detectDumpEvents identifies large reductions from holdings and BO data', async () => {
    const events = await detectDumpEvents(ISSUER_CIK, BASE_QUARTER);
    const sellers = events.map((event) => event.seller);
    expect(sellers).toContain('seller-1');
    expect(events.find((event) => event.seller === 'seller-1')?.delta ?? 0).toBeLessThan(-0.3);
    expect(sellers).toContain('holder-1');
  });

  test('score pipeline responds to holdings and short interest shifts', async () => {
    const anchors = await detectDumpEvents(ISSUER_CIK, BASE_QUARTER);
    expect(anchors.length).toBeGreaterThan(0);
    const anchor = anchors.find((event) => event.seller === 'seller-1');
    expect(anchor).toBeDefined();

    const uptake = await uptakeFromFilings(ISSUER_CIK, BASE_QUARTER);
    const uhfMetrics = await uhf(ISSUER_CIK, BASE_QUARTER);
    const options = await optionsOverlay(ISSUER_CIK, BASE_QUARTER);
    const shortRelief = await shortReliefV2(ISSUER_CIK, BASE_QUARTER);

    const baseScore = computeRotationScore({
      dumpZ: Math.abs(anchor!.delta) * 5,
      uSame: uptake.uSame,
      uNext: uptake.uNext,
      uhfSame: uhfMetrics.uhfSame,
      uhfNext: uhfMetrics.uhfNext,
      optSame: options.optSame,
      optNext: options.optNext,
      shortReliefV2: shortRelief,
      indexPenalty: 0,
      eow: false,
    }).rScore;

    mockDb.positions_13f = mockDb.positions_13f.map((row) => {
      if (row.entity_id === 'buyer-1' && row.asof === '2024-03-31') {
        return { ...row, shares: 250000, opt_call_shares: 20000 };
      }
      return row;
    });
    mockDb.short_interest = mockDb.short_interest.map((row) =>
      row.settle_date === '2024-04-15' ? { ...row, short_shares: 900000 } : row
    );
    __clearDumpContextCache();

    const followAnchors = await detectDumpEvents(ISSUER_CIK, BASE_QUARTER);
    const followAnchor = followAnchors.find((event) => event.seller === 'seller-1');
    expect(followAnchor).toBeDefined();

    const followUptake = await uptakeFromFilings(ISSUER_CIK, BASE_QUARTER);
    const followUhf = await uhf(ISSUER_CIK, BASE_QUARTER);
    const followOptions = await optionsOverlay(ISSUER_CIK, BASE_QUARTER);
    const followShortRelief = await shortReliefV2(ISSUER_CIK, BASE_QUARTER);

    const shiftedScore = computeRotationScore({
      dumpZ: Math.abs(followAnchor!.delta) * 5,
      uSame: followUptake.uSame,
      uNext: followUptake.uNext,
      uhfSame: followUhf.uhfSame,
      uhfNext: followUhf.uhfNext,
      optSame: followOptions.optSame,
      optNext: followOptions.optNext,
      shortReliefV2: followShortRelief,
      indexPenalty: 0,
      eow: false,
    }).rScore;

    expect(shiftedScore).not.toBeCloseTo(baseScore);
    expect(shiftedScore).toBeLessThan(baseScore);
  });

  test('eventStudy derives CAR metrics from ingested returns', async () => {
    const study = await eventStudy(BASE_QUARTER.end, ISSUER_CIK);
    expect(study.car).toBeGreaterThan(0);
    expect(study.ttPlus20).toBeGreaterThan(0);
    expect(study.maxRet).toBeGreaterThan(0);
  });
});
