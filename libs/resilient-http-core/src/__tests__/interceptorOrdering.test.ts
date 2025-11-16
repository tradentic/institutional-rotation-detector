import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../HttpClient';
import type { HttpRequestInterceptor, HttpRequestOptions } from '../types';

describe('Interceptor Ordering', () => {
  let executionOrder: string[];

  beforeEach(() => {
    executionOrder = [];
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('beforeSend ordering', () => {
    it('should execute beforeSend hooks in registration order', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor1-beforeSend');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor2-beforeSend');
        },
      };

      const interceptor3: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor3-beforeSend');
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      expect(executionOrder).toEqual([
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
        'interceptor3-beforeSend',
      ]);
    });

    it('should allow beforeSend to mutate request headers', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: ({ request }) => {
          request.headers = { ...request.headers, 'X-First': 'first' };
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: ({ request }) => {
          request.headers = { ...request.headers, 'X-Second': 'second' };
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      // Verify that transport was called with mutated headers
      expect(mockTransport).toHaveBeenCalled();
      const callInit = mockTransport.mock.calls[0][1];
      expect(callInit.headers).toMatchObject({
        'X-First': 'first',
        'X-Second': 'second',
      });
    });
  });

  describe('afterResponse ordering', () => {
    it('should execute afterResponse hooks in reverse registration order', async () => {
      const interceptor1: HttpRequestInterceptor = {
        afterResponse: () => {
          executionOrder.push('interceptor1-afterResponse');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        afterResponse: () => {
          executionOrder.push('interceptor2-afterResponse');
        },
      };

      const interceptor3: HttpRequestInterceptor = {
        afterResponse: () => {
          executionOrder.push('interceptor3-afterResponse');
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      expect(executionOrder).toEqual([
        'interceptor3-afterResponse',
        'interceptor2-afterResponse',
        'interceptor1-afterResponse',
      ]);
    });

    it('should provide response and attempt number to afterResponse', async () => {
      let capturedResponse: Response | undefined;
      let capturedAttempt: number | undefined;

      const interceptor: HttpRequestInterceptor = {
        afterResponse: ({ response, attempt }) => {
          capturedResponse = response;
          capturedAttempt = attempt;
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      expect(capturedResponse).toBeDefined();
      expect(capturedResponse?.status).toBe(200);
      expect(capturedAttempt).toBe(1);
    });
  });

  describe('onError ordering', () => {
    it('should execute onError hooks in reverse registration order', async () => {
      const interceptor1: HttpRequestInterceptor = {
        onError: () => {
          executionOrder.push('interceptor1-onError');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        onError: () => {
          executionOrder.push('interceptor2-onError');
        },
      };

      const interceptor3: HttpRequestInterceptor = {
        onError: () => {
          executionOrder.push('interceptor3-onError');
        },
      };

      const mockTransport = vi.fn().mockRejectedValue(new Error('Network error'));

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
        defaultResilience: {
          maxAttempts: 1,
          retryEnabled: false,
        },
      });

      try {
        await client.requestJson({
          operation: 'test',
          method: 'GET',
          url: 'https://api.example.com/test',
        });
      } catch {
        // Expected to throw
      }

      expect(executionOrder).toEqual([
        'interceptor3-onError',
        'interceptor2-onError',
        'interceptor1-onError',
      ]);
    });

    it('should provide error and attempt number to onError', async () => {
      let capturedError: unknown;
      let capturedAttempt: number | undefined;

      const interceptor: HttpRequestInterceptor = {
        onError: ({ error, attempt }) => {
          capturedError = error;
          capturedAttempt = attempt;
        },
      };

      const testError = new Error('Network error');
      const mockTransport = vi.fn().mockRejectedValue(testError);

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor],
        defaultResilience: {
          maxAttempts: 1,
          retryEnabled: false,
        },
      });

      try {
        await client.requestJson({
          operation: 'test',
          method: 'GET',
          url: 'https://api.example.com/test',
        });
      } catch {
        // Expected to throw
      }

      expect(capturedError).toBe(testError);
      expect(capturedAttempt).toBe(1);
    });
  });

  describe('full lifecycle ordering', () => {
    it('should execute all hooks in correct order on success', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor1-beforeSend'),
        afterResponse: () => executionOrder.push('interceptor1-afterResponse'),
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor2-beforeSend'),
        afterResponse: () => executionOrder.push('interceptor2-afterResponse'),
      };

      const interceptor3: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor3-beforeSend'),
        afterResponse: () => executionOrder.push('interceptor3-afterResponse'),
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      expect(executionOrder).toEqual([
        // beforeSend in registration order
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
        'interceptor3-beforeSend',
        // afterResponse in reverse order
        'interceptor3-afterResponse',
        'interceptor2-afterResponse',
        'interceptor1-afterResponse',
      ]);
    });

    it('should execute all hooks in correct order on error', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor1-beforeSend'),
        onError: () => executionOrder.push('interceptor1-onError'),
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor2-beforeSend'),
        onError: () => executionOrder.push('interceptor2-onError'),
      };

      const interceptor3: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor3-beforeSend'),
        onError: () => executionOrder.push('interceptor3-onError'),
      };

      const mockTransport = vi.fn().mockRejectedValue(new Error('Network error'));

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
        defaultResilience: {
          maxAttempts: 1,
          retryEnabled: false,
        },
      });

      try {
        await client.requestJson({
          operation: 'test',
          method: 'GET',
          url: 'https://api.example.com/test',
        });
      } catch {
        // Expected to throw
      }

      expect(executionOrder).toEqual([
        // beforeSend in registration order
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
        'interceptor3-beforeSend',
        // onError in reverse order
        'interceptor3-onError',
        'interceptor2-onError',
        'interceptor1-onError',
      ]);
    });

    it('should execute hooks once per attempt on retry', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor1-beforeSend'),
        onError: () => executionOrder.push('interceptor1-onError'),
        afterResponse: () => executionOrder.push('interceptor1-afterResponse'),
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: () => executionOrder.push('interceptor2-beforeSend'),
        onError: () => executionOrder.push('interceptor2-onError'),
        afterResponse: () => executionOrder.push('interceptor2-afterResponse'),
      };

      let callCount = 0;
      const mockTransport = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First attempt fails
          return Promise.reject(new Error('Transient error'));
        }
        // Second attempt succeeds
        return Promise.resolve(
          new Response(JSON.stringify({ data: 'test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2],
        defaultResilience: {
          maxAttempts: 2,
          retryEnabled: true,
          baseBackoffMs: 1,
        },
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      // Should show hooks for both attempts
      expect(executionOrder).toEqual([
        // Attempt 1 - beforeSend
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
        // Attempt 1 - onError (reverse order)
        'interceptor2-onError',
        'interceptor1-onError',
        // Attempt 2 - beforeSend
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
        // Attempt 2 - afterResponse (reverse order)
        'interceptor2-afterResponse',
        'interceptor1-afterResponse',
      ]);
    });
  });

  describe('async interceptors', () => {
    it('should handle async beforeSend hooks', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('interceptor1-beforeSend');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          executionOrder.push('interceptor2-beforeSend');
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      // Should still respect registration order despite different async timings
      expect(executionOrder).toEqual([
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
      ]);
    });

    it('should handle async afterResponse hooks', async () => {
      const interceptor1: HttpRequestInterceptor = {
        afterResponse: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('interceptor1-afterResponse');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        afterResponse: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          executionOrder.push('interceptor2-afterResponse');
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2],
      });

      await client.requestJson({
        operation: 'test',
        method: 'GET',
        url: 'https://api.example.com/test',
      });

      // Should respect reverse order despite different async timings
      expect(executionOrder).toEqual([
        'interceptor2-afterResponse',
        'interceptor1-afterResponse',
      ]);
    });
  });

  describe('interceptor errors', () => {
    it('should stop execution if beforeSend throws', async () => {
      const interceptor1: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor1-beforeSend');
        },
      };

      const interceptor2: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor2-beforeSend');
          throw new Error('Policy denied');
        },
      };

      const interceptor3: HttpRequestInterceptor = {
        beforeSend: () => {
          executionOrder.push('interceptor3-beforeSend');
        },
      };

      const mockTransport = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const client = new HttpClient({
        clientName: 'test-client',
        transport: mockTransport,
        interceptors: [interceptor1, interceptor2, interceptor3],
        defaultResilience: {
          maxAttempts: 1,
          retryEnabled: false,
        },
      });

      try {
        await client.requestJson({
          operation: 'test',
          method: 'GET',
          url: 'https://api.example.com/test',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Policy denied');
      }

      // Should not execute interceptor3-beforeSend or transport
      expect(executionOrder).toEqual([
        'interceptor1-beforeSend',
        'interceptor2-beforeSend',
      ]);
      expect(mockTransport).not.toHaveBeenCalled();
    });
  });
});
