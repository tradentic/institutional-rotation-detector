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
        compareType: 'EQUAL',
        fieldName: 'issueSymbolIdentifier',
        fieldValue: 'IRBT',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'EQUAL',
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
              symbolCode: 'IRBT',
              currentShortPositionQuantity: 5000000,
            },
          ]),
      });

      await client.getConsolidatedShortInterest({
        identifiers: { symbolCode: 'IRBT' },
        settlementDate: '2024-01-15',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      expect(body.compareFilters).toContainEqual({
        compareType: 'EQUAL',
        fieldName: 'symbolCode',
        fieldValue: 'IRBT',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'EQUAL',
        fieldName: 'settlementDate',
        fieldValue: '2024-01-15',
      });
    });

    it('should support issueSymbolIdentifier for backwards compatibility', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.getConsolidatedShortInterest({
        identifiers: { issueSymbolIdentifier: 'IRBT' },
        settlementDate: '2024-01-15',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      // Should map issueSymbolIdentifier to symbolCode field
      expect(body.compareFilters).toContainEqual({
        compareType: 'EQUAL',
        fieldName: 'symbolCode',
        fieldValue: 'IRBT',
      });
    });

    it('should build date range filters for getConsolidatedShortInterestRange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.getConsolidatedShortInterestRange({
        identifiers: { symbolCode: 'IRBT' },
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      expect(body.compareFilters).toContainEqual({
        compareType: 'EQUAL',
        fieldName: 'symbolCode',
        fieldValue: 'IRBT',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'GREATER',
        fieldName: 'settlementDate',
        fieldValue: '2024-01-01',
      });
      expect(body.compareFilters).toContainEqual({
        compareType: 'LESSER',
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

  describe('HTTP 204 No Content Handling', () => {
    beforeEach(() => {
      // Mock token for all tests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
    });

    it('should return empty array for 204 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: () => null },
        text: async () => '',
      });

      const result = await (client as any).getDataset('otcMarket', 'test', {});
      expect(result).toEqual([]);
    });

    it('should handle 204 in POST requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: () => null },
        text: async () => '',
      });

      const result = await client.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'issueSymbolIdentifier',
            fieldValue: 'NONEXISTENT',
          },
        ],
      });

      expect(result).toEqual([]);
    });
  });

  describe('Type Conformance', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
    });

    it('should parse consolidated short interest records correctly', async () => {
      const mockRecord = {
        accountingYearMonthNumber: 20240115,
        symbolCode: 'IRBT',
        issueName: 'iRobot Corporation',
        issuerServicesGroupExchangeCode: 'Q',
        marketClassCode: 'Q',
        currentShortPositionQuantity: 5000000,
        previousShortPositionQuantity: 4800000,
        stockSplitFlag: null,
        averageDailyVolumeQuantity: 250000,
        daysToCoverQuantity: 20,
        revisionFlag: null,
        changePercent: 4.17,
        changePreviousNumber: 200000,
        settlementDate: '2024-01-15',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([mockRecord]),
      });

      const result = await client.getConsolidatedShortInterest({
        identifiers: { symbolCode: 'IRBT' },
        settlementDate: '2024-01-15',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject(mockRecord);
      expect(typeof result[0].currentShortPositionQuantity).toBe('number');
      expect(typeof result[0].symbolCode).toBe('string');
    });

    it('should parse reg SHO daily records correctly', async () => {
      const mockRecord = {
        tradeReportDate: '2024-01-15',
        securitiesInformationProcessorSymbolIdentifier: 'IRBT',
        shortParQuantity: 100000,
        shortExemptParQuantity: 5000,
        totalParQuantity: 500000,
        marketCode: 'Q',
        reportingFacilityCode: 'N',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([mockRecord]),
      });

      const result = await client.getRegShoDaily({
        symbol: 'IRBT',
        tradeReportDate: '2024-01-15',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject(mockRecord);
      expect(typeof result[0].shortParQuantity).toBe('number');
      expect(typeof result[0].reportingFacilityCode).toBe('string');
    });

    it('should parse weekly summary records correctly', async () => {
      const mockRecord = {
        issueSymbolIdentifier: 'IRBT',
        issueName: 'iRobot Corporation',
        firmCRDNumber: 12345,
        MPID: 'TEST',
        marketParticipantName: 'Test Market Maker',
        tierIdentifier: 'T2',
        tierDescription: 'NMS Tier 2',
        summaryStartDate: '2024-01-08',
        totalWeeklyTradeCount: 150,
        totalWeeklyShareQuantity: 500000,
        productTypeCode: 'EQ',
        summaryTypeCode: 'ATS_W_SMBL',
        weekStartDate: '2024-01-08',
        lastUpdateDate: '2024-01-15',
        initialPublishedDate: '2024-01-15',
        lastReportedDate: '2024-01-15',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([mockRecord]),
      });

      const result = await client.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'issueSymbolIdentifier',
            fieldValue: 'IRBT',
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject(mockRecord);
      expect(typeof result[0].totalWeeklyTradeCount).toBe('number');
      expect(typeof result[0].summaryTypeCode).toBe('string');
    });
  });

  describe('Weekly Summary Historic Filter Validation', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
    });

    it('should warn when invalid filters are used for weeklySummaryHistoric', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.queryWeeklySummaryHistoric({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'weekStartDate',
            fieldValue: '2023-01-01',
          },
          {
            compareType: 'EQUAL',
            fieldName: 'issueSymbolIdentifier', // Invalid for historic
            fieldValue: 'IRBT',
          },
        ],
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('weeklySummaryHistoric only supports filters on')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('issueSymbolIdentifier')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should not warn when only valid filters are used for weeklySummaryHistoric', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.queryWeeklySummaryHistoric({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'weekStartDate',
            fieldValue: '2023-01-01',
          },
          {
            compareType: 'EQUAL',
            fieldName: 'tierIdentifier',
            fieldValue: 'T2',
          },
        ],
      });

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('CompareType Uppercase Verification', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
    });

    it('should send compareType as uppercase in POST body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'issueSymbolIdentifier',
            fieldValue: 'IRBT',
          },
        ],
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      expect(body.compareFilters[0].compareType).toBe('EQUAL');
      expect(body.compareFilters[0].compareType).not.toBe('equal');
    });

    it('should use uppercase GREATER and LESSER for range queries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '[]',
      });

      await client.getConsolidatedShortInterestRange({
        identifiers: { symbolCode: 'IRBT' },
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);

      const greaterFilter = body.compareFilters.find(
        (f: any) => f.compareType === 'GREATER'
      );
      const lesserFilter = body.compareFilters.find(
        (f: any) => f.compareType === 'LESSER'
      );

      expect(greaterFilter).toBeDefined();
      expect(lesserFilter).toBeDefined();
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
