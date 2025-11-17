import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveCusipWithFallback } from '../activities/cusip-resolution.activities';

const originalFetch = global.fetch;

describe('CUSIP resolution - exact ticker matching', () => {
  beforeEach(() => {
    process.env.SEC_API_IO = 'test-api-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.SEC_API_IO;
  });

  test('CRITICAL: rejects substring ticker matches (BLK vs BBLKF bug)', async () => {
    // This test prevents regression of the bug where requesting "BLK"
    // (BlackRock, CIK 0002012383) returned CUSIP for "BBLKF"
    // (Britannia Bulk Holdings, CIK 0001421150, CUSIP Y0971E107)

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Britannia Bulk Holdings Inc',
            ticker: 'BBLKF',  // Contains "BLK" but is NOT "BLK"
            cik: '0001421150',
            cusip: 'Y0971E107',
          },
          // Intentionally not including the correct BLK result
          // to simulate API returning only partial matches
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383');

    // Should NOT return BBLKF's CUSIP
    expect(result.cusips).not.toContain('Y0971E107');
    // Should fall back to ticker since no exact match found
    expect(result.source).toBe('manual');
    expect(result.confidence).toBe('low');
  });

  test('accepts exact ticker match with correct CIK', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'BlackRock Inc',
            ticker: 'BLK',
            cik: '0002012383',
            cusip: '09247X101',  // Correct BlackRock CUSIP
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383');

    expect(result.cusips).toEqual(['09247X101']);
    expect(result.source).toBe('sec_api');
    expect(result.confidence).toBe('high');
  });

  test('CRITICAL: rejects exact ticker match with wrong CIK', async () => {
    // Even if ticker matches exactly, CIK mismatch should reject the result
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Wrong Company',
            ticker: 'BLK',
            cik: '0001421150',  // Wrong CIK
            cusip: 'Y0971E107',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383');

    // Should NOT return the result due to CIK mismatch
    expect(result.cusips).not.toContain('Y0971E107');
    expect(result.source).toBe('manual');
    expect(result.confidence).toBe('low');
  });

  test('accepts exact ticker match (case-insensitive)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Apple Inc',
            ticker: 'aapl',  // Lowercase
            cik: '0000320193',
            cusip: '037833100',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('AAPL', '0000320193');

    expect(result.cusips).toEqual(['037833100']);
    expect(result.source).toBe('sec_api');
    expect(result.confidence).toBe('high');
  });

  test('handles multiple results and picks exact match', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Some Other Company',
            ticker: 'BBLKF',  // Partial match
            cik: '0001421150',
            cusip: 'Y0971E107',
          },
          {
            name: 'BlackRock Inc',
            ticker: 'BLK',  // Exact match
            cik: '0002012383',
            cusip: '09247X101',
          },
          {
            name: 'Another Company',
            ticker: 'BLKA',  // Another partial match
            cik: '0001234567',
            cusip: '123456789',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383');

    // Should return only the exact match
    expect(result.cusips).toEqual(['09247X101']);
    expect(result.source).toBe('sec_api');
    expect(result.confidence).toBe('high');
  });

  test('rejects results with missing ticker field', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'Company Without Ticker',
            // ticker field missing
            cik: '0002012383',
            cusip: '09247X101',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383');

    // Should fall back since ticker is missing
    expect(result.source).toBe('manual');
    expect(result.confidence).toBe('low');
  });

  test('uses SEC submissions CUSIPs when available (skips API call)', async () => {
    const fetchMock = vi.fn(); // Should not be called
    global.fetch = fetchMock as any;

    const result = await resolveCusipWithFallback('BLK', '0002012383', ['09247X101']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.cusips).toEqual(['09247X101']);
    expect(result.source).toBe('sec_submissions');
    expect(result.confidence).toBe('high');
  });
});
