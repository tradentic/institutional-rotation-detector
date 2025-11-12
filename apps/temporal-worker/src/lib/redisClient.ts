import Redis from 'ioredis';

export interface RedisCacheConfig {
  host: string;
  port: number;
  password?: string;
  enableCaching: boolean;
}

/**
 * Redis client wrapper for caching SEC EDGAR API responses.
 * Implements cache-aside pattern with graceful degradation if Redis is unavailable.
 */
export class RedisCache {
  private client: Redis | null = null;
  private readonly enabled: boolean;

  constructor(private readonly config: RedisCacheConfig) {
    this.enabled = config.enableCaching;

    if (this.enabled) {
      try {
        this.client = new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false, // Fail fast if Redis is unavailable
          connectTimeout: 5000, // 5 second connection timeout
          commandTimeout: 2000, // 2 second command timeout
          retryStrategy: (times: number) => {
            // Retry with exponential backoff up to 3 times
            if (times > 3) {
              console.warn('[RedisCache] Max retries exceeded, disabling cache');
              return null; // Stop retrying
            }
            return Math.min(times * 50, 2000);
          },
        });

        // Handle connection errors gracefully
        this.client.on('error', (err) => {
          console.warn('[RedisCache] Redis error:', err.message);
        });

        // Connect to Redis
        this.client.connect().catch((err) => {
          console.warn('[RedisCache] Failed to connect to Redis:', err.message);
          this.client = null;
        });
      } catch (err) {
        console.warn('[RedisCache] Failed to initialize Redis client:', err);
        this.client = null;
      }
    }
  }

  /**
   * Get a cached value by key
   * @param key Cache key
   * @returns Cached value or null if not found/error
   */
  async get(key: string): Promise<string | null> {
    if (!this.enabled || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value) {
        console.log('[RedisCache] Cache HIT:', key);
      } else {
        console.log('[RedisCache] Cache MISS:', key);
      }
      return value;
    } catch (err) {
      console.warn('[RedisCache] Get error:', err);
      return null;
    }
  }

  /**
   * Set a cached value with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlSeconds Time-to-live in seconds
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.enabled || !this.client) {
      return;
    }

    try {
      await this.client.setex(key, ttlSeconds, value);
      console.log('[RedisCache] Cache SET:', key, `(TTL: ${ttlSeconds}s)`);
    } catch (err) {
      console.warn('[RedisCache] Set error:', err);
    }
  }

  /**
   * Delete a cached value
   * @param key Cache key
   */
  async delete(key: string): Promise<void> {
    if (!this.enabled || !this.client) {
      return;
    }

    try {
      await this.client.del(key);
      console.log('[RedisCache] Cache DELETE:', key);
    } catch (err) {
      console.warn('[RedisCache] Delete error:', err);
    }
  }

  /**
   * Clear all cached values
   */
  async clear(): Promise<void> {
    if (!this.enabled || !this.client) {
      return;
    }

    try {
      await this.client.flushdb();
      console.log('[RedisCache] Cache CLEARED');
    } catch (err) {
      console.warn('[RedisCache] Clear error:', err);
    }
  }

  /**
   * Close the Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

let sharedRedisCache: RedisCache | null = null;

/**
 * Get or create a shared Redis cache instance
 */
export function getRedisCache(): RedisCache {
  if (!sharedRedisCache) {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? '6379');
    const password = process.env.REDIS_PASSWORD;
    const enableCaching = process.env.REDIS_ENABLE_CACHING !== 'false';

    console.log('[RedisCache] Configuration:', {
      host,
      port,
      password: password ? '[SET]' : '[NOT SET]',
      enableCaching,
    });

    sharedRedisCache = new RedisCache({
      host,
      port,
      password,
      enableCaching,
    });
  }

  return sharedRedisCache;
}

/**
 * Generate a cache key for SEC EDGAR API responses
 * @param path API path (e.g., /files/company_tickers.json)
 * @returns Cache key
 */
export function generateSecCacheKey(path: string): string {
  // Normalize the path to ensure consistent keys
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `sec:${normalizedPath}`;
}
