import { RateLimiter } from './rateLimit.ts';

export interface UnusualWhalesConfig {
  apiKey: string;
  baseUrl: string;
  maxRps: number;
}

export class UnusualWhalesClient {
  private limiter: RateLimiter;

  constructor(private readonly config: UnusualWhalesConfig) {
    this.limiter = new RateLimiter(config.maxRps);
  }

  async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    await this.limiter.throttle();

    const url = new URL(path, this.config.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`UnusualWhales API request failed ${response.status}: ${errorText}`);
    }

    return await response.json() as T;
  }
}

export function createUnusualWhalesClient(): UnusualWhalesClient {
  const apiKey = process.env.UNUSUALWHALES_API_KEY;
  const baseUrl = process.env.UNUSUALWHALES_BASE_URL || 'https://api.unusualwhales.com';
  const maxRps = Number(process.env.MAX_RPS_UNUSUALWHALES || '10');

  if (!apiKey) {
    throw new Error('UNUSUALWHALES_API_KEY environment variable is required');
  }

  return new UnusualWhalesClient({ apiKey, baseUrl, maxRps });
}
