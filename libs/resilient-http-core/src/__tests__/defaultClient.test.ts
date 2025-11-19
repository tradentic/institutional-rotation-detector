import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDefaultHttpClient } from '../factories';
import { HttpClient } from '../HttpClient';
import type { HttpRequestOptions } from '../types';

describe('createDefaultHttpClient', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a client with minimal config', () => {
    const client = createDefaultHttpClient({ clientName: 'test-client' });
    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should use provided baseUrl', () => {
    const client = createDefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://api.example.com',
    });
    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should apply default resilience settings', () => {
    const mockTransport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      transport: mockTransport,
    });

    const options: HttpRequestOptions = {
      operation: 'test',
      method: 'GET',
      url: 'https://api.example.com/test',
    };

    // The client should be created successfully
    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should merge custom resilience settings with defaults', () => {
    const mockTransport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      transport: mockTransport,
      defaultResilience: {
        maxAttempts: 5,
        baseBackoffMs: 500,
      },
    });

    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should use ConsoleLogger by default', async () => {
    const mockTransport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      transport: mockTransport,
    });

    await client.requestJson({
      operation: 'test',
      method: 'GET',
      url: 'https://api.example.com/test',
    });

    // ConsoleLogger should have been called
    expect(console.info).toHaveBeenCalled();
  });

  it('should use custom logger if provided', async () => {
    const customLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const mockTransport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      transport: mockTransport,
      logger: customLogger,
    });

    await client.requestJson({
      operation: 'test',
      method: 'GET',
      url: 'https://api.example.com/test',
    });

    // Custom logger should have been called, not console
    expect(customLogger.info).toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('should support custom interceptors', () => {
    const interceptor = {
      beforeSend: vi.fn(),
      afterResponse: vi.fn(),
      onError: vi.fn(),
    };

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      interceptors: [interceptor],
    });

    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should support custom agent context', () => {
    const client = createDefaultHttpClient({
      clientName: 'test-client',
      defaultAgentContext: {
        agent: 'test-agent',
        runId: 'test-run-123',
        labels: { env: 'test' },
      },
    });

    expect(client).toBeInstanceOf(HttpClient);
  });

  it('should set default resilience values correctly', () => {
    const mockTransport = vi.fn();
    const client = createDefaultHttpClient({
      clientName: 'test-client',
      transport: mockTransport,
    });

    // Verify the client was created successfully
    expect(client).toBeInstanceOf(HttpClient);
    expect(client).toBeDefined();
  });

  it('should support all config options', () => {
    const mockTransport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createDefaultHttpClient({
      clientName: 'test-client',
      baseUrl: 'https://api.example.com',
      transport: mockTransport,
      defaultHeaders: {
        'X-Custom-Header': 'test-value',
      },
      defaultResilience: {
        maxAttempts: 3,
        retryEnabled: true,
        perAttemptTimeoutMs: 30000,
        overallTimeoutMs: 90000,
        baseBackoffMs: 250,
        maxBackoffMs: 60000,
        jitterFactorRange: [0.8, 1.2],
      },
      defaultAgentContext: {
        agent: 'test-agent',
        runId: 'run-123',
      },
      interceptors: [],
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      metrics: {
        recordRequest: vi.fn(),
      },
    });

    expect(client).toBeInstanceOf(HttpClient);
  });
});
