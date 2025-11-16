import type {
  HttpClient,
  HttpRequestOptions,
  RequestOutcome,
} from "@tradentic/resilient-http-core";

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

async function runPagination<TItem, TRaw>(
  options: PaginateOptions<TItem, TRaw> & { stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean; yieldPages?: boolean }
): Promise<{ result: PaginationResult<TItem, TRaw>; yieldedPages: Page<TItem, TRaw>[]; outcomes: RequestOutcome[] }> {
  const { client, extractor, strategy, observer, decoder = defaultDecoder, stopWhen } = options;
  const limits = getLimits(options.limits);
  const startTime = Date.now();
  const pages: Page<TItem, TRaw>[] = [];
  const outcomes: RequestOutcome[] = [];
  let items: TItem[] = [];
  let request = options.initialRequest;
  let truncated = false;
  let truncationReason: PaginationResult<TItem, TRaw>["truncationReason"];

  const ctx: PaginationObserverContext<TItem, TRaw> = {
    clientName: options.initialRequest.clientName ?? client.getClientName?.() ?? "unknown",
    operation: options.initialRequest.operation ?? "unknown",
    limits,
  };
  if (observer?.onStart) {
    await observer.onStart(ctx);
  }

  for (let pageIndex = 0; pageIndex < limits.maxPages; pageIndex += 1) {
    const durationMs = Date.now() - startTime;
    if (durationMs > limits.maxDurationMs) {
      truncated = true;
      truncationReason = "maxDurationMs";
      break;
    }
    if (items.length >= limits.maxItems) {
      truncated = true;
      truncationReason = "maxItems";
      break;
    }

    const response = await client.requestRaw(request);
    const raw = await decoder.decode(response);
    const extraction = extractor.extractPage(raw, pageIndex);
    const page: Page<TItem, TRaw> = {
      index: pageIndex,
      items: extraction.items ?? [],
      raw: extraction.raw,
      request,
    };
    pages.push(page);
    items = items.concat(page.items);

    const outcome: RequestOutcome = (response as any).outcome ?? {
      status: response.status,
      attempts: 1,
      durationMs: 0,
    };
    outcomes.push(outcome);

    if (observer?.onPage) {
      await observer.onPage(page, outcome);
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
    request = { ...decision.nextRequest };
  }

  const durationMs = Date.now() - startTime;
  const result: PaginationResult<TItem, TRaw> = {
    pages,
    items,
    pageCount: pages.length,
    itemCount: items.length,
    pageOutcomes: outcomes,
    aggregateOutcome: outcomes[outcomes.length - 1],
    truncated,
    truncationReason,
    durationMs,
  };

  if (observer?.onComplete) {
    await observer.onComplete(result);
  }

  return { result, yieldedPages: pages, outcomes };
}

export async function paginate<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>> {
  const { result } = await runPagination({ ...options });
  return result;
}

export async function* paginateStream<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): AsyncGenerator<Page<TItem, TRaw>, PaginationResult<TItem, TRaw>, void> {
  const { result, yieldedPages } = await runPagination({ ...options, yieldPages: true });
  for (const page of yieldedPages) {
    yield page;
  }
  return result;
}

export function createOffsetLimitStrategy(config: OffsetLimitConfig): PaginationStrategy {
  const offsetParam = config.offsetParam ?? "offset";
  const limitParam = config.limitParam ?? "limit";
  return {
    getNextPage({ pageIndex, lastRequest }) {
      const nextOffset = (pageIndex + 1) * config.pageSize;
      const query = { ...(lastRequest.query as Record<string, unknown> | undefined) };
      query[offsetParam] = nextOffset;
      query[limitParam] = config.pageSize;
      const nextRequest: HttpRequestOptions = {
        ...lastRequest,
        query,
      };
      return { hasNext: true, nextRequest };
    },
  };
}

export function createCursorStrategy(config: CursorConfig): PaginationStrategy {
  return {
    getNextPage({ pageIndex, lastExtraction, lastRequest }) {
      if (pageIndex < 0) return { hasNext: false };
      const nextCursor = config.getNextCursor(lastExtraction.raw, pageIndex);
      if (nextCursor == null) {
        return { hasNext: false };
      }
      const query = { ...(lastRequest.query as Record<string, unknown> | undefined) };
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
  const { result } = await runPagination({ ...options, stopWhen: options.stopWhen });
  return result;
}

