import type { UnusualWhalesClient } from '@libs/unusualwhales-client';
import { createUnusualWhalesClientFromEnv } from '@libs/unusualwhales-client';
import { RedisRateLimiter } from './redisRateLimiter';
import { RedisApiCache } from './redisApiCache';

let cachedClient: UnusualWhalesClient | null = null;

export function createUnusualWhalesClient(): UnusualWhalesClient {
  if (!cachedClient) {
    const maxRps = Number(process.env.MAX_RPS_UNUSUALWHALES || '10');
    const rateLimiter = new RedisRateLimiter({
      identifier: 'unusualwhales-api',
      maxPerSecond: maxRps,
      namespace: 'ratelimit',
      failOpen: true,
    });
    const cache = new RedisApiCache({ namespace: 'uw', failOpen: true });
    cachedClient = createUnusualWhalesClientFromEnv({
      rateLimiter,
      cache,
      defaultCacheTtls: {
        seasonalityMs: 60 * 60 * 1000,
        exposureMs: 5 * 60 * 1000,
        ohlcHistoricalMs: 5 * 60 * 1000,
      },
    });
  }

  return cachedClient;
}

export type { UnusualWhalesClient } from '@libs/unusualwhales-client';
