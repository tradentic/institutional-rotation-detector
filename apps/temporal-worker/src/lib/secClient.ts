import {
  HttpClient,
  type HttpCache,
  type HttpRateLimiter,
  type HttpRequestOptions,
  type RateLimiterContext,
} from '@tradentic/resilient-http-core';
import { createDistributedRateLimiter, DistributedRateLimiter } from './distributedRateLimit';
import { getRedisCache, generateSecCacheKey } from './redisClient';

export interface SecClientConfig {
  baseUrl: string;
  dataApiBaseUrl: string;
  userAgent: string;
  maxRps: number;
}

/**
 * Determines cache TTL (in seconds) for a given SEC API path.
 * Returns 0 for paths that should not be cached.
 */
function getCacheTTL(path: string): number {
  // Company tickers reference data - cache for 24 hours
  if (path.includes('/files/company_tickers.json')) {
    return 86400; // 24 hours
  }

  // Company submissions data - cache for 1 hour
  if (path.startsWith('/submissions/') && path.endsWith('.json')) {
    return 3600; // 1 hour
  }

  // Don't cache other endpoints (filing documents, HTML pages, etc.)
  return 0;
}

class SecRedisHttpCache implements HttpCache {
  private readonly cache = getRedisCache();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const cached = await this.cache.get(key);
    if (!cached) {
      return undefined;
    }
    try {
      return JSON.parse(cached) as T;
    } catch (error) {
      console.warn('[SecClient] Failed to parse cached payload', { key, error });
      return undefined;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!ttlMs || ttlMs <= 0) {
      return;
    }
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.cache.set(key, JSON.stringify(value), ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.cache.delete(key);
  }
}

class DistributedHttpRateLimiter implements HttpRateLimiter {
  constructor(private readonly limiter: DistributedRateLimiter) {}

  async throttle(_key: string, _context: RateLimiterContext): Promise<void> {
    await this.limiter.throttle();
  }

  async onSuccess(): Promise<void> {
    // No-op: the underlying limiter has no notion of success/failure callbacks.
  }

  async onError(): Promise<void> {
    // No-op
  }
}

type ResponseKind = 'json' | 'text' | 'raw';

const TEXT_EXTENSIONS = ['.txt', '.htm', '.html', '.xml'];
const sharedSecCache = new SecRedisHttpCache();

export class SecClient {
  private readonly httpClient: HttpClient;

  constructor(private readonly config: SecClientConfig, httpClient?: HttpClient) {
    const limiter = createDistributedRateLimiter('sec-api', config.maxRps);
    this.httpClient = httpClient ??
      new HttpClient({
        clientName: 'sec',
        baseUrl: config.baseUrl,
        cache: sharedSecCache,
        rateLimiter: new DistributedHttpRateLimiter(limiter),
        resolveBaseUrl: (opts: HttpRequestOptions) => this.resolveBaseUrl(opts.path),
        beforeRequest: (opts: HttpRequestOptions) => ({
          ...opts,
          headers: {
            ...opts.headers,
            'User-Agent': this.config.userAgent,
            'Accept-Encoding': 'gzip, deflate',
          },
        }),
      });
  }

  async get(path: string, init?: RequestInit): Promise<Response> {
    const cacheTTLSeconds = getCacheTTL(path);
    const cacheKey = cacheTTLSeconds > 0 ? generateSecCacheKey(path) : undefined;
    const requestOptions = this.buildRequestOptions(path, init, cacheTTLSeconds, cacheKey);
    const responseKind = determineResponseKind(path);

    // Debug logging to help trace which endpoint/mode is being used
    console.log('[SecClient] Fetching via HttpClient:', {
      path,
      baseUrl: this.resolveBaseUrl(path),
      cacheTTL: cacheTTLSeconds > 0 ? `${cacheTTLSeconds}s` : 'disabled',
      responseKind,
    });

    if (responseKind === 'json') {
      const payload = await this.httpClient.requestJson<unknown>(requestOptions);
      return createResponseFromBody(JSON.stringify(payload), 'application/json');
    }

    if (responseKind === 'text') {
      const text = await this.httpClient.requestText(requestOptions);
      return createResponseFromBody(text, getContentTypeForPath(path));
    }

    return this.httpClient.requestRaw(requestOptions);
  }

  private resolveBaseUrl(path: string): string {
    return path.startsWith('/submissions/') ? this.config.dataApiBaseUrl : this.config.baseUrl;
  }

  private buildRequestOptions(
    path: string,
    init: RequestInit | undefined,
    cacheTTLSeconds: number,
    cacheKey?: string,
  ): HttpRequestOptions {
    const headers = normalizeHeaders(init?.headers);
    const options: HttpRequestOptions = {
      method: 'GET',
      path,
      operation: getOperationName(path),
      headers,
    };

    if (cacheKey && cacheTTLSeconds > 0) {
      options.cacheKey = cacheKey;
      options.cacheTtlMs = cacheTTLSeconds * 1000;
    }

    return options;
  }
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    const normalized: Record<string, string> = {};
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }

  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {});
  }

  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    acc[key] = String(value);
    return acc;
  }, {});
}

function getOperationName(path: string): string {
  const sanitized = path.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '_');
  return sanitized || 'root';
}

function determineResponseKind(path: string): ResponseKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'text';
  }
  return 'raw';
}

function getContentTypeForPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.htm') || lower.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (lower.endsWith('.xml')) {
    return 'application/xml; charset=utf-8';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain; charset=utf-8';
  }
  return undefined;
}

function createResponseFromBody(body: string, contentType?: string): Response {
  const headers = new Headers();
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  return new Response(body, { status: 200, headers });
}

export function createSecClient(): SecClient {
  // Main SEC site for /files/, /Archives/, etc.
  const baseUrl = process.env.EDGAR_BASE ?? 'https://www.sec.gov';
  // Data API for /submissions/ endpoint
  const dataApiBaseUrl = process.env.EDGAR_DATA_API_BASE ?? 'https://data.sec.gov';
  // Support both SEC_USER_AGENT and EDGAR_USER_AGENT for backwards compatibility
  const userAgent = process.env.SEC_USER_AGENT ?? process.env.EDGAR_USER_AGENT;
  const maxRps = Number(process.env.MAX_RPS_EDGAR ?? '8');

  // Debug logging
  console.log('[SecClient] Configuration:', {
    baseUrl,
    dataApiBaseUrl,
    userAgent: userAgent ? '[SET]' : '[NOT SET]',
    maxRps,
    envVars: {
      EDGAR_BASE: process.env.EDGAR_BASE || '[using default]',
      EDGAR_DATA_API_BASE: process.env.EDGAR_DATA_API_BASE || '[using default]',
      SEC_USER_AGENT: process.env.SEC_USER_AGENT ? '[SET]' : '[NOT SET]',
      EDGAR_USER_AGENT: process.env.EDGAR_USER_AGENT ? '[SET]' : '[NOT SET]',
    },
  });

  if (!userAgent) {
    throw new Error('SEC_USER_AGENT or EDGAR_USER_AGENT environment variable is required');
  }
  return new SecClient({ baseUrl, dataApiBaseUrl, userAgent, maxRps });
}
