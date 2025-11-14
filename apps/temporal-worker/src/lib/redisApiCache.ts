import type { Cache as FinraCache } from '@libs/finra-client';
import type { Cache as UwCache } from '@libs/unusualwhales-client';
import { getRedisCache } from './redisClient';

type SharedCache = FinraCache & UwCache;

export class RedisApiCache implements SharedCache {
  private readonly redis = getRedisCache();

  private get client() {
    return this.redis.getClient();
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const client = this.client;
    if (!client) {
      return undefined;
    }
    const raw = await client.get(key);
    if (raw == null) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const payload = JSON.stringify(value);
    if (ttlMs && ttlMs > 0) {
      await client.set(key, payload, 'PX', ttlMs);
    } else {
      await client.set(key, payload);
    }
  }

  async delete(key: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    await client.del(key);
  }
}
