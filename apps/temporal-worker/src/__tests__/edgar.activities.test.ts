import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchFilings, resolveCIK } from '../activities/edgar.activities';
import * as supabaseModule from '../lib/supabase';

const originalFetch = global.fetch;

describe('resolveCIK activity', () => {
  beforeEach(() => {
    process.env.SEC_USER_AGENT = 'TestApp test@example.com';
    process.env.EDGAR_BASE = 'https://www.sec.gov';
    process.env.EDGAR_DATA_API_BASE = 'https://data.sec.gov';
    process.env.MAX_RPS_EDGAR = '8';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('resolves ticker via search API and returns cusips', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ '0': { cik_str: 1084869, ticker: 'IRBT', title: 'iRobot Corp' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cik: '0001084869',
            securities: [
              { ticker: 'IRBT', cusip: '123456789' },
              { ticker: 'IRBT', cusip: '123456789' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    global.fetch = fetchMock as any;

    const result = await resolveCIK('IRBT');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://www.sec.gov/files/company_tickers.json');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://data.sec.gov/submissions/CIK0001084869.json');
    expect(result).toEqual({ cik: '0001084869', cusips: ['123456789'] });
  });

  test('falls back to tickers when cusips missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ '0': { cik_str: 1084869, ticker: 'IRBT', title: 'iRobot Corp' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cik: '0001084869',
            securities: [
              { ticker: 'IRBT' },
              { ticker: 'IRBT.A' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    global.fetch = fetchMock as any;

    const result = await resolveCIK('IRBT');

    expect(result.cik).toBe('0001084869');
    expect(result.cusips).toEqual(['IRBT', 'IRBT.A']);
  });

  test('throws when ticker missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    global.fetch = fetchMock as any;

    await expect(resolveCIK('MISSING')).rejects.toThrow('CIK not found for MISSING');
  });
});

describe('fetchFilings activity', () => {
  beforeEach(() => {
    process.env.SEC_USER_AGENT = 'TestApp test@example.com';
    process.env.EDGAR_BASE = 'https://www.sec.gov';
    process.env.EDGAR_DATA_API_BASE = 'https://data.sec.gov';
    process.env.MAX_RPS_EDGAR = '8';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('populates cadence and publish metadata for quarterly forms', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const from = vi.fn().mockReturnValue({ upsert });
    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue({ from } as any);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          filings: {
            recent: [
              {
                accessionNumber: '0001084869-24-000001',
                filingDate: '2024-05-15',
                reportDate: '2024-03-31',
                acceptanceDateTime: '2024-05-15T12:30:00Z',
                formType: '13F-HR',
                primaryDocument: 'form13fInfoTable.xml',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await fetchFilings('0001084869', { start: '2024-01-01', end: '2024-06-30' }, ['13F-HR']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('filings');
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          accession: '000108486924000001',
          cadence: 'quarterly',
          expected_publish_at: '2024-05-15T00:00:00.000Z',
          published_at: '2024-05-15T12:30:00.000Z',
          is_amendment: false,
        }),
      ],
      { onConflict: 'accession' }
    );
    expect(result[0]?.expected_publish_at).toBe('2024-05-15T00:00:00.000Z');
  });

  test('marks amendment filings and preserves cadence metadata', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    // Create a chainable query builder mock
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      upsert,
    };
    const from = vi.fn().mockReturnValue(queryBuilder);
    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue({ from } as any);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          filings: {
            recent: [
              {
                accessionNumber: '0000000000-24-000002',
                filingDate: '2024-02-14',
                reportDate: '2023-12-31',
                acceptanceDateTime: '2024-02-14T13:00:00Z',
                formType: '13G-A',
                primaryDocument: 'form13g.htm',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await fetchFilings('0000000000', { start: '2023-10-01', end: '2024-03-31' }, ['13G-A']);

    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0]?.[0] ?? [];
    expect(payload[0]).toMatchObject({
      cadence: 'annual',
      is_amendment: true,
    });
    expect(result[0]?.cadence).toBe('annual');
    expect(result[0]?.is_amendment).toBe(true);
  });

  test('handles columnar format response from SEC API', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const from = vi.fn().mockReturnValue({ upsert });
    vi.spyOn(supabaseModule, 'createSupabaseClient').mockReturnValue({ from } as any);

    // SEC API returns columnar format for companies with many filings
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          filings: {
            recent: {
              accessionNumber: ['0001084869-24-000001', '0001084869-24-000002'],
              filingDate: ['2024-05-15', '2024-02-14'],
              reportDate: ['2024-03-31', '2023-12-31'],
              acceptanceDateTime: ['2024-05-15T12:30:00Z', '2024-02-14T10:00:00Z'],
              formType: ['13F-HR', '13F-HR'],
              primaryDocument: ['form13fInfoTable.xml', 'form13fInfoTable.xml'],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await fetchFilings('0001084869', { start: '2024-01-01', end: '2024-06-30' }, ['13F-HR']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('filings');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      accession: '000108486924000001',
      form: '13F-HR',
      filed_date: '2024-05-15',
      period_end: '2024-03-31',
      cadence: 'quarterly',
    });
    expect(result[1]).toMatchObject({
      accession: '000108486924000002',
      form: '13F-HR',
      filed_date: '2024-02-14',
      period_end: '2023-12-31',
      cadence: 'quarterly',
    });
  });
});
