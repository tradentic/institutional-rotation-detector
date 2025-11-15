import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, HttpError, TimeoutError } from '../HttpClient';
import type {
  CircuitBreaker,
  HttpCache,
  HttpRateLimiter,
  Logger,
  MetricsSink,
} from '../types';

describe('HttpClient', () => {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const metrics: MetricsSink = {
    recordRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createClient = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) => {
    return new HttpClient({
      baseUrl: 'https://example.com/api',
      clientName: 'test-client',
      transport: overrides.transport,
      logger,
      metrics,
      ...overrides,
    });
  };

  it('performs a GET request and parses JSON', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createClient({ transport });

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      path: '/resource',
      operation: 'resource.get',
    });

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe('https://example.com/api/resource');
  });

  it('serializes JSON bodies on POST', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createClient({ transport });

    await client.requestJson<{ ok: boolean }>({
      method: 'POST',
      path: '/resource',
      operation: 'resource.create',
      body: { hello: 'world' },
    });

    const [, init] = transport.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('short-circuits on cache hit', async () => {
    const cache: HttpCache = {
      get: vi.fn().mockResolvedValue({ cached: true }),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const transport = vi.fn();
    const client = createClient({ cache, transport });

    const result = await client.requestJson<{ cached: boolean }>({
      method: 'GET',
      path: '/resource',
      operation: 'resource.cached',
      cacheKey: 'resource',
      cacheTtlMs: 10_000,
    });

    expect(result).toEqual({ cached: true });
    expect(transport).not.toHaveBeenCalled();
  });

  it('retries on retryable status codes', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response(JSON.stringify({ error: true }), { status: 500 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ];
    const transport = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()!));
    const client = createClient({ transport, maxRetries: 2 });

    const promise = client.requestJson<{ ok: boolean }>({
      method: 'GET',
      path: '/retry',
      operation: 'retry.test',
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('throws TimeoutError when exceeding timeout', async () => {
    const transport = vi.fn((_: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const client = createClient({ transport, timeoutMs: 20 });

    await expect(
      client.requestJson<{ ok: boolean }>({
        method: 'GET',
        path: '/timeout',
        operation: 'timeout.test',
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('invokes rate limiter and circuit breaker hooks', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
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

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      path: '/hooks',
      operation: 'hooks.test',
    });

    expect(result).toEqual({ ok: true });
    expect(rateLimiter.throttle).toHaveBeenCalled();
    expect(rateLimiter.onSuccess).toHaveBeenCalled();
    expect(circuitBreaker.beforeRequest).toHaveBeenCalled();
    expect(circuitBreaker.onSuccess).toHaveBeenCalled();
  });

  it('executes policy wrapper around attempts', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const wrapper = vi.fn(<T>(fn: () => Promise<T>) => {
      return async () => fn();
    });
    const client = createClient({ transport, policyWrapper: wrapper });

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      path: '/policy',
      operation: 'policy.test',
    });

    expect(result).toEqual({ ok: true });
    expect(wrapper).toHaveBeenCalledTimes(1);
    expect(wrapper).toHaveBeenCalledWith(expect.any(Function), {
      client: 'test-client',
      operation: 'policy.test',
    });
  });

  it('throws HttpError for non-retryable status', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ bad: true }), { status: 400 }));
    const client = createClient({ transport });

    await expect(
      client.requestJson<{ bad: boolean }>({
        method: 'GET',
        path: '/error',
        operation: 'error.test',
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
