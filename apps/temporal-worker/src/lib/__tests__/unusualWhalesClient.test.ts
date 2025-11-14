import { beforeEach, describe, expect, it, vi } from 'vitest';

const throttleSpy = vi.fn();
const createDistributedRateLimiterMock = vi.fn(() => ({ throttle: throttleSpy }));
const createUnusualWhalesClientFromEnvMock = vi.fn().mockReturnValue({ client: true });

vi.mock('../distributedRateLimit', () => ({
  createDistributedRateLimiter: createDistributedRateLimiterMock,
  DistributedRateLimiter: class {},
}));

vi.mock('@libs/unusualwhales-client', () => ({
  createUnusualWhalesClientFromEnv: createUnusualWhalesClientFromEnvMock,
}));

describe('createUnusualWhalesClient', () => {
  beforeEach(() => {
    throttleSpy.mockClear();
    createDistributedRateLimiterMock.mockClear();
    createUnusualWhalesClientFromEnvMock.mockClear();
    process.env.MAX_RPS_UNUSUALWHALES = '15';
  });

  it('wires distributed rate limiter into shared client factory', async () => {
    const { createUnusualWhalesClient } = await import('../unusualWhalesClient');

    createUnusualWhalesClient();

    expect(createDistributedRateLimiterMock).toHaveBeenCalledWith('unusualwhales-api', 15);
    expect(createUnusualWhalesClientFromEnvMock).toHaveBeenCalledTimes(1);
    const args = createUnusualWhalesClientFromEnvMock.mock.calls[0][0];
    expect(args.rateLimiter).toBeDefined();

    await args.rateLimiter!.throttle();
    expect(throttleSpy).toHaveBeenCalledTimes(1);
  });
});
