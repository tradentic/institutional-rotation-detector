import { HttpClient } from './HttpClient';
import { fetchTransport } from './transport/fetchTransport';
import type { BaseHttpClientConfig, Logger } from './types';

/**
 * Console logger implementation for use with createDefaultHttpClient.
 * Logs to console.debug, console.info, console.warn, and console.error.
 */
class ConsoleLogger implements Logger {
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(message, meta);
  }
}

/**
 * Creates an HttpClient with sensible, zero-dependency defaults suitable for most use cases.
 *
 * Defaults applied:
 * - Transport: fetch-based (via fetchTransport)
 * - Base URL: none (must be provided per-request or via config.baseUrl)
 * - Resilience: 3 max attempts, 30s timeout, exponential backoff with jitter
 * - Logger: console logger
 * - Error classifier: default classifier (maps status codes to error categories)
 * - No external dependencies (no Redis, no OTEL, no rate limiters)
 *
 * @example
 * ```typescript
 * const client = createDefaultHttpClient({
 *   clientName: 'my-api',
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * const data = await client.requestJson({
 *   method: 'GET',
 *   operation: 'getUser',
 *   urlParts: { path: '/users/123' },
 * });
 * ```
 *
 * @param config - Partial HttpClientConfig; all fields optional except clientName
 * @returns HttpClient instance with default configuration
 */
export function createDefaultHttpClient(
  config: Partial<BaseHttpClientConfig> & { clientName: string }
): HttpClient {
  const defaultConfig: BaseHttpClientConfig = {
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    transport: config.transport ?? fetchTransport,
    defaultHeaders: config.defaultHeaders,
    defaultResilience: {
      maxAttempts: 3,
      retryEnabled: true,
      perAttemptTimeoutMs: 30_000,
      overallTimeoutMs: 90_000,
      baseBackoffMs: 250,
      maxBackoffMs: 60_000,
      jitterFactorRange: [0.8, 1.2],
      ...config.defaultResilience,
    },
    defaultAgentContext: config.defaultAgentContext,
    interceptors: config.interceptors ?? [],
    logger: config.logger ?? new ConsoleLogger(),
    metrics: config.metrics,
    tracing: config.tracing,
    resolveBaseUrl: config.resolveBaseUrl,
    cache: config.cache,
    rateLimiter: config.rateLimiter,
    circuitBreaker: config.circuitBreaker,
    beforeRequest: config.beforeRequest,
    afterResponse: config.afterResponse,
    responseClassifier: config.responseClassifier,
    errorClassifier: config.errorClassifier,
    policyWrapper: config.policyWrapper,
  };

  return new HttpClient(defaultConfig);
}
