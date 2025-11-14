import { setTimeout as delay } from 'timers/promises';

const DEFAULT_BASE_URL = 'https://api.unusualwhales.com';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

export interface RateLimiter {
  throttle(): Promise<void>;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  method?: string;
  body?: BodyInit | null;
  params?: QueryParams;
  timeoutMs?: number;
}

export interface UnusualWhalesClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
}

export class UnusualWhalesRequestError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`UnusualWhales API request failed ${status}: ${body}`);
    this.name = 'UnusualWhalesRequestError';
  }
}

export class UnusualWhalesClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly config: UnusualWhalesClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.params);
    const method = options.method ?? 'GET';
    const headers: HeadersInit = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...options.headers,
    };

    const timeout = options.timeoutMs ?? this.config.timeoutMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.config.rateLimiter?.throttle();

      let controller: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;
      let signal = options.signal;

      if (timeout) {
        controller = new AbortController();
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener('abort', () => controller?.abort(), { once: true });
          }
        }
        signal = controller.signal;
        timeoutId = setTimeout(() => controller?.abort(), timeout);
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: options.body ?? null,
          signal,
        });

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const bodyText = await safeReadBody(response);
          if (this.shouldRetry(response.status) && attempt < this.maxRetries) {
            await this.waitForRetry(attempt);
            continue;
          }

          throw new UnusualWhalesRequestError(response.status, bodyText);
        }

        return (await parseJson<T>(response)) as T;
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (attempt < this.maxRetries) {
          await this.waitForRetry(attempt);
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to execute request after retries');
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  // ---------------------------------------------------------------------------
  // Shorts Endpoints
  // ---------------------------------------------------------------------------
  getShortData(ticker: string): Promise<unknown> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/data`);
  }

  getShortFtds(ticker: string): Promise<unknown> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/ftds`);
  }

  getShortInterestAndFloat(ticker: string): Promise<unknown> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/interest-float`);
  }

  getShortVolumeAndRatio(ticker: string): Promise<unknown> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/volume-and-ratio`);
  }

  getShortVolumeByExchange(ticker: string): Promise<unknown> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/volumes-by-exchange`);
  }

  // ---------------------------------------------------------------------------
  // Stock-level options + flow overlays
  // ---------------------------------------------------------------------------
  getOiPerStrike(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-per-strike`, params);
  }

  getOiPerExpiry(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-per-expiry`, params);
  }

  getOiChange(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-change`, params);
  }

  getMaxPain(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/max-pain`, params);
  }

  getNope(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/nope`, params);
  }

  getOhlc(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/ohlc`, params);
  }

  getGreekFlow(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-flow`, params);
  }

  getGreekFlowByExpiry(ticker: string, expiry: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-flow/${encodeURIComponent(expiry)}`, params);
  }

  // ---------------------------------------------------------------------------
  // Group / sector / market overlays
  // ---------------------------------------------------------------------------
  getGroupGreekFlow(flowGroup: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/group-flow/${encodeURIComponent(flowGroup)}/greek-flow`, params);
  }

  getGroupGreekFlowByExpiry(flowGroup: string, expiry: string, params?: QueryParams): Promise<unknown> {
    return this.get(
      `/api/group-flow/${encodeURIComponent(flowGroup)}/greek-flow/${encodeURIComponent(expiry)}`,
      params
    );
  }

  getSectorTickers(sector: string): Promise<unknown> {
    return this.get(`/api/stock/${encodeURIComponent(sector)}/tickers`);
  }

  getMarketTopNetImpact(params?: QueryParams): Promise<unknown> {
    return this.get('/api/market/top-net-impact', params);
  }

  getSectorTide(sector: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/market/${encodeURIComponent(sector)}/sector-tide`, params);
  }

  getMarketSeasonality(params?: QueryParams): Promise<unknown> {
    return this.get('/api/seasonality/market', params);
  }

  getSeasonalityMonthPerformers(month: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/seasonality/${encodeURIComponent(month)}/performers`, params);
  }

  getSeasonalityMonthlyForTicker(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/monthly`, params);
  }

  getSeasonalityYearMonthForTicker(ticker: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/year-month`, params);
  }

  // ---------------------------------------------------------------------------
  // Institutions + holdings
  // ---------------------------------------------------------------------------
  getInstitutionHoldings(name: string, params?: QueryParams): Promise<unknown> {
    return this.get(`/api/institution/${encodeURIComponent(name)}/holdings`, params);
  }

  // ---------------------------------------------------------------------------
  // Screeners / discovery
  // ---------------------------------------------------------------------------
  screenStocks(params?: QueryParams): Promise<unknown> {
    return this.get('/api/screener/stocks', params);
  }

  // ---------------------------------------------------------------------------
  // Flow tape / alerts
  // ---------------------------------------------------------------------------
  getFullTape(params?: QueryParams): Promise<unknown> {
    return this.get('/api/option-trades/full-tape', params);
  }

  getFlowAlerts(params?: QueryParams): Promise<unknown> {
    return this.get('/api/option-trades/flow-alerts', params);
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  private shouldRetry(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async waitForRetry(attempt: number): Promise<void> {
    const delayMs = this.retryDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.retryDelayMs;
    await delay(delayMs + jitter);
  }
}

async function parseJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `Failed to read response body: ${error}`;
  }
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createUnusualWhalesClientFromEnv(
  overrides: Partial<Omit<UnusualWhalesClientConfig, 'apiKey'>> = {}
): UnusualWhalesClient {
  const apiKey = process.env.UNUSUALWHALES_API_KEY;
  if (!apiKey) {
    throw new Error('UNUSUALWHALES_API_KEY environment variable is required');
  }

  const config: UnusualWhalesClientConfig = {
    apiKey,
    baseUrl: overrides.baseUrl ?? process.env.UNUSUALWHALES_BASE_URL ?? DEFAULT_BASE_URL,
    maxRetries:
      overrides.maxRetries ?? parseOptionalNumber(process.env.UNUSUALWHALES_MAX_RETRIES),
    retryDelayMs:
      overrides.retryDelayMs ?? parseOptionalNumber(process.env.UNUSUALWHALES_RETRY_DELAY_MS),
    timeoutMs: overrides.timeoutMs ?? parseOptionalNumber(process.env.UNUSUALWHALES_TIMEOUT_MS),
    rateLimiter: overrides.rateLimiter,
  };

  return new UnusualWhalesClient(config);
}
