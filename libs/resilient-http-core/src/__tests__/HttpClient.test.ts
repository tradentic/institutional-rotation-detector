import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../HttpClient';
import { HttpError, TimeoutError, type HttpRequestInterceptor, type MetricsSink } from '../types';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('HttpClient v0.7', () => {
  const clientConfig = {
    clientName: 'test-client',
    defaultResilience: { maxAttempts: 2, perAttemptTimeoutMs: 50 },
  } as const;

  let metrics: MetricsSink;

  beforeEach(() => {
    metrics = { recordRequest: vi.fn() };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createClient = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
    new HttpClient({ ...clientConfig, metrics, ...overrides });

  it('retries transient failures based on resilience profile and classifier', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({ transport });

    const promise = client.requestJson<{ ok: boolean}>({
      method: 'GET',
      operation: 'retry.test',
      url: 'https://example.com/data',
      resilience: { maxAttempts: 2 },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('aborts requests that exceed per-attempt timeout', async () => {
    const transport = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        });
      });
    });
    const client = createClient({ transport });

    const promise = client.requestJson({
      method: 'GET',
      operation: 'timeout.test',
      url: 'https://example.com/slow',
      resilience: { perAttemptTimeoutMs: 10, maxAttempts: 1 },
    });

    const awaiting = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await awaiting;
  });

  it('runs interceptors in order for beforeSend and reverse for afterResponse/onError', async () => {
    const calls: string[] = [];
    const interceptorA: HttpRequestInterceptor = {
      beforeSend: () => calls.push('a:before'),
      afterResponse: () => calls.push('a:after'),
      onError: () => calls.push('a:error'),
    };
    const interceptorB: HttpRequestInterceptor = {
      beforeSend: () => calls.push('b:before'),
      afterResponse: () => calls.push('b:after'),
      onError: () => calls.push('b:error'),
    };

    const transport = vi.fn().mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const client = createClient({ transport, interceptors: [interceptorA, interceptorB], defaultResilience: { maxAttempts: 1 } });

    await expect(
      client.requestJson({ method: 'GET', operation: 'order.test', url: 'https://example.com/order' }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(calls).toEqual(['a:before', 'b:before', 'b:after', 'a:after']);
  });

  it('records metrics with correlation and agentContext', async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({ transport });

    await client.requestJson({
      method: 'GET',
      operation: 'metrics.test',
      url: 'https://example.com/metrics',
      agentContext: { agent: 'tester', runId: 'run-1' },
      correlation: { correlationId: 'corr-1', parentCorrelationId: 'parent-1' },
    });

    expect(metrics.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'metrics.test',
        agentContext: expect.objectContaining({ agent: 'tester', runId: 'run-1' }),
        correlation: expect.objectContaining({
          correlationId: 'corr-1',
          parentCorrelationId: 'parent-1',
        }),
      }),
    );
    const captured = (metrics.recordRequest as vi.Mock).mock.calls[0][0];
    expect(captured.correlation?.requestId).toBeDefined();
  });

  it('records rate limit feedback when available', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('nope', { status: 429 }));
    const client = createClient({ transport, defaultResilience: { maxAttempts: 1 } });

    await expect(
      client.requestJson({ method: 'GET', operation: 'metrics.ratelimit', url: 'https://example.com/limit' }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(metrics.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'metrics.ratelimit',
        rateLimitFeedback: { isRateLimited: true },
      }),
    );
  });
});
