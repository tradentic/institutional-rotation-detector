import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveCIK } from '../activities/edgar.activities.js';

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
