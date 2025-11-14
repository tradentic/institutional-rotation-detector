import { setTimeout as sleep } from 'timers/promises';
import type {
  ApiRequestError as FinraApiRequestError,
  RateLimiter as FinraRateLimiter,
} from '@libs/finra-client';
import type {
  ApiRequestError as OpenAiApiRequestError,
  RateLimiter as OpenAiRateLimiter,
} from '@libs/openai-client';
import type {
  ApiRequestError as UwApiRequestError,
  RateLimiter as UwRateLimiter,
} from '@libs/unusualwhales-client';
import { createDistributedRateLimiter } from './distributedRateLimit';
import { getRedisCache, redisDebugLog } from './redisClient';

type AnyRateLimiter = FinraRateLimiter & UwRateLimiter & OpenAiRateLimiter;
type AnyApiError = FinraApiRequestError | UwApiRequestError | OpenAiApiRequestError;

interface RedisRateLimiterOptions {
  identifier: string;
  maxPerSecond: number;
  namespace?: string;
  failOpen?: boolean;
}

export class RedisRateLimiter implements AnyRateLimiter {
  private readonly cache = getRedisCache();
  private readonly namespace: string;
  private readonly failOpen: boolean;
  private readonly limiter;

  constructor(private readonly options: RedisRateLimiterOptions) {
    this.namespace = options.namespace ?? 'ratelimit';
    this.failOpen = options.failOpen ?? true;
    this.limiter = createDistributedRateLimiter(
      `${this.namespace}:${options.identifier}`,
      options.maxPerSecond,
    );
  }

  async throttle(key = 'global'): Promise<void> {
    try {
      await this.enforceCooldown(key);
    } catch (err) {
      redisDebugLog('[RedisRateLimiter] enforceCooldown error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
    await this.limiter.throttle();
  }

  async onSuccess(key = 'global'): Promise<void> {
    await this.clearCooldown(key);
  }

  async onError(key = 'global', error: AnyApiError): Promise<void> {
    if (error.status !== 429 || !error.retryAfterMs || error.retryAfterMs <= 0) {
      return;
    }
    const client = this.cache.getClient();
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis client unavailable for rate limiter');
    }
    const expiresAt = Date.now() + error.retryAfterMs;
    try {
      await client.set(this.keyForCooldown(key), String(expiresAt), 'PX', error.retryAfterMs);
    } catch (err) {
      redisDebugLog('[RedisRateLimiter] onError set error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
  }

  private keyForCooldown(key: string): string {
    return `${this.namespace}:${this.options.identifier}:cooldown:${key}`;
  }

  private async clearCooldown(key: string): Promise<void> {
    const client = this.cache.getClient();
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis client unavailable for rate limiter');
    }
    try {
      await client.del(this.keyForCooldown(key));
    } catch (err) {
      redisDebugLog('[RedisRateLimiter] clearCooldown error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
  }

  private async enforceCooldown(key: string): Promise<void> {
    const client = this.cache.getClient();
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis client unavailable for rate limiter');
    }
    try {
      const blockedUntilRaw = await client.get(this.keyForCooldown(key));
      if (!blockedUntilRaw) {
        return;
      }
      const blockedUntil = Number(blockedUntilRaw);
      const waitMs = blockedUntil - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    } catch (err) {
      redisDebugLog('[RedisRateLimiter] enforceCooldown read error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
  }
}
