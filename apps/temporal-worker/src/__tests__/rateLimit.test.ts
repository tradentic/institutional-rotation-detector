import { beforeEach, describe, expect, test, vi } from 'vitest';
import { RateLimiter } from '../lib/rateLimit.ts';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test('honors max RPS constraint', async () => {
    const limiter = new RateLimiter(2);
    const timestamps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const promise = limiter.throttle(Date.now()).then(() => {
        timestamps.push(Date.now());
      });
      await Promise.resolve();
      vi.advanceTimersByTime(0);
      await promise;
      vi.advanceTimersByTime(500);
    }
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });
});
