import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DefaultHttpClient, DefaultError } from '../HttpClient';
import type {
  ErrorClassifier,
  HttpRequestInterceptor,
  HttpRequestOptions,
  Logger,
  MetricsRequestInfo,
  MetricsSink,
} from '../types';

const makeResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

describe('DefaultHttpClient', () => {
  let metrics: MetricsSink;
  let logger: Logger;

  beforeEach(() => {
    metrics = { recordRequest: vi.fn() };
    logger = { log: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('runs interceptors in order and propagates metadata', async () => {
    const transport = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));
    const calls: string[] = [];
    const interceptor: HttpRequestInterceptor = {
      beforeSend: ({ request }) => {
        calls.push('before');
        request.headers = { ...(request.headers ?? {}), 'X-Test': '1' };
      },
      afterResponse: () => calls.push('after'),
    };
    const client = new DefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://example.com',
      transport,
      interceptors: [interceptor],
      logger,
      metrics,
    });

    await client.requestJson({
      method: 'GET',
      operation: 'interceptor.test',
      urlParts: { path: '/hello' },
      agentContext: { agent: 'tester' },
      correlation: { correlationId: 'corr-1' },
    });

    expect(calls).toEqual(['before', 'after']);
    expect(transport).toHaveBeenCalledWith('https://example.com/hello', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Test': '1' }),
    }));
    const recorded = (metrics.recordRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as MetricsRequestInfo;
    expect(recorded.correlation?.correlationId).toBe('corr-1');
    expect(recorded.agentContext?.agent).toBe('tester');
  });

  it('retries transient errors according to resilience profile', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(500, { error: true }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));
    const client = new DefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://example.com',
      transport,
      logger,
      metrics,
      defaultResilience: { maxAttempts: 3 },
    });

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      operation: 'retry.test',
      urlParts: { path: '/resource' },
    });

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('respects per-attempt timeouts', async () => {
    vi.useFakeTimers();
    const transport = vi.fn((_: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const client = new DefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://example.com',
      transport,
      logger,
      metrics,
      defaultResilience: { perAttemptTimeoutMs: 10, maxAttempts: 1 },
    });

    const promise = client.requestRaw({ method: 'GET', operation: 'timeout.test', urlParts: { path: '/slow' } });
    const expectation = expect(promise).rejects.toBeInstanceOf(DOMException);
    await vi.advanceTimersByTimeAsync(11);
    await expectation;
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('uses custom error classifier for response errors', async () => {
    const classifier: ErrorClassifier = {
      classifyNetworkError: () => ({ category: 'unknown', retryable: false }),
      classifyResponse: () => ({ category: 'safety', retryable: false }),
    };
    const transport = vi.fn().mockResolvedValue(makeResponse(403, { error: 'denied' }));
    const client = new DefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://example.com',
      transport,
      logger,
      metrics,
      errorClassifier: classifier,
    });

    await expect(
      client.requestJson({ method: 'GET', operation: 'classify', urlParts: { path: '/forbidden' } }),
    ).rejects.toBeInstanceOf(DefaultError);
  });

  it('records rate limit feedback and outcome into metrics', async () => {
    const transport = vi.fn().mockResolvedValue(
      makeResponse(
        429,
        { error: 'limited' },
        { 'retry-after': '1', 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '0' },
      ),
    );
    const metricsSpy = vi.fn();
    const client = new DefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://example.com',
      transport,
      logger,
      metrics: { recordRequest: metricsSpy },
      defaultResilience: { maxAttempts: 1 },
    });

    await expect(
      client.requestJson({ method: 'GET', operation: 'rate.limit', urlParts: { path: '/limited' } }),
    ).rejects.toBeInstanceOf(DefaultError);

    const info = metricsSpy.mock.calls[0][0] as MetricsRequestInfo;
    expect(info.rateLimitFeedback?.isRateLimited).toBe(true);
    expect(info.outcome?.ok).toBe(false);
  });
});
