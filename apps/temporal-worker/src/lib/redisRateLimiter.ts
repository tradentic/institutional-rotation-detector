import { setTimeout as sleep } from 'timers/promises';
import type { HttpRateLimiter } from '@libs/http-client-core';
import { createDistributedRateLimiter } from './distributedRateLimit';
import { getRedisCache, redisDebugLog } from './redisClient';

interface RedisRateLimiterOptions {
  identifier: string;
  maxPerSecond: number;
  namespace?: string;
  failOpen?: boolean;
}

export class RedisRateLimiter implements HttpRateLimiter {
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

  async onError(key = 'global', error: unknown): Promise<void> {
    const retryAfterMs = extractRetryAfterMs(error);
    const status = extractStatus(error);
    if (status !== 429 || !retryAfterMs || retryAfterMs <= 0) {
      return;
    }
    const client = this.cache.getClient();
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis client unavailable for rate limiter');
    }
    const expiresAt = Date.now() + retryAfterMs;
    try {
      await client.set(this.keyForCooldown(key), String(expiresAt), 'PX', retryAfterMs);
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

function extractStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error === 'object' && error && 'retryAfterMs' in error) {
    const retry = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof retry === 'number') {
      return retry;
    }
  }
  return undefined;
}
