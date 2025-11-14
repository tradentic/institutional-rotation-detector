import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClientMock = vi.fn();
const redisInstance = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock('../redisClient', () => ({
  getRedisCache: () => ({
    getClient: () => getClientMock(),
  }),
  redisDebugLog: vi.fn(),
}));

const distributedThrottle = vi.fn().mockResolvedValue(undefined);

vi.mock('../distributedRateLimit', () => ({
  createDistributedRateLimiter: vi.fn().mockReturnValue({ throttle: distributedThrottle }),
}));

const { RedisApiCache } = await import('../redisApiCache');
const { RedisRateLimiter } = await import('../redisRateLimiter');

describe('RedisApiCache', () => {
  beforeEach(() => {
    getClientMock.mockReturnValue(redisInstance);
    redisInstance.get.mockReset();
    redisInstance.set.mockReset();
    redisInstance.del.mockReset();
  });

  it('namespaces keys and swallows errors in fail-open mode', async () => {
    redisInstance.get.mockRejectedValue(new Error('boom'));
    const cache = new RedisApiCache({ namespace: 'test', failOpen: true });

    await expect(cache.get('key')).resolves.toBeUndefined();

    expect(redisInstance.get).toHaveBeenCalledWith('test:key');
  });

  it('throws when failOpen is false and Redis client is unavailable', async () => {
    getClientMock.mockReturnValueOnce(null);
    const cache = new RedisApiCache({ failOpen: false });

    await expect(cache.get('key')).rejects.toThrow('Redis cache client unavailable');
  });

  it('sets and deletes namespaced keys', async () => {
    const cache = new RedisApiCache({ namespace: 'finra', failOpen: false });
    await cache.set('k', { value: 1 }, 1000);
    await cache.delete('k');

    expect(redisInstance.set).toHaveBeenCalledWith('finra:k', JSON.stringify({ value: 1 }), 'PX', 1000);
    expect(redisInstance.del).toHaveBeenCalledWith('finra:k');
  });
});

describe('RedisRateLimiter', () => {
  beforeEach(() => {
    getClientMock.mockReturnValue(redisInstance);
    redisInstance.get.mockReset();
    redisInstance.set.mockReset();
    redisInstance.del.mockReset();
    distributedThrottle.mockClear();
  });

  it('writes cooldown keys using namespace and identifier', async () => {
    const limiter = new RedisRateLimiter({
      identifier: 'openai-api',
      maxPerSecond: 1,
      namespace: 'ratelimit',
      failOpen: true,
    });

    await limiter.onError('key', { status: 429, retryAfterMs: 50 } as any);

    expect(redisInstance.set).toHaveBeenCalledWith(
      'ratelimit:openai-api:cooldown:key',
      expect.any(String),
      'PX',
      50,
    );
  });

  it('throws when failOpen is false and Redis client is missing', async () => {
    getClientMock.mockReturnValueOnce(null);
    const limiter = new RedisRateLimiter({
      identifier: 'finra-api',
      maxPerSecond: 1,
      namespace: 'ratelimit',
      failOpen: false,
    });

    await expect(limiter.throttle('key')).rejects.toThrow('Redis client unavailable for rate limiter');
  });

  it('waits for cooldowns before delegating to distributed limiter', async () => {
    redisInstance.get.mockResolvedValue(String(Date.now() + 5));
    const limiter = new RedisRateLimiter({
      identifier: 'uw-api',
      maxPerSecond: 1,
      namespace: 'ratelimit',
      failOpen: true,
    });

    await limiter.throttle('key');

    expect(distributedThrottle).toHaveBeenCalledTimes(1);
  });
});
