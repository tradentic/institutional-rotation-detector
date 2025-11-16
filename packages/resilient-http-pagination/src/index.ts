import { type ErrorCategory, HttpClient, type HttpRequestOptions, type RequestOutcome, type UrlParts } from '@airnub/resilient-http-core';

export interface Page<TItem = unknown, TRaw = unknown> {
  index: number;
  items: TItem[];
  raw: TRaw;
  request: HttpRequestOptions;
}

export interface PaginationResult<TItem = unknown, TRaw = unknown> {
  pages: Page<TItem, TRaw>[];
  items: TItem[];
  pageCount: number;
  itemCount: number;
  pageOutcomes: RequestOutcome[];
  aggregateOutcome?: RequestOutcome;
  truncated: boolean;
  truncationReason?: 'maxPages' | 'maxItems' | 'maxDurationMs' | 'error';
  durationMs: number;
}

export interface PaginationLimits {
  maxPages?: number;
  maxItems?: number;
  maxDurationMs?: number;
}

export type PaginationModel = 'offsetLimit' | 'cursor' | 'linkHeader' | 'pageNumber' | 'custom';

export interface PageExtraction<TItem = unknown, TRaw = unknown> {
  items: TItem[];
  raw: TRaw;
  state?: unknown;
}

export interface PageExtractor<TItem = unknown, TRaw = unknown> {
  extractPage(raw: unknown, pageIndex: number): PageExtraction<TItem, TRaw>;
}

export interface PaginationStrategyContext {
  pageIndex: number;
  lastExtraction: PageExtraction<any, any>;
  lastRequest: HttpRequestOptions;
}

export interface NextPageDecision {
  hasNext: boolean;
  nextRequest?: HttpRequestOptions;
}

export interface PaginationStrategy {
  getNextPage(context: PaginationStrategyContext): NextPageDecision;
}

export interface PaginationObserverContext<TItem = unknown, TRaw = unknown> {
  clientName: string;
  operation: string;
  limits: Required<PaginationLimits>;
}

export interface PaginationObserver<TItem = unknown, TRaw = unknown> {
  onStart?(ctx: PaginationObserverContext<TItem, TRaw>): void | Promise<void>;
  onPage?(page: Page<TItem, TRaw>, outcome: RequestOutcome): void | Promise<void>;
  onComplete?(result: PaginationResult<TItem, TRaw>): void | Promise<void>;
}

export interface JsonDecoder<TRaw = unknown> {
  decode(response: Response): Promise<TRaw>;
}

export interface PaginateOptions<TItem = unknown, TRaw = unknown> {
  client: HttpClient;
  initialRequest: HttpRequestOptions;
  model: PaginationModel;
  strategy: PaginationStrategy;
  extractor: PageExtractor<TItem, TRaw>;
  limits?: PaginationLimits;
  observer?: PaginationObserver<TItem, TRaw>;
  decoder?: JsonDecoder<TRaw>;
}

export async function paginate<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>,
): Promise<PaginationResult<TItem, TRaw>> {
  const runner = runPaginationGenerator(options);
  let next = await runner.next();
  while (!next.done) {
    next = await runner.next();
  }
  return next.value;
}

export async function* paginateStream<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>,
): AsyncGenerator<Page<TItem, TRaw>, PaginationResult<TItem, TRaw>, void> {
  const runner = runPaginationGenerator(options);
  try {
    while (true) {
      const { value, done } = await runner.next();
      if (done) return value;
      yield value;
    }
  } finally {
    await runner.return?.();
  }
}

const OFFSET_STRATEGY_SYMBOL = Symbol('offsetLimitConfig');

export interface OffsetLimitConfig {
  offsetParam?: string;
  limitParam?: string;
  pageSize: number;
}

export function createOffsetLimitStrategy(config: OffsetLimitConfig): PaginationStrategy {
  const offsetParam = config.offsetParam ?? 'offset';
  const limitParam = config.limitParam ?? 'limit';
  const pageSize = config.pageSize;

  const strategy: PaginationStrategy & { [OFFSET_STRATEGY_SYMBOL]: OffsetLimitConfig } = {
    [OFFSET_STRATEGY_SYMBOL]: config,
    getNextPage({ pageIndex, lastExtraction, lastRequest }) {
      const hasItems = (lastExtraction.items ?? []).length > 0;
      if (!hasItems) return { hasNext: false };
      const nextOffset = (pageIndex + 1) * pageSize;
      const nextRequest = withPagingParams(lastRequest, {
        [offsetParam]: nextOffset,
        [limitParam]: pageSize,
      });
      return { hasNext: true, nextRequest };
    },
  };

  return strategy;
}

export interface CursorConfig {
  cursorParam: string;
  getNextCursor(raw: unknown, pageIndex: number): string | null | undefined;
}

export function createCursorStrategy(config: CursorConfig): PaginationStrategy {
  return {
    getNextPage({ pageIndex, lastExtraction, lastRequest }) {
      const cursor = config.getNextCursor(lastExtraction.raw, pageIndex);
      if (cursor === undefined || cursor === null) {
        return { hasNext: false };
      }

      const nextRequest = withPagingParams(lastRequest, { [config.cursorParam]: cursor });
      return { hasNext: true, nextRequest };
    },
  };
}

export interface ArrayFieldExtractorConfig<TItem = unknown, TRaw = any> {
  itemsPath: string;
}

export function createArrayFieldExtractor<TItem = unknown, TRaw = any>(
  config: ArrayFieldExtractorConfig<TItem, TRaw>,
): PageExtractor<TItem, TRaw> {
  return {
    extractPage(raw: unknown) {
      if (raw === null || typeof raw !== 'object') {
        return { raw: raw as TRaw, items: [] };
      }
      const value = getPath(raw as Record<string, unknown>, config.itemsPath);
      const items = Array.isArray(value) ? (value as TItem[]) : [];
      return { raw: raw as TRaw, items };
    },
  };
}

export interface PaginateOffsetLimitOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, 'model' | 'strategy'> {
  offsetConfig: OffsetLimitConfig;
}

export function paginateOffsetLimit<TItem = unknown, TRaw = any>(
  options: PaginateOffsetLimitOptions<TItem, TRaw>,
): Promise<PaginationResult<TItem, TRaw>> {
  return paginate({
    ...options,
    model: 'offsetLimit',
    strategy: createOffsetLimitStrategy(options.offsetConfig),
  });
}

export interface PaginateCursorOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, 'model' | 'strategy'> {
  cursorConfig: CursorConfig;
}

export function paginateCursor<TItem = unknown, TRaw = any>(
  options: PaginateCursorOptions<TItem, TRaw>,
): Promise<PaginationResult<TItem, TRaw>> {
  return paginate({
    ...options,
    model: 'cursor',
    strategy: createCursorStrategy(options.cursorConfig),
  });
}

export interface PaginateUntilOptions<TItem = unknown, TRaw = any>
  extends PaginateOptions<TItem, TRaw> {
  stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean;
}

export async function paginateUntil<TItem = unknown, TRaw = any>(
  options: PaginateUntilOptions<TItem, TRaw>,
): Promise<PaginationResult<TItem, TRaw>> {
  const runner = runPaginationGenerator(options, options.stopWhen);
  let next = await runner.next();
  while (!next.done) {
    next = await runner.next();
  }
  return next.value;
}

function defaultDecoder<TRaw>(): JsonDecoder<TRaw> {
  return {
    decode: (response: Response) => response.json() as Promise<TRaw>,
  };
}

function normalizeLimits(limits?: PaginationLimits): Required<PaginationLimits> {
  return {
    maxPages: limits?.maxPages ?? Infinity,
    maxItems: limits?.maxItems ?? Infinity,
    maxDurationMs: limits?.maxDurationMs ?? Infinity,
  } as Required<PaginationLimits>;
}

function cloneRequestOptions(source: HttpRequestOptions): HttpRequestOptions {
  return {
    ...source,
    headers: source.headers ? { ...source.headers } : undefined,
    urlParts: source.urlParts
      ? { ...source.urlParts, query: source.urlParts.query ? { ...source.urlParts.query } : undefined }
      : undefined,
    correlation: source.correlation ? { ...source.correlation } : undefined,
    agentContext: source.agentContext ? { ...source.agentContext } : undefined,
    extensions: source.extensions ? { ...source.extensions } : undefined,
    resilience: source.resilience ? { ...source.resilience } : undefined,
  };
}

function mergeUrlParts(base?: UrlParts, override?: UrlParts): UrlParts | undefined {
  if (!base && !override) return undefined;
  return {
    ...base,
    ...override,
    query: { ...(base?.query ?? {}), ...(override?.query ?? {}) },
  };
}

function inheritRequestDefaults(next: HttpRequestOptions, previous: HttpRequestOptions): HttpRequestOptions {
  const clonedPrevious = cloneRequestOptions(previous);
  const merged: HttpRequestOptions = {
    ...clonedPrevious,
    ...next,
    headers: { ...(clonedPrevious.headers ?? {}), ...(next.headers ?? {}) },
    urlParts: mergeUrlParts(clonedPrevious.urlParts, next.urlParts),
    correlation: next.correlation ?? clonedPrevious.correlation,
    agentContext: next.agentContext ?? clonedPrevious.agentContext,
    extensions: next.extensions ?? clonedPrevious.extensions,
    resilience: next.resilience ?? clonedPrevious.resilience,
  };

  if (!merged.url && !merged.urlParts && previous.url) {
    merged.url = previous.url;
  }

  return merged;
}

function withPagingParams(request: HttpRequestOptions, params: Record<string, string | number | boolean>): HttpRequestOptions {
  const nextRequest = cloneRequestOptions(request);

  if (nextRequest.urlParts) {
    nextRequest.urlParts = {
      ...nextRequest.urlParts,
      query: { ...(nextRequest.urlParts.query ?? {}), ...params },
    };
    return nextRequest;
  }

  if (nextRequest.url) {
    const url = new URL(nextRequest.url, 'http://placeholder');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    nextRequest.url = nextRequest.url.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
    return nextRequest;
  }

  nextRequest.urlParts = { query: { ...params } };
  return nextRequest;
}

function ensureInitialRequest(options: PaginateOptions<any, any>): HttpRequestOptions {
  const cloned = cloneRequestOptions(options.initialRequest);
  if (isOffsetStrategy(options.strategy)) {
    const offsetParam = options.strategy[OFFSET_STRATEGY_SYMBOL].offsetParam ?? 'offset';
    const limitParam = options.strategy[OFFSET_STRATEGY_SYMBOL].limitParam ?? 'limit';
    const pageSize = options.strategy[OFFSET_STRATEGY_SYMBOL].pageSize;
    return withPagingParams(cloned, { [offsetParam]: 0, [limitParam]: pageSize });
  }
  return cloned;
}

async function* runPaginationGenerator<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>,
  stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean,
): AsyncGenerator<Page<TItem, TRaw>, PaginationResult<TItem, TRaw>, void> {
  const limits = normalizeLimits(options.limits);
  const decoder = options.decoder ?? defaultDecoder<TRaw>();
  const observer = options.observer;
  const startTime = Date.now();
  const pages: Page<TItem, TRaw>[] = [];
  const items: TItem[] = [];
  const pageOutcomes: RequestOutcome[] = [];
  let truncated = false;
  let truncationReason: PaginationResult<TItem, TRaw>['truncationReason'];

  const clientName = options.client.getClientName?.() ?? 'unknown';
  await observer?.onStart?.({ clientName, operation: options.initialRequest.operation, limits });

  let currentRequest = ensureInitialRequest(options);

  while (true) {
    const elapsed = Date.now() - startTime;
    if (pages.length >= limits.maxPages) {
      truncated = true;
      truncationReason = 'maxPages';
      break;
    }
    if (items.length >= limits.maxItems) {
      truncated = true;
      truncationReason = 'maxItems';
      break;
    }
    if (elapsed >= limits.maxDurationMs) {
      truncated = true;
      truncationReason = 'maxDurationMs';
      break;
    }

    const pageIndex = pages.length;
    const requestStart = Date.now();
    const response = await options.client.requestRaw(currentRequest);
    const raw = await decoder.decode(response);
    const extraction = options.extractor.extractPage(raw, pageIndex);

    const page: Page<TItem, TRaw> = {
      index: pageIndex,
      items: extraction.items ?? [],
      raw: extraction.raw,
      request: currentRequest,
    };

    const outcome = createOutcome(response, requestStart);

    pages.push(page);
    items.push(...page.items);
    pageOutcomes.push(outcome);

    await observer?.onPage?.(page, outcome);

    yield page;

    if (items.length >= limits.maxItems) {
      truncated = true;
      truncationReason = 'maxItems';
      break;
    }

    if (Date.now() - startTime >= limits.maxDurationMs) {
      truncated = true;
      truncationReason = 'maxDurationMs';
      break;
    }

    if (pages.length >= limits.maxPages) {
      truncated = true;
      truncationReason = 'maxPages';
      break;
    }

    if (stopWhen && page.items.some((item) => stopWhen(item, page))) {
      truncated = true;
      truncationReason = 'maxItems';
      break;
    }

    const decision = options.strategy.getNextPage({
      pageIndex,
      lastExtraction: extraction,
      lastRequest: currentRequest,
    });

    if (!decision.hasNext || !decision.nextRequest) {
      break;
    }

    currentRequest = inheritRequestDefaults(decision.nextRequest, currentRequest);
  }

  const durationMs = Date.now() - startTime;
  const pageCount = pages.length;
  const itemCount = items.length;
  const aggregateOutcome = pageOutcomes[pageOutcomes.length - 1];

  const result: PaginationResult<TItem, TRaw> = {
    pages,
    items,
    pageCount,
    itemCount,
    pageOutcomes,
    aggregateOutcome,
    truncated,
    truncationReason,
    durationMs,
  };

  await observer?.onComplete?.(result);
  return result;
}

function createOutcome(response: Response, startedAt: number): RequestOutcome {
  const finishedAt = Date.now();
  const ok = response.ok;
  const errorCategory: ErrorCategory = ok ? 'none' : 'unknown';
  return {
    ok,
    status: response.status,
    errorCategory,
    attempts: 1,
    startedAt,
    finishedAt,
  };
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function isOffsetStrategy(strategy: PaginationStrategy): strategy is PaginationStrategy & {
  [OFFSET_STRATEGY_SYMBOL]: OffsetLimitConfig;
} {
  return OFFSET_STRATEGY_SYMBOL in strategy;
}
