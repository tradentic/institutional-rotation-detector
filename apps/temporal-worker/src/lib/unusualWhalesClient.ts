import type { RateLimiter, UnusualWhalesClient } from '@libs/unusualwhales-client';
import { createUnusualWhalesClientFromEnv } from '@libs/unusualwhales-client';
import { createDistributedRateLimiter, DistributedRateLimiter } from './distributedRateLimit';

class DistributedRateLimiterAdapter implements RateLimiter {
  constructor(private readonly limiter: DistributedRateLimiter) {}

  async throttle(): Promise<void> {
    await this.limiter.throttle();
  }
}

export function createUnusualWhalesClient(): UnusualWhalesClient {
  const maxRps = Number(process.env.MAX_RPS_UNUSUALWHALES || '10');
  const limiter = createDistributedRateLimiter('unusualwhales-api', maxRps);
  const rateLimiter = new DistributedRateLimiterAdapter(limiter);

  return createUnusualWhalesClientFromEnv({ rateLimiter });
}

export type { UnusualWhalesClient } from '@libs/unusualwhales-client';
