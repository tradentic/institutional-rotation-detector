import { describe, expect, it } from 'vitest';
import { createHttpGuardrailInterceptor, createInMemoryGuardrailEngine, GuardrailViolationError } from '..';

const engine = createInMemoryGuardrailEngine({
  rules: [
    {
      key: 'block-example',
      selector: { hostname: 'blocked.example.com' },
      action: { effect: 'block', reason: 'blocked host' },
    },
  ],
});

const interceptor = createHttpGuardrailInterceptor({ clientName: 'test', engine });

const request = { url: 'https://blocked.example.com', method: 'GET' } as any;

describe('createHttpGuardrailInterceptor', () => {
  it('throws when blocked', async () => {
    await expect(interceptor.beforeSend?.({ request, signal: new AbortController().signal })).rejects.toBeInstanceOf(
      GuardrailViolationError,
    );
  });
});

