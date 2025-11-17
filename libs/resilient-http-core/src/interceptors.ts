// ============================================================================
// Standard Interceptors – Resilient HTTP v0.8.0
// ============================================================================

import type { HttpRequestInterceptor, BeforeSendContext } from './types';

// ============================================================================
// Auth Interceptor
// ============================================================================

export interface AuthInterceptorOptions {
  getToken: () => Promise<string | null> | string | null;
  headerName?: string; // default: "Authorization"
  formatToken?: (token: string) => string; // default: (t) => `Bearer ${t}`
}

/**
 * Creates an interceptor that adds an authorization header to each request.
 *
 * @example
 * ```typescript
 * const authInterceptor = createAuthInterceptor({
 *   getToken: () => localStorage.getItem('token'),
 *   headerName: 'Authorization',
 *   formatToken: (token) => `Bearer ${token}`,
 * });
 *
 * const client = new HttpClient({
 *   interceptors: [authInterceptor],
 * });
 * ```
 */
export function createAuthInterceptor(
  opts: AuthInterceptorOptions
): HttpRequestInterceptor {
  const headerName = opts.headerName ?? 'Authorization';
  const formatToken = opts.formatToken ?? ((t: string) => `Bearer ${t}`);

  return {
    beforeSend: async (ctx: BeforeSendContext) => {
      const token = await opts.getToken();
      if (token) {
        // Mutate the request headers
        if (!ctx.request.headers) {
          ctx.request.headers = {};
        }
        ctx.request.headers[headerName] = formatToken(token);
      }
    },
  };
}

// ============================================================================
// JSON Body Interceptor
// ============================================================================

export interface JsonBodyInterceptorOptions {
  defaultContentType?: string; // default: "application/json"
}

/**
 * Creates an interceptor that sets Content-Type header for JSON requests.
 *
 * @example
 * ```typescript
 * const jsonInterceptor = createJsonBodyInterceptor();
 *
 * const client = new HttpClient({
 *   interceptors: [jsonInterceptor],
 * });
 * ```
 */
export function createJsonBodyInterceptor(
  opts?: JsonBodyInterceptorOptions
): HttpRequestInterceptor {
  const contentType = opts?.defaultContentType ?? 'application/json';

  return {
    beforeSend: (ctx: BeforeSendContext) => {
      // Only add Content-Type if there's a body and no Content-Type is already set
      if (ctx.request.body !== undefined && ctx.request.body !== null) {
        if (!ctx.request.headers) {
          ctx.request.headers = {};
        }

        // Check if Content-Type is already set (case-insensitive)
        const hasContentType = Object.keys(ctx.request.headers).some(
          (key) => key.toLowerCase() === 'content-type'
        );

        if (!hasContentType) {
          ctx.request.headers['Content-Type'] = contentType;
        }
      }
    },
  };
}

// ============================================================================
// Idempotency Interceptor
// ============================================================================

export interface IdempotencyInterceptorOptions {
  headerName?: string; // default: "Idempotency-Key"
}

/**
 * Creates an interceptor that adds an idempotency key header to requests.
 *
 * The idempotency key should be provided in `request.idempotencyKey`.
 * This interceptor simply maps it to the configured header name.
 *
 * @example
 * ```typescript
 * const idempotencyInterceptor = createIdempotencyInterceptor();
 *
 * const client = new HttpClient({
 *   interceptors: [idempotencyInterceptor],
 * });
 *
 * await client.postJson('/items', item, {
 *   idempotencyKey: 'unique-key-123',
 * });
 * ```
 */
export function createIdempotencyInterceptor(
  opts?: IdempotencyInterceptorOptions
): HttpRequestInterceptor {
  const headerName = opts?.headerName ?? 'Idempotency-Key';

  return {
    beforeSend: (ctx: BeforeSendContext) => {
      if (ctx.request.idempotencyKey) {
        if (!ctx.request.headers) {
          ctx.request.headers = {};
        }
        ctx.request.headers[headerName] = ctx.request.idempotencyKey;
      }
    },
  };
}
