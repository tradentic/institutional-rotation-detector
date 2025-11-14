import type { FinraClient } from '@libs/finra-client';
import { createFinraClient } from '@libs/finra-client';
import { RedisRateLimiter } from './redisRateLimiter';
import { RedisApiCache } from './redisApiCache';

let cachedClient: FinraClient | null = null;

export function getFinraClient(): FinraClient {
  if (!cachedClient) {
    const maxRps = Number(process.env.MAX_RPS_FINRA ?? '10');
    const rateLimiter = new RedisRateLimiter('finra-api', maxRps);
    const cache = new RedisApiCache();
    cachedClient = createFinraClient({ rateLimiter, cache });
  }
  return cachedClient;
}
