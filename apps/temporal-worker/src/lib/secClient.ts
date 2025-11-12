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

export class SecClient {
  private limiter: DistributedRateLimiter;
  private cache = getRedisCache();

  constructor(private readonly config: SecClientConfig) {
    // Use distributed rate limiter so all worker instances share the same limit
    this.limiter = createDistributedRateLimiter('sec-api', config.maxRps);
  }

  async get(path: string, init?: RequestInit): Promise<Response> {
    const cacheTTL = getCacheTTL(path);

    // Try to get from cache if caching is enabled for this endpoint
    if (cacheTTL > 0) {
      const cacheKey = generateSecCacheKey(path);
      const cachedData = await this.cache.get(cacheKey);

      if (cachedData) {
        // Return cached response
        console.log('[SecClient] Returning cached response for:', path);
        return new Response(cachedData, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
          },
        });
      }
    }

    // Cache miss or caching disabled - fetch from SEC API
    await this.limiter.throttle();
    // Use dataApiBaseUrl for /submissions/ endpoints, otherwise use main baseUrl
    const base = path.startsWith('/submissions/') ? this.config.dataApiBaseUrl : this.config.baseUrl;
    const url = new URL(path, base).toString();

    // Debug logging
    console.log('[SecClient] Fetching:', {
      path,
      base,
      finalUrl: url,
      baseUrl: this.config.baseUrl,
      dataApiBaseUrl: this.config.dataApiBaseUrl,
      cacheTTL: cacheTTL > 0 ? `${cacheTTL}s` : 'disabled',
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept-Encoding': 'gzip, deflate',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      console.error('[SecClient] Request failed:', {
        url,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`SEC request failed ${response.status}`);
    }

    // Cache the response if caching is enabled for this endpoint
    if (cacheTTL > 0) {
      const cacheKey = generateSecCacheKey(path);
      const responseText = await response.text();

      // Cache the response text
      await this.cache.set(cacheKey, responseText, cacheTTL);

      // Return a new response with the cached text
      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  }
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
