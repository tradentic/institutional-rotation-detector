/**
 * FINRA Client Unit Tests
 *
 * Tests OAuth flow, retry logic, and dataset helpers with mocked fetch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FinraClient, createFinraClient, FinraRequestError } from '../finraClient';
import type { FinraClientConfig } from '../types';

// Mock fetch globally
global.fetch = vi.fn();

describe('FinraClient', () => {
  let client: FinraClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockClear();

    const config: FinraClientConfig = {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      baseUrl: 'https://api.finra.test',
      tokenUrl: 'https://auth.finra.test/token',
      pageSize: 100,
      maxRetries: 2,
      retryDelayMs: 10,
    };

    client = new FinraClient(config);
  });

  describe('OAuth2 Token Management', () => {
    it('should request and cache access token', async () => {
      // Mock token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token-123',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // Mock data response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify([{ test: 'data' }]),
      });

      await (client as any).getDataset('otcMarket', 'test', {});

      // First call should be to token endpoint
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain('auth.finra.test/token');

      // Second call should use Bearer token
      const dataCall = mockFetch.mock.calls[1];
      expect(dataCall[1].headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should refresh expired token', async () => {
      // First token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token-1',
          token_type: 'Bearer',
          expires_in: -100, // Already expired
        }),
      });

      // First data call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      // Second token (refresh)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token-2',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // Second data call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await (client as any).getDataset('otcMarket', 'test', {});
      await (client as any).getDataset('otcMarket', 'test2', {});

      // Should have gotten new token for second call
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should handle 401 and retry with new token', async () => {
      // Initial token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'old-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // 401 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      // New token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // Successful retry
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await (client as any).getDataset('otcMarket', 'test', {});

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on 429 rate limit', async () => {
      // Token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // 429 responses
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      // Success on third try
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await (client as any).getDataset('otcMarket', 'test', {});

      // 1 token + 2 retries + 1 success = 4
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should throw after max retries', async () => {
      // Token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // All retries fail with 500
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      await expect(
        (client as any).getDataset('otcMarket', 'test', {})
      ).rejects.toThrow(FinraRequestError);
    });
  });

  describe('Dataset Helpers', () => {
    beforeEach(() => {
      // Mock token for all dataset tests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
    });

    it('should build correct POST request for getSymbolWeeklyAtsAndOtc', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify([
            {
              issueSymbolIdentifier: 'IRBT',
              weekStartDate: '2024-01-08',
              summaryTypeCode: 'ATS_W_SMBL',
              totalWeeklyShareQuantity: 100000,
              totalTradeCountSum: 50,
            },
            {
              issueSymbolIdentifier: 'IRBT',
              weekStartDate: '2024-01-08',
              summaryTypeCode: 'OTC_W_SMBL',
              totalWeeklyShareQuantity: 50000,
              totalTradeCountSum: 25,
            },
          ]),
      });

      const result = await client.getSymbolWeeklyAtsAndOtc({
        symbol: 'IRBT',
        weekStartDate: '2024-01-08',
      });

      // Verify POST request structure
      const postCall = mockFetch.mock.calls[1];
      expect(postCall[1].method).toBe('POST');
      expect(postCall[1].headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(postCall[1].body);
      expect(body.compareFilters).toContainEqual({
        compareType: 'equal',
        fieldName: 'issueSymbolIdentifier',
        fieldValue: 'IRBT',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'equal',
        fieldName: 'weekStartDate',
        fieldValue: '2024-01-08',
      });

      // Verify result separation
      expect(result.ats?.summaryTypeCode).toBe('ATS_W_SMBL');
      expect(result.otc?.summaryTypeCode).toBe('OTC_W_SMBL');
    });

    it('should build correct POST request for getConsolidatedShortInterest', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify([
            {
              settlementDate: '2024-01-15',
              issueSymbolIdentifier: 'IRBT',
              shortInterestQuantity: 5000000,
            },
          ]),
      });

      await client.getConsolidatedShortInterest({
        identifiers: { issueSymbolIdentifier: 'IRBT' },
        settlementDate: '2024-01-15',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      expect(body.compareFilters).toContainEqual({
        compareType: 'equal',
        fieldName: 'issueSymbolIdentifier',
        fieldValue: 'IRBT',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'equal',
        fieldName: 'settlementDate',
        fieldValue: '2024-01-15',
      });
    });

    it('should build date range filters for getConsolidatedShortInterestRange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.getConsolidatedShortInterestRange({
        identifiers: { cusip: '123456789' },
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      expect(body.compareFilters).toContainEqual({
        compareType: 'equal',
        fieldName: 'cusip',
        fieldValue: '123456789',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'greater',
        fieldName: 'settlementDate',
        fieldValue: '2024-01-01',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'lesser',
        fieldName: 'settlementDate',
        fieldValue: '2024-01-31',
      });
    });
  });

  describe('CSV Parsing', () => {
    it('should parse CSV responses', async () => {
      // Token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      // CSV data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/csv' },
        text: async () => `symbol,shares,date
IRBT,100000,2024-01-15
AAPL,50000,2024-01-15`,
      });

      const result = await (client as any).getDataset('otcMarket', 'test', {});

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ symbol: 'IRBT', shares: '100000', date: '2024-01-15' });
    });
  });
});

describe('createFinraClient', () => {
  it('should create client from environment variables', () => {
    process.env.FINRA_API_CLIENT = 'env-client-id';
    process.env.FINRA_API_SECRET = 'env-client-secret';

    const client = createFinraClient();
    expect(client).toBeInstanceOf(FinraClient);
  });

  it('should throw if required env vars are missing', () => {
    delete process.env.FINRA_API_CLIENT;
    delete process.env.FINRA_API_SECRET;

    expect(() => createFinraClient()).toThrow('FINRA_API_CLIENT');
  });
});
