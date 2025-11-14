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

    await client.getOhlc('AAPL', { limit: 100, date: '2024-01-01' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/stock/AAPL/ohlc');
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
});
