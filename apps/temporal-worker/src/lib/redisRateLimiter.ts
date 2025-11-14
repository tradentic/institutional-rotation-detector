import { setTimeout as sleep } from 'timers/promises';
import type {
  ApiRequestError as FinraApiRequestError,
  RateLimiter as FinraRateLimiter,
} from '@libs/finra-client';
import type {
  ApiRequestError as UwApiRequestError,
  RateLimiter as UwRateLimiter,
} from '@libs/unusualwhales-client';
import { createDistributedRateLimiter } from './distributedRateLimit';
import { getRedisCache } from './redisClient';

type AnyRateLimiter = FinraRateLimiter & UwRateLimiter;
type AnyApiError = FinraApiRequestError | UwApiRequestError;

export class RedisRateLimiter implements AnyRateLimiter {
  private readonly limiter = createDistributedRateLimiter(this.identifier, this.maxPerSecond);
  private readonly cache = getRedisCache();

  constructor(private readonly identifier: string, private readonly maxPerSecond: number) {}

  async throttle(key = 'global'): Promise<void> {
    await this.enforceCooldown(key);
    await this.limiter.throttle();
  }

  async onSuccess(key = 'global'): Promise<void> {
    const client = this.cache.getClient();
    if (!client) {
      return;
    }
    await client.del(this.cooldownKey(key));
  }

  async onError(key = 'global', error: AnyApiError): Promise<void> {
    if (error.status !== 429 || !error.retryAfterMs || error.retryAfterMs <= 0) {
      return;
    }
    const client = this.cache.getClient();
    if (!client) {
      return;
    }
    const expiresAt = Date.now() + error.retryAfterMs;
    await client.set(this.cooldownKey(key), String(expiresAt), 'PX', error.retryAfterMs);
  }

  private cooldownKey(key: string): string {
    return `ratelimit:${this.identifier}:${key}`;
  }

  private async enforceCooldown(key: string): Promise<void> {
    const client = this.cache.getClient();
    if (!client) {
      return;
    }
    const blockedUntilRaw = await client.get(this.cooldownKey(key));
    if (!blockedUntilRaw) {
      return;
    }
    const blockedUntil = Number(blockedUntilRaw);
    const waitMs = blockedUntil - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}
