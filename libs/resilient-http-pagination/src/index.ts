import type {
  HttpClient,
  HttpRequestOptions,
  RequestOutcome,
} from "@airnub/resilient-http-core";

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
  truncationReason?: "maxPages" | "maxItems" | "maxDurationMs" | "error";
  durationMs: number;
}

export interface PaginationLimits {
  maxPages?: number;
  maxItems?: number;
  maxDurationMs?: number;
}

export type PaginationModel =
  | "offsetLimit"
  | "cursor"
  | "linkHeader"
  | "pageNumber"
  | "custom";

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

const defaultDecoder: JsonDecoder = {
  decode: (response: Response) => response.json(),
};

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

export interface OffsetLimitConfig {
  offsetParam?: string;
  limitParam?: string;
  pageSize: number;
}

export interface CursorConfig {
  cursorParam: string;
  getNextCursor(raw: unknown, pageIndex: number): string | null | undefined;
}

export interface ArrayFieldExtractorConfig<TItem = unknown, TRaw = any> {
  itemsPath: string;
}

export interface PaginateOffsetLimitOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, "model" | "strategy"> {
  offsetConfig: OffsetLimitConfig;
}

export interface PaginateCursorOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, "model" | "strategy"> {
  cursorConfig: CursorConfig;
}

export interface PaginateUntilOptions<TItem = unknown, TRaw = any>
  extends PaginateOptions<TItem, TRaw> {
  stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean;
}

function getLimits(limits?: PaginationLimits): Required<PaginationLimits> {
  return {
    maxPages: limits?.maxPages ?? Infinity,
    maxItems: limits?.maxItems ?? Infinity,
    maxDurationMs: limits?.maxDurationMs ?? Infinity,
  };
}

function mergeAgentContext(base?: any, next?: any) {
  if (!base && !next) return undefined;
  const labels = { ...(base?.labels ?? {}), ...(next?.labels ?? {}) };
  return { ...base, ...next, labels };
}

function applyRequestDefaults(
  base: HttpRequestOptions,
  next: HttpRequestOptions
): HttpRequestOptions {
  return {
    ...base,
    ...next,
    correlation: next.correlation ?? base.correlation,
    agentContext: mergeAgentContext(base.agentContext, next.agentContext),
    headers: { ...(base.headers as Record<string, string> | undefined), ...(next.headers as Record<string, string> | undefined) },
    query: { ...base.query, ...next.query },
    extensions: { ...(base.extensions ?? {}), ...(next.extensions ?? {}) },
    resilience: { ...(base.resilience ?? {}), ...(next.resilience ?? {}) },
  };
}

type InternalPaginationOptions<TItem, TRaw> = PaginateOptions<TItem, TRaw> & {
  stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean;
};

type PageEmitter<TItem, TRaw> = (page: Page<TItem, TRaw>, outcome: RequestOutcome) => Promise<void>;

function getOutcomeFromResponse(response: Response, startedAt: number): RequestOutcome {
  const finishedAt = Date.now();
  const provided = (response as any).outcome as RequestOutcome | undefined;
  if (provided) {
    return provided;
  }
  return {
    status: response.status,
    ok: response.ok,
    attempts: 1,
    startedAt,
    finishedAt,
  };
}

function buildAggregateOutcome(
  startedAt: number,
  outcomes: RequestOutcome[]
): RequestOutcome | undefined {
  if (outcomes.length === 0) {
    return undefined;
  }

  const finishedAt = outcomes[outcomes.length - 1].finishedAt ?? Date.now();
  const attempts = outcomes.reduce((sum, outcome) => sum + (outcome.attempts ?? 1), 0);
  let rateLimitFeedback: RequestOutcome["rateLimitFeedback"];
  let errorCategory: RequestOutcome["errorCategory"];
  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    if (!rateLimitFeedback && outcomes[i].rateLimitFeedback) {
      rateLimitFeedback = outcomes[i].rateLimitFeedback;
    }
    if (!errorCategory && outcomes[i].errorCategory) {
      errorCategory = outcomes[i].errorCategory;
    }
    if (rateLimitFeedback && errorCategory) break;
  }

  return {
    ok: outcomes.every((outcome) => outcome.ok),
    status: outcomes[outcomes.length - 1].status,
    errorCategory,
    rateLimitFeedback,
    attempts,
    startedAt,
    finishedAt,
  };
}

function applyOffsetLimitDefaults(request: HttpRequestOptions, strategy: PaginationStrategy): HttpRequestOptions {
  const maybeConfig = (strategy as any).__offsetConfig as OffsetLimitConfig | undefined;
  if (!maybeConfig) return request;
  const query = { ...request.query };
  query[maybeConfig.offsetParam ?? "offset"] = 0;
  query[maybeConfig.limitParam ?? "limit"] = maybeConfig.pageSize;
  return { ...request, query };
}

async function runPagination<TItem, TRaw>(
  options: InternalPaginationOptions<TItem, TRaw>,
  emitPage?: PageEmitter<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  const { client, extractor, strategy, observer, decoder = defaultDecoder, stopWhen } = options;
  const limits = getLimits(options.limits);
  const startTime = Date.now();
  const pages: Page<TItem, TRaw>[] = [];
  const outcomes: RequestOutcome[] = [];
  let items: TItem[] = [];
  const baseRequest = options.initialRequest;
  let request = applyOffsetLimitDefaults({ ...baseRequest }, strategy);
  let truncated = false;
  let truncationReason: PaginationResult<TItem, TRaw>["truncationReason"];

  const ctx: PaginationObserverContext<TItem, TRaw> = {
    clientName: options.initialRequest.operation ?? "unknown",
    operation: options.initialRequest.operation ?? "unknown",
    limits,
  };
  if (observer?.onStart) {
    await observer.onStart(ctx);
  }

  for (let pageIndex = 0; ; pageIndex += 1) {
    if (pageIndex >= limits.maxPages) {
      truncated = true;
      truncationReason = "maxPages";
      break;
    }
    const elapsed = Date.now() - startTime;
    if (elapsed > limits.maxDurationMs) {
      truncated = true;
      truncationReason = "maxDurationMs";
      break;
    }
    if (items.length >= limits.maxItems) {
      truncated = true;
      truncationReason = "maxItems";
      break;
    }

    const requestStart = Date.now();
    const response = await client.requestRaw(request);
    const raw = await decoder.decode(response);
    const extraction = extractor.extractPage(raw, pageIndex);
    const page: Page<TItem, TRaw> = {
      index: pageIndex,
      items: extraction.items ?? [],
      raw: extraction.raw,
      request,
    };

    const outcome = getOutcomeFromResponse(response, requestStart);
    pages.push(page);
    outcomes.push(outcome);
    items = items.concat(page.items);

    if (observer?.onPage) {
      await observer.onPage(page, outcome);
    }
    if (emitPage) {
      await emitPage(page, outcome);
    }

    let shouldStop = false;
    if (stopWhen) {
      for (const item of page.items) {
        if (stopWhen(item, page)) {
          shouldStop = true;
          truncated = true;
          truncationReason = "maxItems";
          break;
        }
      }
    }
    if (shouldStop || extraction.items.length === 0) {
      break;
    }
    const decision = strategy.getNextPage({
      pageIndex,
      lastExtraction: extraction,
      lastRequest: request,
    });
    if (!decision.hasNext || !decision.nextRequest) {
      break;
    }
    request = applyRequestDefaults(baseRequest, decision.nextRequest);
  }

  const durationMs = Date.now() - startTime;
  const aggregateOutcome = buildAggregateOutcome(startTime, outcomes);
  const result: PaginationResult<TItem, TRaw> = {
    pages,
    items,
    pageCount: pages.length,
    itemCount: items.length,
    pageOutcomes: outcomes,
    aggregateOutcome,
    truncated,
    truncationReason,
    durationMs,
  };

  if (observer?.onComplete) {
    await observer.onComplete(result);
  }

  return result;
}

export async function paginate<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  return runPagination({ ...options });
}

export async function* paginateStream<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): AsyncGenerator<Page<TItem, TRaw>, PaginationResult<TItem, TRaw>, void> {
  const queue: Page<TItem, TRaw>[] = [];
  let notify: (() => void) | undefined;
  let completed = false;

  const resultPromise = (async () => {
    try {
      const result = await runPagination({ ...options }, async (page) => {
        queue.push(page);
        if (notify) {
          notify();
          notify = undefined;
        }
      });
      return result;
    } finally {
      completed = true;
      if (notify) {
        notify();
        notify = undefined;
      }
    }
  })();

  while (!completed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      continue;
    }
    const next = queue.shift();
    if (next) {
      yield next;
    }
  }

  return await resultPromise;
}

export function createOffsetLimitStrategy(config: OffsetLimitConfig): PaginationStrategy {
  const offsetParam = config.offsetParam ?? "offset";
  const limitParam = config.limitParam ?? "limit";
  const strategy: PaginationStrategy & { __offsetConfig?: OffsetLimitConfig } = {
    getNextPage({ pageIndex, lastRequest, lastExtraction }) {
      const hasItems = (lastExtraction.items ?? []).length > 0;
      if (!hasItems) {
        return { hasNext: false };
      }
      const nextOffset = (pageIndex + 1) * config.pageSize;
      const query = { ...lastRequest.query };
      query[offsetParam] = nextOffset;
      query[limitParam] = config.pageSize;
      const nextRequest: HttpRequestOptions = {
        ...lastRequest,
        query,
      };
      return { hasNext: true, nextRequest };
    },
  };
  strategy.__offsetConfig = config;
  return strategy;
}

export function createCursorStrategy(config: CursorConfig): PaginationStrategy {
  return {
    getNextPage({ pageIndex, lastExtraction, lastRequest }) {
      if (pageIndex < 0) return { hasNext: false };
      const nextCursor = config.getNextCursor(lastExtraction.raw, pageIndex);
      if (nextCursor == null) {
        return { hasNext: false };
      }
      const query = { ...lastRequest.query };
      query[config.cursorParam] = nextCursor;
      const nextRequest: HttpRequestOptions = { ...lastRequest, query };
      return { hasNext: true, nextRequest };
    },
  };
}

export function createArrayFieldExtractor<TItem = unknown, TRaw = any>(
  config: ArrayFieldExtractorConfig<TItem, TRaw>
): PageExtractor<TItem, TRaw> {
  return {
    extractPage(raw: any): PageExtraction<TItem, TRaw> {
      const segments = config.itemsPath.split(".");
      let current: any = raw;
      for (const segment of segments) {
        if (current == null) break;
        current = current[segment];
      }
      const items = Array.isArray(current) ? (current as TItem[]) : [];
      return { items, raw } as PageExtraction<TItem, TRaw>;
    },
  };
}

export async function paginateOffsetLimit<TItem = unknown, TRaw = any>(
  options: PaginateOffsetLimitOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  return paginate({
    ...options,
    model: "offsetLimit",
    strategy: createOffsetLimitStrategy(options.offsetConfig),
  });
}

export async function paginateCursor<TItem = unknown, TRaw = any>(
  options: PaginateCursorOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  return paginate({
    ...options,
    model: "cursor",
    strategy: createCursorStrategy(options.cursorConfig),
  });
}

export async function paginateUntil<TItem = unknown, TRaw = any>(
  options: PaginateUntilOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  return await runPagination({ ...options, stopWhen: options.stopWhen });
}

