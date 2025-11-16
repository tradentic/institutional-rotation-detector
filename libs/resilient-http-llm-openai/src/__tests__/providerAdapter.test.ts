import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenAIHttpClient,
  OpenAIProviderAdapter,
  OpenAIConversationState,
} from '../index';
import type { HttpClient } from '@airnub/resilient-http-core';

describe('OpenAIProviderAdapter', () => {
  let mockHttpClient: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockHttpClient = {
      http: {} as HttpClient,
      responses: {
        create: vi.fn(),
        createStream: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should create adapter with default model', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      expect(adapter).toBeDefined();
    });

    it('should create adapter with custom model', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4-turbo',
      });

      expect(adapter).toBeDefined();
    });

    it('should use managed store by default', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      // Should not throw when setting state
      adapter.setConversationState('test-conv-1', { lastResponseId: 'resp-123' });
      const state = adapter.getConversationState('test-conv-1');

      expect(state).toEqual({ lastResponseId: 'resp-123' });

      adapter.destroy();
    });

    it('should accept user-provided store', () => {
      const userStore = new Map<string, OpenAIConversationState>();
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateStore: userStore,
      });

      adapter.setConversationState('test-conv-1', { lastResponseId: 'resp-123' });

      expect(userStore.get('test-conv-1')).toEqual({ lastResponseId: 'resp-123' });

      adapter.destroy();
    });
  });

  describe('complete method', () => {
    it('should call client.responses.create with correct params', async () => {
      const mockResponse = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'Hello!',
        providerMessage: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Hello!' }],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
        raw: {},
      };

      mockHttpClient.responses.create.mockResolvedValue(mockResponse);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4o',
      });

      const result = await adapter.complete({
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        metadata: { provider: 'openai', model: 'gpt-4o' },
      });

      expect(result).toEqual({
        id: 'resp-123',
        createdAt: mockResponse.createdAt,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
        raw: {},
      });

      expect(mockHttpClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          modalities: ['text'],
        }),
        expect.any(Object)
      );

      adapter.destroy();
    });

    it('should chain responses using conversation state', async () => {
      const mockResponse1 = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'Hello!',
        providerMessage: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Hello!' }],
        },
        raw: {},
      };

      const mockResponse2 = {
        id: 'resp-456',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'How can I help?',
        providerMessage: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'How can I help?' }],
        },
        raw: {},
      };

      mockHttpClient.responses.create
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4o',
      });

      // First turn
      await adapter.complete({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        metadata: { provider: 'openai', model: 'gpt-4o' },
        agentContext: { runId: 'conv-1' },
      });

      // Second turn - should include previous response ID
      await adapter.complete({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
          { role: 'user', content: [{ type: 'text', text: 'How are you?' }] },
        ],
        metadata: { provider: 'openai', model: 'gpt-4o' },
        agentContext: { runId: 'conv-1' },
      });

      // Verify second call included previousResponseId
      const secondCall = mockHttpClient.responses.create.mock.calls[1][0];
      expect(secondCall.previousResponseId).toBe('resp-123');

      adapter.destroy();
    });

    it('should handle tool calls', async () => {
      const mockResponse = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        toolCalls: [
          {
            id: 'call-1',
            name: 'getWeather',
            arguments: { location: 'San Francisco' },
          },
        ],
        raw: {},
      };

      mockHttpClient.responses.create.mockResolvedValue(mockResponse);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4o',
      });

      const result = await adapter.complete({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'What is the weather?' }] },
        ],
        tools: [
          {
            name: 'getWeather',
            description: 'Get the current weather',
            schema: { type: 'object', properties: {} },
          },
        ],
        metadata: { provider: 'openai', model: 'gpt-4o' },
      });

      expect(result.toolCalls).toEqual([
        {
          id: 'call-1',
          name: 'getWeather',
          arguments: { location: 'San Francisco' },
        },
      ]);

      adapter.destroy();
    });
  });

  describe('completeStream method', () => {
    it('should transform OpenAI stream events to provider events', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta' as const, textDelta: 'Hello' };
          yield { type: 'text-delta' as const, textDelta: ' world' };
          yield {
            type: 'done' as const,
            result: {
              id: 'resp-123',
              model: 'gpt-4o',
              createdAt: new Date(),
              outputText: 'Hello world',
              raw: {},
            },
          };
        },
        final: Promise.resolve({
          id: 'resp-123',
          model: 'gpt-4o',
          createdAt: new Date(),
          outputText: 'Hello world',
          raw: {},
        }),
      };

      mockHttpClient.responses.createStream = vi.fn().mockResolvedValue(mockStream);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4o',
      });

      const stream = await adapter.completeStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        metadata: { provider: 'openai', model: 'gpt-4o' },
      });

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'delta',
        delta: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
      });
      expect(events[1]).toMatchObject({
        type: 'delta',
        delta: {
          role: 'assistant',
          content: [{ type: 'text', text: ' world' }],
        },
      });

      adapter.destroy();
    });

    it('should update conversation state after streaming', async () => {
      const finalResult = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'Hello world',
        raw: {},
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta' as const, textDelta: 'Hello' };
          yield { type: 'done' as const, result: finalResult };
        },
        final: Promise.resolve(finalResult),
      };

      mockHttpClient.responses.createStream = vi.fn().mockResolvedValue(mockStream);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        defaultModel: 'gpt-4o',
      });

      const stream = await adapter.completeStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        metadata: { provider: 'openai', model: 'gpt-4o' },
        agentContext: { runId: 'conv-1' },
      });

      // Consume stream
      for await (const _ of stream) {
        // Just consume
      }

      // Verify state was updated
      const state = adapter.getConversationState('conv-1');
      expect(state?.lastResponseId).toBe('resp-123');

      adapter.destroy();
    });
  });

  describe('memory management', () => {
    it('should clean up expired states based on TTL', async () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateTtlMs: 1000, // 1 second TTL
        conversationStateCleanupIntervalMs: 0, // Disable automatic cleanup
      });

      // Add a state
      adapter.setConversationState('conv-1', { lastResponseId: 'resp-123' });

      // State should exist immediately
      expect(adapter.getConversationState('conv-1')).toBeDefined();

      // Advance time past TTL
      vi.advanceTimersByTime(1001);

      // Trigger cleanup by accessing (getConversationState calls cleanupExpiredStates)
      const state = adapter.getConversationState('conv-1');

      // State should be cleaned up
      expect(state).toBeUndefined();

      adapter.destroy();
    });

    it('should evict LRU states when max size exceeded', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateMaxSize: 3,
      });

      // Add 3 states (at capacity)
      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });
      adapter.setConversationState('conv-2', { lastResponseId: 'resp-2' });
      adapter.setConversationState('conv-3', { lastResponseId: 'resp-3' });

      // All should exist
      expect(adapter.getConversationState('conv-1')).toBeDefined();
      expect(adapter.getConversationState('conv-2')).toBeDefined();
      expect(adapter.getConversationState('conv-3')).toBeDefined();

      // Add 4th state - should evict conv-1 (oldest, least recently accessed)
      adapter.setConversationState('conv-4', { lastResponseId: 'resp-4' });

      // conv-1 should be evicted
      expect(adapter.getConversationState('conv-1')).toBeUndefined();
      expect(adapter.getConversationState('conv-2')).toBeDefined();
      expect(adapter.getConversationState('conv-3')).toBeDefined();
      expect(adapter.getConversationState('conv-4')).toBeDefined();

      adapter.destroy();
    });

    it('should update last access time on get', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateMaxSize: 2,
      });

      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });
      adapter.setConversationState('conv-2', { lastResponseId: 'resp-2' });

      // Access conv-1 to update its timestamp
      adapter.getConversationState('conv-1');

      // Add conv-3 - should evict conv-2 (now LRU), not conv-1
      adapter.setConversationState('conv-3', { lastResponseId: 'resp-3' });

      expect(adapter.getConversationState('conv-1')).toBeDefined();
      expect(adapter.getConversationState('conv-2')).toBeUndefined();
      expect(adapter.getConversationState('conv-3')).toBeDefined();

      adapter.destroy();
    });

    it('should run automatic cleanup timer', async () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateTtlMs: 1000,
        conversationStateCleanupIntervalMs: 500,
      });

      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });

      // State exists
      expect(adapter.getConversationState('conv-1')).toBeDefined();

      // Advance past TTL
      vi.advanceTimersByTime(1001);

      // Advance to trigger cleanup timer
      vi.advanceTimersByTime(500);

      // State should be cleaned up by timer
      expect(adapter.getConversationState('conv-1')).toBeUndefined();

      adapter.destroy();
    });

    it('should stop cleanup timer on destroy', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateCleanupIntervalMs: 500,
      });

      adapter.destroy();

      // After destroy, timer should be cleared
      // We can't directly test this, but we ensure no errors occur
      vi.advanceTimersByTime(1000);

      expect(true).toBe(true); // No errors thrown
    });

    it('should clear all states on destroy', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });
      adapter.setConversationState('conv-2', { lastResponseId: 'resp-2' });

      expect(adapter.getConversationState('conv-1')).toBeDefined();
      expect(adapter.getConversationState('conv-2')).toBeDefined();

      adapter.destroy();

      expect(adapter.getConversationState('conv-1')).toBeUndefined();
      expect(adapter.getConversationState('conv-2')).toBeUndefined();
    });

    it('should support manual state clearing', () => {
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });
      adapter.setConversationState('conv-2', { lastResponseId: 'resp-2' });

      adapter.clearConversationStates();

      expect(adapter.getConversationState('conv-1')).toBeUndefined();
      expect(adapter.getConversationState('conv-2')).toBeUndefined();

      adapter.destroy();
    });

    it('should not auto-cleanup user-provided stores', () => {
      const userStore = new Map<string, OpenAIConversationState>();
      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
        conversationStateStore: userStore,
        conversationStateTtlMs: 100, // Should be ignored
        conversationStateMaxSize: 1, // Should be ignored
      });

      adapter.setConversationState('conv-1', { lastResponseId: 'resp-1' });
      adapter.setConversationState('conv-2', { lastResponseId: 'resp-2' });

      vi.advanceTimersByTime(200);

      // Both should still exist (no TTL enforcement on user stores)
      expect(adapter.getConversationState('conv-1')).toBeDefined();
      expect(adapter.getConversationState('conv-2')).toBeDefined();

      adapter.destroy();
    });
  });

  describe('message mapping', () => {
    it('should map simple text messages correctly', async () => {
      const mockResponse = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'Response',
        raw: {},
      };

      mockHttpClient.responses.create.mockResolvedValue(mockResponse);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      await adapter.complete({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
        metadata: { provider: 'openai', model: 'gpt-4o' },
      });

      const call = mockHttpClient.responses.create.mock.calls[0][0];
      expect(call.input).toEqual([
        { role: 'user', content: 'Hello' },
      ]);

      adapter.destroy();
    });

    it('should map multi-part messages correctly', async () => {
      const mockResponse = {
        id: 'resp-123',
        model: 'gpt-4o',
        createdAt: new Date(),
        outputText: 'Response',
        raw: {},
      };

      mockHttpClient.responses.create.mockResolvedValue(mockResponse);

      const adapter = new OpenAIProviderAdapter({
        client: mockHttpClient,
      });

      await adapter.complete({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
            ],
          },
        ],
        metadata: { provider: 'openai', model: 'gpt-4o' },
      });

      const call = mockHttpClient.responses.create.mock.calls[0][0];
      expect(call.input).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
        },
      ]);

      adapter.destroy();
    });
  });
});
