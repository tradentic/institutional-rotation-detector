import { describe, expect, it } from 'vitest';
import { createBasicInMemoryPolicyEngine, createPolicyInterceptor, PolicyDeniedError, scopeMatchesSelector } from '..';
import type { HttpRequestOptions } from '@airnub/resilient-http-core';

const requestTemplate: HttpRequestOptions = { url: 'https://example.com', method: 'GET', operation: 'test.op' };

function runInterceptor(interceptor: ReturnType<typeof createPolicyInterceptor>, request: HttpRequestOptions) {
  return interceptor.beforeSend?.({ request, signal: new AbortController().signal });
}

describe('scopeMatchesSelector', () => {
  it('matches wildcards', () => {
    expect(
      scopeMatchesSelector(
        { clientName: 'a', operation: 'x', method: 'GET' },
        { clientName: '*', operation: 'x', method: 'GET' },
      ),
    ).toBe(true);
  });
});

describe('in-memory engine', () => {
  it('allows within limits', async () => {
    const engine = createBasicInMemoryPolicyEngine({ clientName: 'demo', maxRps: 2 });
    const interceptor = createPolicyInterceptor({ clientName: 'demo', engine });
    await expect(runInterceptor(interceptor, { ...requestTemplate })).resolves.toBeUndefined();
  });

  it('denies when rate limit exceeded', async () => {
    const engine = createBasicInMemoryPolicyEngine({ clientName: 'demo', maxRps: 1 });
    const interceptor = createPolicyInterceptor({ clientName: 'demo', engine });
    await runInterceptor(interceptor, { ...requestTemplate });
    await expect(runInterceptor(interceptor, { ...requestTemplate })).rejects.toBeInstanceOf(PolicyDeniedError);
  });
});

