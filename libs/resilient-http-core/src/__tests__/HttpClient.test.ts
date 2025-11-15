import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpError } from '../HttpClient';
import type {
  CircuitBreaker,
  HttpCache,
  HttpRateLimiter,
  Logger,
  MetricsSink,
  PolicyWrapper,
} from '../types';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

describe('HttpClient', () => {
  let logger: Logger;
  let metrics: MetricsSink;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    metrics = {
      recordRequest: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const createClient = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
    new HttpClient({
      baseUrl: 'https://example.com/api',
      clientName: 'test-client',
      logger,
      metrics,
      ...overrides,
    });

  it('performs a basic GET request and parses JSON', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const client = createClient({ transport });

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      path: '/resource',
      operation: 'resource.get',
    });

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledWith('https://example.com/api/resource', expect.any(Object));
  });

  it('serialises POST bodies as JSON by default', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ created: true }));
    const client = createClient({ transport });

    await client.requestJson({
      method: 'POST',
      path: '/resource',
      operation: 'resource.create',
      body: { foo: 'bar' },
    });

    const [, init] = transport.mock.calls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('returns cached values before hitting the network', async () => {
    const cache: HttpCache = {
      get: vi.fn().mockResolvedValue({ cached: true }),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const client = createClient({ cache });

    const result = await client.requestJson<{ cached: boolean }>({
      method: 'GET',
      path: '/cached',
      operation: 'cache.hit',
      cacheKey: 'cache-key',
      cacheTtlMs: 1000,
    });

    expect(result).toEqual({ cached: true });
    expect(cache.get).toHaveBeenCalledWith('cache-key');
    expect(metrics.recordRequest).toHaveBeenCalledWith({
      client: 'test-client',
      operation: 'cache.hit',
      durationMs: 0,
      status: 200,
      cacheHit: true,
      attempt: 0,
    });
  });

  it('logs cache errors but still performs the request', async () => {
    const cache: HttpCache = {
      get: vi.fn().mockRejectedValue(new Error('boom')),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const client = createClient({ cache, transport });

    await client.requestJson({ method: 'GET', path: '/resource', operation: 'cache.miss', cacheKey: 'k', cacheTtlMs: 1000 });

    expect(logger.warn).toHaveBeenCalledWith('http.cache.get.error', expect.objectContaining({ cacheKey: 'k' }));
    expect(transport).toHaveBeenCalled();
  });

  it('retries retryable HTTP status codes', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: true }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({ transport, maxRetries: 2 });

    const promise = client.requestJson<{ ok: boolean }>({ method: 'GET', path: '/retry', operation: 'retry.test' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('does not retry when idempotent is explicitly false', async () => {
    const transport = vi
      .fn()
      .mockImplementation(() => new Response(JSON.stringify({ error: true }), { status: 500 }));
    const client = createClient({ transport, maxRetries: 5 });

    await expect(
      client.requestJson({ method: 'POST', path: '/no-retry', operation: 'no.retry', idempotent: false }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('treats timeouts as retryable errors', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const transport = vi.fn((_: string, init: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const client = createClient({ transport, timeoutMs: 10, maxRetries: 1 });

    const promise = client.requestJson<{ ok: boolean }>({ method: 'GET', path: '/timeout', operation: 'timeout.test' });
    await vi.advanceTimersByTimeAsync(20);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('invokes rate limiter and circuit breaker hooks', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const rateLimiter: HttpRateLimiter = {
      throttle: vi.fn().mockResolvedValue(undefined),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const circuitBreaker: CircuitBreaker = {
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      onSuccess: vi.fn().mockResolvedValue(undefined),
      onFailure: vi.fn().mockResolvedValue(undefined),
    };
    const client = createClient({ transport, rateLimiter, circuitBreaker });

    await client.requestJson({ method: 'GET', path: '/hooks', operation: 'hooks.test' });

    expect(rateLimiter.throttle).toHaveBeenCalled();
    expect(rateLimiter.onSuccess).toHaveBeenCalled();
    expect(circuitBreaker.beforeRequest).toHaveBeenCalled();
    expect(circuitBreaker.onSuccess).toHaveBeenCalled();
  });

  it('respects Retry-After headers between attempts', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: true }), { status: 429, headers: { 'Retry-After': '1' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({ transport, maxRetries: 2 });

    const promise = client.requestJson({ method: 'GET', path: '/retry-after', operation: 'retry.after' });
    await Promise.resolve();
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await vi.runOnlyPendingTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('executes the policy wrapper around attempts', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const policyWrapper: PolicyWrapper = vi.fn(<T>(fn: () => Promise<T>) => fn());
    const client = createClient({ transport, policyWrapper });

    const result = await client.requestJson({ method: 'GET', path: '/policy', operation: 'policy.test' });

    expect(result).toEqual({ ok: true });
    expect(policyWrapper).toHaveBeenCalledWith(expect.any(Function), { client: 'test-client', operation: 'policy.test' });
  });

  it('propagates non-retryable HttpErrors', async () => {
    const transport = vi
      .fn()
      .mockImplementation(() => new Response(JSON.stringify({ bad: true }), { status: 400 }));
    const client = createClient({ transport });

    await expect(client.requestJson({ method: 'GET', path: '/bad', operation: 'bad.request' })).rejects.toBeInstanceOf(HttpError);
    expect(metrics.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'test-client',
        operation: 'bad.request',
        status: 400,
      }),
    );
  });
});
