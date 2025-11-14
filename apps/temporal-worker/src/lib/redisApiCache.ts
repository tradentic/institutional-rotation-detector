import type { Cache as FinraCache } from '@libs/finra-client';
import type { Cache as OpenAiCache } from '@libs/openai-client';
import type { Cache as UwCache } from '@libs/unusualwhales-client';
import { getRedisCache, redisDebugLog } from './redisClient';

type SharedCache = FinraCache & UwCache & OpenAiCache;

interface RedisApiCacheOptions {
  namespace?: string;
  failOpen?: boolean;
}

export class RedisApiCache implements SharedCache {
  private readonly redis = getRedisCache();
  private readonly namespace: string;
  private readonly failOpen: boolean;

  constructor(options: RedisApiCacheOptions = {}) {
    this.namespace = options.namespace ?? 'api-cache';
    this.failOpen = options.failOpen ?? true;
  }

  private get client() {
    return this.redis.getClient();
  }

  private getKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const client = this.client;
    if (!client) {
      if (this.failOpen) {
        return undefined;
      }
      throw new Error('Redis cache client unavailable');
    }
    try {
      const raw = await client.get(this.getKey(key));
      if (raw == null) {
        return undefined;
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      redisDebugLog('[RedisApiCache] get error', err);
      if (this.failOpen) {
        return undefined;
      }
      throw err;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const client = this.client;
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis cache client unavailable');
    }
    const payload = JSON.stringify(value);
    try {
      if (ttlMs && ttlMs > 0) {
        await client.set(this.getKey(key), payload, 'PX', ttlMs);
      } else {
        await client.set(this.getKey(key), payload);
      }
    } catch (err) {
      redisDebugLog('[RedisApiCache] set error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
  }

  async delete(key: string): Promise<void> {
    const client = this.client;
    if (!client) {
      if (this.failOpen) {
        return;
      }
      throw new Error('Redis cache client unavailable');
    }
    try {
      await client.del(this.getKey(key));
    } catch (err) {
      redisDebugLog('[RedisApiCache] delete error', err);
      if (!this.failOpen) {
        throw err;
      }
    }
  }
}
