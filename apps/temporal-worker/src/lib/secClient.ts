import { RateLimiter } from './rateLimit';

export interface SecClientConfig {
  baseUrl: string;
  dataApiBaseUrl: string;
  userAgent: string;
  maxRps: number;
}

export class SecClient {
  private limiter: RateLimiter;

  constructor(private readonly config: SecClientConfig) {
    this.limiter = new RateLimiter(config.maxRps);
  }

  async get(path: string, init?: RequestInit): Promise<Response> {
    await this.limiter.throttle();
    // Use dataApiBaseUrl for /submissions/ endpoints, otherwise use main baseUrl
    const base = path.startsWith('/submissions/') ? this.config.dataApiBaseUrl : this.config.baseUrl;
    const url = new URL(path, base).toString();

    // Debug logging
    console.log('[SecClient] Fetching:', {
      path,
      base,
      finalUrl: url,
      baseUrl: this.config.baseUrl,
      dataApiBaseUrl: this.config.dataApiBaseUrl,
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept-Encoding': 'gzip, deflate',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      console.error('[SecClient] Request failed:', {
        url,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`SEC request failed ${response.status}`);
    }
    return response;
  }
}

export function createSecClient(): SecClient {
  // Main SEC site for /files/, /Archives/, etc.
  const baseUrl = process.env.EDGAR_BASE ?? 'https://www.sec.gov';
  // Data API for /submissions/ endpoint
  const dataApiBaseUrl = process.env.EDGAR_DATA_API_BASE ?? 'https://data.sec.gov';
  // Support both SEC_USER_AGENT and EDGAR_USER_AGENT for backwards compatibility
  const userAgent = process.env.SEC_USER_AGENT ?? process.env.EDGAR_USER_AGENT;
  const maxRps = Number(process.env.MAX_RPS_EDGAR ?? '8');

  // Debug logging
  console.log('[SecClient] Configuration:', {
    baseUrl,
    dataApiBaseUrl,
    userAgent: userAgent ? '[SET]' : '[NOT SET]',
    maxRps,
    envVars: {
      EDGAR_BASE: process.env.EDGAR_BASE || '[using default]',
      EDGAR_DATA_API_BASE: process.env.EDGAR_DATA_API_BASE || '[using default]',
      SEC_USER_AGENT: process.env.SEC_USER_AGENT ? '[SET]' : '[NOT SET]',
      EDGAR_USER_AGENT: process.env.EDGAR_USER_AGENT ? '[SET]' : '[NOT SET]',
    },
  });

  if (!userAgent) {
    throw new Error('SEC_USER_AGENT or EDGAR_USER_AGENT environment variable is required');
  }
  return new SecClient({ baseUrl, dataApiBaseUrl, userAgent, maxRps });
}
