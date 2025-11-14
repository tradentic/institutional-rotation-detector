import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnusualWhalesClient,
  createUnusualWhalesClientFromEnv,
  type RateLimiter,
} from '../unusualWhalesClient';

const originalEnv = { ...process.env };

const jsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(data),
});

describe('createUnusualWhalesClientFromEnv', () => {
  beforeEach(() => {
    Object.assign(process.env, originalEnv);
    delete process.env.UNUSUALWHALES_API_KEY;
    delete process.env.UNUSUALWHALES_BASE_URL;
    delete process.env.UNUSUALWHALES_MAX_RETRIES;
    delete process.env.UNUSUALWHALES_RETRY_DELAY_MS;
    delete process.env.UNUSUALWHALES_TIMEOUT_MS;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it('throws when API key is missing', () => {
    expect(() => createUnusualWhalesClientFromEnv()).toThrow(
      'UNUSUALWHALES_API_KEY environment variable is required'
    );
  });

  it('uses env vars with overrides applied last', () => {
    process.env.UNUSUALWHALES_API_KEY = 'test-key';
    process.env.UNUSUALWHALES_BASE_URL = 'https://env.example.com';
    process.env.UNUSUALWHALES_MAX_RETRIES = '5';
    process.env.UNUSUALWHALES_RETRY_DELAY_MS = '750';
    process.env.UNUSUALWHALES_TIMEOUT_MS = '4000';

    const client = createUnusualWhalesClientFromEnv({
      baseUrl: 'https://override.example.com',
      maxRetries: 2,
      retryDelayMs: 100,
      timeoutMs: 1234,
    });

    const internalConfig = (client as any).config;
    expect(internalConfig.apiKey).toBe('test-key');
    expect(internalConfig.baseUrl).toBe('https://override.example.com');
    expect(internalConfig.maxRetries).toBe(2);
    expect(internalConfig.retryDelayMs).toBe(100);
    expect(internalConfig.timeoutMs).toBe(1234);
  });
});

describe('UnusualWhalesClient helpers', () => {
  const envBackup = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(process.env, envBackup);
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds URLs with query params for OHLC endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const client = new UnusualWhalesClient({
      apiKey: 'abc',
      baseUrl: 'https://api.test',
    });

    await client.getOhlc('AAPL', '5m', { limit: 100, date: '2024-01-01' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/stock/AAPL/ohlc/5m');
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('limit')).toBe('100');
    expect(parsed.searchParams.get('date')).toBe('2024-01-01');
  });

  it('invokes rate limiter before requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const throttle = vi.fn().mockResolvedValue(undefined);
    const rateLimiter: RateLimiter = { throttle };

    const client = new UnusualWhalesClient({
      apiKey: 'abc',
      baseUrl: 'https://api.test',
      rateLimiter,
    });

    await client.getShortData('MSFT');

    expect(throttle).toHaveBeenCalledTimes(1);
  });

  it('maps flow alert params to snake_case query keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const client = new UnusualWhalesClient({ apiKey: 'abc', baseUrl: 'https://api.test' });

    await client.getFlowAlerts({
      tickerSymbol: 'AAPL',
      minPremium: 0,
      ruleNames: ['RepeatedHits'],
      issueTypes: ['stock'],
      newerThan: 0,
      limit: 25,
    });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('ticker_symbol')).toBe('AAPL');
    expect(parsed.searchParams.get('min_premium')).toBe('0');
    expect(parsed.searchParams.getAll('rule_name[]')).toEqual(['RepeatedHits']);
    expect(parsed.searchParams.getAll('issue_types[]')).toEqual(['stock']);
    expect(parsed.searchParams.get('newer_than')).toBe('0');
    expect(parsed.searchParams.get('limit')).toBe('25');
  });

  it('supports option contract array filters and booleans', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const client = new UnusualWhalesClient({ apiKey: 'abc', baseUrl: 'https://api.test' });

    await client.getOptionContracts('MSFT', {
      optionSymbols: ['SYM1', 'SYM2'],
      excludeZeroVolChains: true,
      limit: 0,
    });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.getAll('option_symbol')).toEqual(['SYM1', 'SYM2']);
    expect(parsed.searchParams.get('exclude_zero_vol_chains')).toBe('true');
    expect(parsed.searchParams.get('limit')).toBe('0');
  });

  it('sends expiration arrays for spot exposures by expiry/strike', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const client = new UnusualWhalesClient({ apiKey: 'abc', baseUrl: 'https://api.test' });

    await client.getSpotExposuresByExpiryStrike('AAPL', {
      expirations: ['2024-06-21', '2024-07-19'],
      minStrike: 100,
      maxStrike: 200,
      minDte: 5,
      maxDte: 45,
    });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toContain('/api/stock/AAPL/spot-exposures/expiry-strike');
    expect(parsed.searchParams.getAll('expirations[]')).toEqual(['2024-06-21', '2024-07-19']);
    expect(parsed.searchParams.get('min_strike')).toBe('100');
    expect(parsed.searchParams.get('max_strike')).toBe('200');
    expect(parsed.searchParams.get('min_dte')).toBe('5');
    expect(parsed.searchParams.get('max_dte')).toBe('45');
  });

  it('includes newer/older cursors for dark pool ticker lookups', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const client = new UnusualWhalesClient({ apiKey: 'abc', baseUrl: 'https://api.test' });

    await client.getDarkPoolTradesForTicker('MSFT', {
      newerThan: 123,
      olderThan: 456,
      limit: 10,
    });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toContain('/api/darkpool/MSFT');
    expect(parsed.searchParams.get('newer_than')).toBe('123');
    expect(parsed.searchParams.get('older_than')).toBe('456');
    expect(parsed.searchParams.get('limit')).toBe('10');
  });

  it('builds month performers query params correctly', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const client = new UnusualWhalesClient({ apiKey: 'abc', baseUrl: 'https://api.test' });

    await client.getSeasonalityMonthPerformers(3, {
      minYears: 5,
      tickerForSector: 'XLF',
      sp500NasdaqOnly: true,
      order: 'avg_change',
      orderDirection: 'desc',
      limit: 20,
    });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toContain('/api/seasonality/3/performers');
    expect(parsed.searchParams.get('min_years')).toBe('5');
    expect(parsed.searchParams.get('ticker_for_sector')).toBe('XLF');
    expect(parsed.searchParams.get('s_p_500_nasdaq_only')).toBe('true');
    expect(parsed.searchParams.get('order')).toBe('avg_change');
    expect(parsed.searchParams.get('order_direction')).toBe('desc');
    expect(parsed.searchParams.get('limit')).toBe('20');
  });
});
