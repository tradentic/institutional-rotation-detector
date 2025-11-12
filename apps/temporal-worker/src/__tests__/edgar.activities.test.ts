import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchFilings, resolveCIK } from '../activities/edgar.activities';
import * as supabaseModule from '../lib/supabase';

const originalFetch = global.fetch;

describe('resolveCIK activity', () => {
  beforeEach(() => {
    process.env.EDGAR_USER_AGENT = 'TestApp test@example.com';
    process.env.EDGAR_BASE = 'https://data.sec.gov';
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
          JSON.stringify({ hits: [{ cik: '1084869', ticker: 'IRBT', entityName: 'iRobot Corp' }] }),
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://data.sec.gov/search/ticker?tickers=IRBT');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://data.sec.gov/submissions/CIK0001084869.json');
    expect(result).toEqual({ cik: '0001084869', cusips: ['123456789'] });
  });

  test('falls back to tickers when cusips missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ hits: [{ cik: '1084869', ticker: 'IRBT' }] }),
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
        new Response(JSON.stringify({ hits: [] }), {
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
    process.env.EDGAR_USER_AGENT = 'TestApp test@example.com';
    process.env.EDGAR_BASE = 'https://data.sec.gov';
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
    const from = vi.fn().mockReturnValue({ upsert });
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
});
