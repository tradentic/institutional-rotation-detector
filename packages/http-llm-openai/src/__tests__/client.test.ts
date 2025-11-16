import { describe, expect, it, vi } from 'vitest';
import { OpenAIHttpClient, OpenAIProviderAdapter } from '..';

const mockRequestJson = vi.fn();
const mockClient = { requestJson: mockRequestJson } as any;

const baseResponse = {
  id: 'res_1',
  created: 1,
  model: 'gpt',
  choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }],
};

describe('OpenAIHttpClient', () => {
  it('sends a responses create request', async () => {
    mockRequestJson.mockResolvedValueOnce(baseResponse);
    const client = new OpenAIHttpClient({ apiKey: 'k', client: mockClient as any });
    const result = await client.createResponse({ model: 'gpt', messages: [], agentContext: undefined });
    expect(result).toEqual(baseResponse);
    expect(mockRequestJson).toHaveBeenCalled();
  });
});

describe('OpenAIProviderAdapter', () => {
  it('maps complete to OpenAIHttpClient', async () => {
    mockRequestJson.mockResolvedValueOnce(baseResponse);
    const http = new OpenAIHttpClient({ apiKey: 'k', client: mockClient as any });
    const adapter = new OpenAIProviderAdapter({ client: http });
    const result = await adapter.complete({ model: 'gpt', messages: [], extensions: undefined });
    expect(result.message.content[0].text).toBe('hello');
  });
});

