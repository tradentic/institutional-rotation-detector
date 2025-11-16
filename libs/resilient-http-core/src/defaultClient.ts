import { HttpClient } from './HttpClient';
import { fetchTransport } from './transport/fetchTransport';
import type {
  HttpMethod,
  HttpRequestOptions,
  Logger,
  MetricsSink,
  ResilienceProfile,
  TracingAdapter,
} from './types';

export interface DefaultHttpClientConfig {
  clientName: string;
  baseUrl?: string;
  /** Optional override for console logger. */
  logger?: Logger;
}

const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS']);

const consoleLogger: Logger = {
  log(level, message, meta) {
    const fn = console[level] ?? console.log;
    meta ? fn(`[${level}] ${message}`, meta) : fn(`[${level}] ${message}`);
  },
};

const noopMetrics: MetricsSink = {
  recordRequest: () => {
    /* no-op */
  },
};

const noopTracing: TracingAdapter = {
  startSpan: () => ({
    setAttribute: () => {
      /* no-op */
    },
    recordException: () => {
      /* no-op */
    },
    end: () => {
      /* no-op */
    },
  }),
};

const DEFAULT_RESILIENCE: ResilienceProfile = {
  maxAttempts: 1,
  perAttemptTimeoutMs: 10_000,
  overallTimeoutMs: 25_000,
};

class DefaultingHttpClient extends HttpClient {
  constructor(private readonly resilienceDefaults: ResilienceProfile, config: ConstructorParameters<typeof HttpClient>[0]) {
    super(config);
  }

  private applyResilienceDefaults(opts: HttpRequestOptions): HttpRequestOptions {
    const resilience = { ...opts.resilience } as ResilienceProfile;
    const isIdempotent = opts.idempotent ?? IDEMPOTENT_METHODS.has(opts.method);

    if (resilience.perAttemptTimeoutMs === undefined) {
      resilience.perAttemptTimeoutMs = this.resilienceDefaults.perAttemptTimeoutMs;
    }
    if (resilience.overallTimeoutMs === undefined) {
      resilience.overallTimeoutMs = this.resilienceDefaults.overallTimeoutMs;
    }
    if (resilience.maxAttempts === undefined) {
      resilience.maxAttempts = isIdempotent ? 3 : 1;
    }

    return {
      ...opts,
      resilience,
    } satisfies HttpRequestOptions;
  }

  override requestRaw(opts: HttpRequestOptions): Promise<Response> {
    return super.requestRaw(this.applyResilienceDefaults(opts));
  }

  override requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    return super.requestJson<T>(this.applyResilienceDefaults(opts));
  }

  override requestText(opts: HttpRequestOptions): Promise<string> {
    return super.requestText(this.applyResilienceDefaults(opts));
  }

  override requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    return super.requestArrayBuffer(this.applyResilienceDefaults(opts));
  }
}

export function createDefaultHttpClient(config: DefaultHttpClientConfig): HttpClient {
  return new DefaultingHttpClient(DEFAULT_RESILIENCE, {
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    transport: fetchTransport,
    defaultResilience: DEFAULT_RESILIENCE,
    logger: config.logger ?? consoleLogger,
    metrics: noopMetrics,
    tracing: noopTracing,
  });
}
