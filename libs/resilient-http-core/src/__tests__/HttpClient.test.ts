import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpError, TimeoutError } from '../HttpClient';
import type {
  HttpCache,
  HttpRateLimiter,
  Logger,
  MetricsSink,
  PolicyWrapper,
  ResponseClassifier,
  TracingAdapter,
  TracingSpan,
} from '../types';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('HttpClient v0.2', () => {
  let logger: Logger;
  let metrics: MetricsSink;

  const baseConfig = {
    baseUrl: 'https://example.com/api',
    clientName: 'test-client',
  } as const;

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
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createClient = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
    new HttpClient({
      ...baseConfig,
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

  it('returns cached values before hitting the network', async () => {
    const cache: HttpCache = {
      get: vi.fn().mockResolvedValue({ cached: true }),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const transport = vi.fn();
    const client = createClient({ cache, transport });

    const result = await client.requestJson<{ cached: boolean }>({
      method: 'GET',
      path: '/cached',
      operation: 'cache.hit',
      cacheKey: 'cache-key',
      cacheTtlMs: 1000,
    });

    expect(result).toEqual({ cached: true });
    expect(transport).not.toHaveBeenCalled();
    expect(metrics.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ cacheHit: true, attempt: 0, status: 200 }),
    );
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

    expect(logger.warn).toHaveBeenCalledWith('http.cache.get.error', expect.objectContaining({ path: '/resource' }));
    expect(transport).toHaveBeenCalled();
  });

  it('retries retryable HTTP errors and respects fallback retryAfterMs', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: true }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({ transport, maxRetries: 2 });

    const promise = client.requestJson<{ ok: boolean }>({ method: 'GET', path: '/retry', operation: 'retry.test' });
    await vi.runOnlyPendingTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('uses classifier provided fallback retryAfterMs delays', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: true }), { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const classifier: ResponseClassifier = (response) => {
      if (response.status === 429) {
        return { treatAsError: true, category: 'rate_limit', fallback: { retryAfterMs: 1000 } };
      }
      return undefined;
    };
    const client = createClient({ transport, responseClassifier: classifier, maxRetries: 2 });

    const promise = client.requestJson<{ ok: boolean }>({ method: 'GET', path: '/retry-after', operation: 'retry.after' });
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

  it('respects custom response classifier errors', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: false }));
    const classifier: ResponseClassifier = vi.fn(async () => ({
      treatAsError: true,
      overrideStatus: 418,
      category: 'validation',
    }));
    const client = createClient({ transport, responseClassifier: classifier });

    await expect(
      client.requestJson({ method: 'GET', path: '/classified', operation: 'classified.get' }),
    ).rejects.toMatchObject({ status: 418 });
  });

  it('supports dynamic base URL resolution per request', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const resolveBaseUrl = vi.fn((opts) => (opts.path.startsWith('/alt') ? 'https://alt.example.com' : undefined));
    const client = createClient({ transport, resolveBaseUrl });

    await client.requestJson({ method: 'GET', path: '/alt/data', operation: 'alt.get' });

    expect(resolveBaseUrl).toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith('https://alt.example.com/alt/data', expect.any(Object));
  });

  it('uses resolveBaseUrl when no default baseUrl is configured', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const resolveBaseUrl = vi.fn(() => 'https://dynamic.example.com/api');
    const client = createClient({ transport, resolveBaseUrl, baseUrl: undefined });

    await client.requestJson({ method: 'GET', path: '/items', operation: 'resolver.dynamic' });

    expect(resolveBaseUrl).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'resolver.dynamic', path: '/items' }),
    );
    expect(transport).toHaveBeenCalledWith(
      'https://dynamic.example.com/api/items',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('falls back to the configured baseUrl when resolveBaseUrl returns undefined', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const resolveBaseUrl = vi.fn(() => undefined);
    const client = createClient({ transport, resolveBaseUrl });

    await client.requestJson({ method: 'GET', path: '/fallback', operation: 'resolver.fallback' });

    expect(resolveBaseUrl).toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith(
      'https://example.com/api/fallback',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('allows absolute URLs without a configured baseUrl', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const client = createClient({ transport, baseUrl: undefined });

    await client.requestJson({
      method: 'GET',
      path: 'https://api.example.com/absolute',
      operation: 'absolute.get',
    });

    expect(transport).toHaveBeenCalledWith('https://api.example.com/absolute', expect.any(Object));
  });

  it('throws when no baseUrl is configured for relative paths', async () => {
    const client = createClient({ baseUrl: undefined });

    await expect(
      client.requestJson({ method: 'GET', path: '/relative', operation: 'missing.base' }),
    ).rejects.toThrow('No baseUrl provided');
  });

  it('runs beforeRequest and afterResponse hooks', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const afterResponse = vi.fn();
    const client = createClient({
      transport,
      beforeRequest: (request) => ({
        ...request,
        headers: { ...(request.headers ?? {}), 'X-Test': 'hooked' },
      }),
      afterResponse,
    });

    await client.requestJson({ method: 'GET', path: '/hook', operation: 'hook.test' });

    expect(transport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Test': 'hooked' }) }),
    );
    expect(afterResponse).toHaveBeenCalledTimes(1);
    expect(afterResponse).toHaveBeenCalledWith(
      expect.any(Response),
      expect.objectContaining({
        operation: 'hook.test',
        headers: expect.objectContaining({ 'X-Test': 'hooked' }),
      }),
    );
  });

  it('allows beforeRequest to override queries without mutating the original options', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const beforeRequest = vi.fn((request) => ({
      ...request,
      headers: { ...request.headers, 'X-Before': 'set' },
      query: { ...(request.query ?? {}), extra: '1' },
    }));
    const client = createClient({ transport, beforeRequest });

    const opts = { method: 'GET', path: '/override', operation: 'before.override', query: { initial: 'true' } } as const;
    await client.requestJson(opts);

    expect(beforeRequest).toHaveBeenCalledWith(expect.objectContaining({ query: { initial: 'true' } }));
    expect(opts.query).toEqual({ initial: 'true' });
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining('extra=1'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Before': 'set' }) }),
    );
  });

  it('uses operation defaults to override retry behaviour', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: true }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({
      transport,
      maxRetries: 0,
      operationDefaults: { 'needs.retry': { maxRetries: 1 } },
    });

    const result = await client.requestJson({ method: 'GET', path: '/retry-op', operation: 'needs.retry' });

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('can mark operations as non-idempotent via defaults', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: true }), { status: 500 }));
    const client = createClient({
      transport,
      operationDefaults: { 'non.idempotent': { idempotent: false } },
    });

    await expect(
      client.requestJson({ method: 'GET', path: '/non-idem', operation: 'non.idempotent' }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('can mark POST operations as idempotent to allow retries', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: true }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createClient({
      transport,
      operationDefaults: { 'post.retry': { idempotent: true, maxRetries: 1 } },
    });

    const promise = client.requestJson({ method: 'POST', path: '/retry-post', operation: 'post.retry' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('applies operation-specific timeouts when scheduling attempts', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const client = createClient({
      transport,
      timeoutMs: 1000,
      operationDefaults: { 'slow.op': { timeoutMs: 10 } },
    });

    await client.requestJson({ method: 'GET', path: '/slow', operation: 'slow.op' });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10);
  });

  it('prefers per-request timeout overrides over defaults', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const client = createClient({
      transport,
      timeoutMs: 1000,
      operationDefaults: { 'override.op': { timeoutMs: 50 } },
    });

    await client.requestJson({ method: 'GET', path: '/override', operation: 'override.op', timeoutMs: 5 });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5);
  });

  it('honors per-request maxRetries overrides', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: true }), { status: 500 }));
    const client = createClient({ transport, maxRetries: 0 });

    const promise = client.requestJson({
      method: 'GET',
      path: '/per-request',
      operation: 'per.request.retry',
      maxRetries: 2,
    });

    const assertion = expect(promise).rejects.toBeInstanceOf(HttpError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('uses policy wrapper around attempts', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const wrapper: PolicyWrapper = vi.fn((fn) => fn());
    const client = createClient({ transport, policyWrapper: wrapper });

    await client.requestJson({ method: 'GET', path: '/policy', operation: 'policy.test' });

    expect(wrapper).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ operation: 'policy.test' }));
  });

  it('enforces maxAttempts from budget overrides', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: true }), { status: 500 }));
    const client = createClient({ transport, maxRetries: 5 });

    await expect(
      client.requestJson({
        method: 'GET',
        path: '/limited',
        operation: 'limited.test',
        budget: { maxAttempts: 2 },
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('fails fast when the total duration budget is exceeded', async () => {
    const transport = vi.fn();
    const client = createClient({ transport, timeoutMs: 10 });

    await expect(
      client.requestJson({
        method: 'GET',
        path: '/slow',
        operation: 'slow.test',
        budget: { maxTotalDurationMs: 0 },
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('propagates agent context into rate limiter hooks', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const rateLimiter: HttpRateLimiter = {
      throttle: vi.fn().mockResolvedValue(undefined),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const client = createClient({ transport, rateLimiter });

    await client.requestJson({
      method: 'GET',
      path: '/hooks',
      operation: 'hooks.test',
      agentContext: { agent: 'tester' },
    });

    expect(rateLimiter.throttle).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ agentContext: { agent: 'tester' } }));
  });

  it('invokes tracing adapter spans', async () => {
    const transport = vi.fn().mockImplementation(() => jsonResponse({ ok: true }));
    const span: TracingSpan = {
      setAttribute: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const tracing: TracingAdapter = {
      startSpan: vi.fn().mockReturnValue(span),
    };
    const client = createClient({ transport, tracing });

    await client.requestJson({ method: 'GET', path: '/trace', operation: 'trace.test' });

    expect(tracing.startSpan).toHaveBeenCalledWith('test-client.trace.test', expect.any(Object));
    expect(span.end).toHaveBeenCalled();
  });

  it('supports requestRaw without parsing JSON', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('stream', { status: 200 }));
    const client = createClient({ transport });

    const response = await client.requestRaw({ method: 'GET', path: '/raw', operation: 'raw.test' });

    expect(response).toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns decoded text bodies via requestText', async () => {
    const response = new Response('hello world', { status: 200 });
    const client = createClient({ transport: vi.fn().mockResolvedValue(response) });
    const spy = vi.spyOn(client, 'requestRaw');

    const text = await client.requestText({ method: 'GET', path: '/text', operation: 'text.test' });

    expect(text).toBe('hello world');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies operation default timeouts to requestText calls', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const client = createClient({
      transport,
      timeoutMs: 1000,
      operationDefaults: { 'text.timeout': { timeoutMs: 25 } },
    });

    await client.requestText({ method: 'GET', path: '/text-timeout', operation: 'text.timeout' });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25);
  });

  it('returns binary bodies via requestArrayBuffer', async () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    const response = new Response(payload, { status: 200 });
    const client = createClient({ transport: vi.fn().mockResolvedValue(response) });
    const spy = vi.spyOn(client, 'requestRaw');

    const buffer = await client.requestArrayBuffer({ method: 'GET', path: '/bin', operation: 'bin.test' });

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs afterResponse hooks for requestArrayBuffer calls', async () => {
    const payload = new Uint8Array([9]).buffer;
    const response = new Response(payload, { status: 200 });
    const afterResponse = vi.fn();
    const client = createClient({ transport: vi.fn().mockResolvedValue(response), afterResponse });

    await client.requestArrayBuffer({ method: 'GET', path: '/buffer', operation: 'buffer.hook' });

    expect(afterResponse).toHaveBeenCalledWith(
      expect.any(Response),
      expect.objectContaining({ operation: 'buffer.hook' }),
    );
  });

  it('treats idempotent=false requests as single attempts', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: true }), { status: 500 }));
    const client = createClient({ transport, maxRetries: 3 });

    await expect(
      client.requestJson({ method: 'POST', path: '/no-retry', operation: 'no.retry', idempotent: false }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('treats timeout errors as retryable for idempotent requests', async () => {
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
    const client = createClient({ transport, timeoutMs: 5, maxRetries: 1 });

    const promise = client.requestJson<{ ok: boolean }>({ method: 'GET', path: '/timeout', operation: 'timeout.test' });
    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
