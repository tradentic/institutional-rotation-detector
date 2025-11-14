import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryCache,
  OpenAiClient,
  OpenAiRequestError,
  createOpenAiClientFromEnv,
} from '../openaiClient';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
  });

describe('OpenAiClient', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('retries on 500 and 502 responses before succeeding', async () => {
    const transport = vi
      .fn<Parameters<NonNullable<OpenAiClient['config']['transport']>>, Promise<Response>>()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ id: '123', items: [], model: 'gpt-5' }));

    const client = new OpenAiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      transport,
      baseRetryDelayMs: 1,
    });

    const result = await client.createResponse({ model: 'gpt-5', input: 'hi' });

    expect(result.id).toBe('123');
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After headers on 429 responses', async () => {
    const transport = vi
      .fn<Parameters<NonNullable<OpenAiClient['config']['transport']>>, Promise<Response>>()
      .mockResolvedValueOnce(
        new Response('rate limited', { status: 429, headers: { 'retry-after': '0.001' } })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'abc', items: [], model: 'gpt-5' }));
    const warn = vi.fn();
    const client = new OpenAiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      transport,
      logger: { warn },
    });

    await client.createResponse({ model: 'gpt-5', input: 'hello' });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('after 1ms'));
  });

  it('uses cache for listModels when cache TTL is provided', async () => {
    const transport = vi
      .fn<Parameters<NonNullable<OpenAiClient['config']['transport']>>, Promise<Response>>()
      .mockResolvedValue(jsonResponse({ object: 'list', data: [] }));
    const cache = new InMemoryCache();
    const client = new OpenAiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      transport,
      cache,
    });

    await client.listModels({ cacheTtlMs: 1000 });
    await client.listModels({ cacheTtlMs: 1000 });

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('throws when retries exhausted', async () => {
    const transport = vi
      .fn<Parameters<NonNullable<OpenAiClient['config']['transport']>>, Promise<Response>>()
      .mockResolvedValue(new Response('fail', { status: 503 }));
    const client = new OpenAiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      transport,
      maxRetries: 1,
      baseRetryDelayMs: 1,
    });

    await expect(client.createResponse({ model: 'gpt-5', input: 'test' })).rejects.toBeInstanceOf(
      OpenAiRequestError,
    );
  });

  it('creates clients from environment variables', () => {
    process.env.OPENAI_API_KEY = 'env-key';
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1';
    process.env.OPENAI_ORGANIZATION = 'org';
    process.env.OPENAI_MAX_RETRIES = '5';
    process.env.OPENAI_BASE_RETRY_DELAY_MS = '750';
    process.env.OPENAI_TIMEOUT_MS = '1234';

    const client = createOpenAiClientFromEnv();
    const internal = (client as any).config;

    expect(internal.apiKey).toBe('env-key');
    expect(internal.baseUrl).toBe('https://env.example.com/v1');
    expect(internal.organizationId).toBe('org');
    expect(internal.maxRetries).toBe(5);
    expect(internal.baseRetryDelayMs).toBe(750);
    expect(internal.timeoutMs).toBe(1234);
  });
});
