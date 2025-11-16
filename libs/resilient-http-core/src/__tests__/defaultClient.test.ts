import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultHttpClient } from '../defaultClient';
import { HttpError, TimeoutError } from '../types';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('createDefaultHttpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('retries idempotent methods up to 3 attempts by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response('nope', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDefaultHttpClient({ clientName: 'default-client' });

    const result = await client.requestJson<{ ok: boolean }>({
      method: 'GET',
      operation: 'retry.default',
      url: 'https://example.com/retry',
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses a single attempt for non-idempotent methods by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDefaultHttpClient({ clientName: 'default-client' });

    await expect(
      client.requestJson({ method: 'POST', operation: 'single.attempt', url: 'https://example.com/once' }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies per-attempt timeout defaults', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDefaultHttpClient({ clientName: 'default-client' });

    const promise = client.requestJson({
      method: 'POST',
      operation: 'timeout.default',
      url: 'https://example.com/slow',
    });

    const awaiting = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10_001);
    await awaiting;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
