import type { UnusualWhalesClient } from '@libs/unusualwhales-client';
import { createUnusualWhalesClientFromEnv } from '@libs/unusualwhales-client';
import { RedisRateLimiter } from './redisRateLimiter';
import { RedisApiCache } from './redisApiCache';

let cachedClient: UnusualWhalesClient | null = null;

export function createUnusualWhalesClient(): UnusualWhalesClient {
  if (!cachedClient) {
    const maxRps = Number(process.env.MAX_RPS_UNUSUALWHALES || '10');
    const rateLimiter = new RedisRateLimiter('unusualwhales-api', maxRps);
    const cache = new RedisApiCache();
    cachedClient = createUnusualWhalesClientFromEnv({ rateLimiter, cache });
  }

  return cachedClient;
}

export type { UnusualWhalesClient } from '@libs/unusualwhales-client';
