import { getRedisCache } from './redisClient';

/**
 * Distributed rate limiter using Redis for coordination across multiple worker instances.
 * Falls back to in-memory rate limiting if Redis is unavailable.
 *
 * Uses a sliding window algorithm with Redis sorted sets for accurate rate limiting.
 */
export class DistributedRateLimiter {
  private readonly minIntervalMs: number;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly redisKey: string;

  // Fallback to in-memory rate limiting if Redis is unavailable
  private lastTs = 0;
  private readonly cache = getRedisCache();

  constructor(
    private readonly identifier: string,
    private readonly maxPerSecond: number
  ) {
    if (maxPerSecond <= 0) {
      throw new Error('maxPerSecond must be > 0');
    }

    this.minIntervalMs = 1000 / maxPerSecond;
    this.windowMs = 1000; // 1 second sliding window
    this.maxRequests = maxPerSecond;
    this.redisKey = `ratelimit:${identifier}`;
  }

  /**
   * Throttle requests using distributed rate limiting via Redis.
   * Falls back to in-memory throttling if Redis is unavailable.
   */
  async throttle(now = Date.now()): Promise<void> {
    const redis = (this.cache as any).client;

    // If Redis is not available or not enabled, fall back to in-memory rate limiting
    if (!redis) {
      return this.throttleInMemory(now);
    }

    try {
      // Use Redis sliding window rate limiting
      const allowed = await this.slidingWindowRateLimit(redis, now);

      if (!allowed) {
        // Calculate wait time based on oldest request in window
        const waitMs = await this.calculateWaitTime(redis, now);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          // Retry after waiting
          return this.throttle();
        }
      }
    } catch (err) {
      // If Redis fails, fall back to in-memory rate limiting
      console.warn('[DistributedRateLimiter] Redis error, falling back to in-memory:', err);
      return this.throttleInMemory(now);
    }
  }

  /**
   * Sliding window rate limiting using Redis sorted sets.
   * Returns true if the request is allowed, false if rate limit exceeded.
   */
  private async slidingWindowRateLimit(redis: any, now: number): Promise<boolean> {
    const windowStart = now - this.windowMs;
    const requestId = `${now}-${Math.random()}`;

    // Lua script for atomic sliding window rate limiting
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local request_id = ARGV[4]
      local window_ms = tonumber(ARGV[5])

      -- Remove old entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

      -- Count current requests in window
      local current_count = redis.call('ZCARD', key)

      -- Check if we're within the limit
      if current_count < max_requests then
        -- Add this request to the window
        redis.call('ZADD', key, now, request_id)
        -- Set expiry to window size + buffer
        redis.call('PEXPIRE', key, window_ms + 1000)
        return 1
      else
        return 0
      end
    `;

    const result = await redis.eval(
      luaScript,
      1,
      this.redisKey,
      now,
      windowStart,
      this.maxRequests,
      requestId,
      this.windowMs
    );

    return result === 1;
  }

  /**
   * Calculate how long to wait before the next request can be made.
   */
  private async calculateWaitTime(redis: any, now: number): Promise<number> {
    try {
      // Get the oldest request in the current window
      const oldestRequests = await redis.zrange(this.redisKey, 0, 0, 'WITHSCORES');

      if (oldestRequests.length >= 2) {
        const oldestTimestamp = parseFloat(oldestRequests[1]);
        const windowStart = now - this.windowMs;

        // Wait until the oldest request falls out of the window
        const waitMs = Math.max(0, oldestTimestamp + this.windowMs - now + 10); // +10ms buffer
        return Math.min(waitMs, this.windowMs);
      }

      // Default wait time based on minimum interval
      return this.minIntervalMs;
    } catch (err) {
      console.warn('[DistributedRateLimiter] Error calculating wait time:', err);
      return this.minIntervalMs;
    }
  }

  /**
   * Fallback in-memory rate limiting (same as original RateLimiter).
   */
  private async throttleInMemory(now = Date.now()): Promise<void> {
    const elapsed = now - this.lastTs;
    const waitMs = this.minIntervalMs - elapsed;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastTs = Date.now();
    } else {
      this.lastTs = now;
    }
  }

  /**
   * Clear the rate limit state (useful for testing).
   */
  async clear(): Promise<void> {
    const redis = (this.cache as any).client;
    if (redis) {
      try {
        await redis.del(this.redisKey);
      } catch (err) {
        console.warn('[DistributedRateLimiter] Error clearing rate limit:', err);
      }
    }
    this.lastTs = 0;
  }

  /**
   * Get current request count in the window (for monitoring).
   */
  async getCurrentCount(): Promise<number> {
    const redis = (this.cache as any).client;
    if (!redis) {
      return 0;
    }

    try {
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Remove old entries and count remaining
      await redis.zremrangebyscore(this.redisKey, 0, windowStart);
      const count = await redis.zcard(this.redisKey);

      return count;
    } catch (err) {
      console.warn('[DistributedRateLimiter] Error getting current count:', err);
      return 0;
    }
  }
}

/**
 * Create a distributed rate limiter for a specific resource.
 * @param identifier Unique identifier for the rate limited resource (e.g., 'sec-api')
 * @param maxPerSecond Maximum requests per second across all instances
 */
export function createDistributedRateLimiter(
  identifier: string,
  maxPerSecond: number
): DistributedRateLimiter {
  return new DistributedRateLimiter(identifier, maxPerSecond);
}
