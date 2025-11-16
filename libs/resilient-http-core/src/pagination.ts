import type { HttpClient, HttpRequestOptions } from './types';

export interface PaginationState<TPage> {
  pageIndex: number;
  itemsSoFar: number;
  lastPage?: TPage;
}

export interface PaginationResult<TItem> {
  items: TItem[];
  pages: number;
}

export interface PaginationConfig<TPage, TItem> {
  /** Initial request options (path, method, query, operation, etc.). */
  initial: HttpRequestOptions;

  /**
   * Given the last page and current state, return the next request options
   * or null to stop. This is where you implement offset/cursor logic.
   */
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>,
  ) => HttpRequestOptions | null;

  /** Extracts items from a page (e.g. page.data.items, page.results, etc.). */
  extractItems: (page: TPage) => TItem[];

  /** Soft safety limits to prevent unbounded pagination. */
  maxPages?: number;
  maxItems?: number;
}

export async function paginateAll<TPage, TItem>(
  client: HttpClient,
  config: PaginationConfig<TPage, TItem>,
): Promise<PaginationResult<TItem>> {
  const items: TItem[] = [];
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: HttpRequestOptions | null = config.initial;
  let pages = 0;

  while (nextOpts) {
    const page = await client.requestJson<TPage>(nextOpts);
    const pageItems = config.extractItems(page);

    items.push(...pageItems);
    pages += 1;

    state = {
      pageIndex: state.pageIndex + 1,
      itemsSoFar: items.length,
      lastPage: page,
    };

    if (config.maxPages && pages >= config.maxPages) break;
    if (config.maxItems && items.length >= config.maxItems) break;

    nextOpts = config.getNextRequest(page, state);
  }

  return { items, pages };
}

export async function* paginateIterator<TPage>(
  client: HttpClient,
  initial: HttpRequestOptions,
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>,
  ) => HttpRequestOptions | null,
): AsyncIterable<TPage> {
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: HttpRequestOptions | null = initial;

  while (nextOpts) {
    const page = await client.requestJson<TPage>(nextOpts);
    yield page;

    state = {
      pageIndex: state.pageIndex + 1,
      itemsSoFar: state.itemsSoFar,
      lastPage: page,
    };

    nextOpts = getNextRequest(page, state);
  }
}
