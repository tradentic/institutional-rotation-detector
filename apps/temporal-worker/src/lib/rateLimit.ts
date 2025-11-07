export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastTs = 0;

  constructor(private readonly maxPerSecond: number) {
    if (maxPerSecond <= 0) {
      throw new Error('maxPerSecond must be > 0');
    }
    this.minIntervalMs = 1000 / maxPerSecond;
  }

  async throttle(now = Date.now()): Promise<void> {
    const elapsed = now - this.lastTs;
    const waitMs = this.minIntervalMs - elapsed;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastTs = Date.now();
    } else {
      this.lastTs = now;
    }
  }
}
