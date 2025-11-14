import { beforeEach, describe, expect, it, vi } from 'vitest';

const throttleSpy = vi.fn();
const redisRateLimiterMock = vi.fn();
const redisCacheMock = vi.fn();
const createUnusualWhalesClientFromEnvMock = vi.fn().mockReturnValue({ client: true });

class RedisRateLimiterDouble {
  public throttle = throttleSpy;

  constructor(...args: unknown[]) {
    redisRateLimiterMock(...args);
  }
}

class RedisApiCacheDouble {
  public get = vi.fn();
  public set = vi.fn();

  constructor(...args: unknown[]) {
    redisCacheMock(...args);
  }
}

vi.mock('../redisRateLimiter', () => ({
  RedisRateLimiter: RedisRateLimiterDouble,
}));

vi.mock('../redisApiCache', () => ({
  RedisApiCache: RedisApiCacheDouble,
}));

vi.mock(
  '@libs/unusualwhales-client',
  () => ({
    createUnusualWhalesClientFromEnv: createUnusualWhalesClientFromEnvMock,
  }),
  { virtual: true }
);

describe('createUnusualWhalesClient', () => {
  beforeEach(() => {
    throttleSpy.mockClear();
    redisRateLimiterMock.mockClear();
    redisCacheMock.mockClear();
    createUnusualWhalesClientFromEnvMock.mockClear();
    process.env.MAX_RPS_UNUSUALWHALES = '15';
  });

  it('wires redis adapters into shared client factory', async () => {
    const { createUnusualWhalesClient } = await import('../unusualWhalesClient');

    createUnusualWhalesClient();

    expect(redisRateLimiterMock).toHaveBeenCalledWith({
      identifier: 'unusualwhales-api',
      maxPerSecond: 15,
      namespace: 'ratelimit',
      failOpen: true,
    });
    expect(redisCacheMock).toHaveBeenCalledWith({ namespace: 'uw', failOpen: true });
    expect(createUnusualWhalesClientFromEnvMock).toHaveBeenCalledTimes(1);
    const args = createUnusualWhalesClientFromEnvMock.mock.calls[0][0];
    expect(args.rateLimiter).toBeDefined();
    expect(args.cache).toBeDefined();

    await args.rateLimiter!.throttle();
    expect(throttleSpy).toHaveBeenCalledTimes(1);
  });
});
