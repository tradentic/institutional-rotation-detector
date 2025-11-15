import { describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '../HttpClient';
import { paginateAll, paginateIterator } from '../pagination';
import type { HttpRequestOptions } from '../types';
import type { PaginationState } from '../pagination';

type TestPage = { cursor: string | null; items: number[] };

const createClient = (pages: TestPage[]) => {
  const requestJson = vi.fn<[HttpRequestOptions], Promise<TestPage>>();
  pages.forEach((page) => requestJson.mockResolvedValueOnce(page));
  return { client: { requestJson } as unknown as HttpClient, requestJson };
};

const baseRequest: HttpRequestOptions = {
  method: 'GET',
  path: '/resources',
  operation: 'paginate.test',
};

describe('paginateAll', () => {
  it('collects items until getNextRequest returns null', async () => {
    const pages: TestPage[] = [
      { cursor: 'cursor-1', items: [1, 2] },
      { cursor: null, items: [3] },
    ];
    const { client, requestJson } = createClient(pages);

    const result = await paginateAll<TestPage, number>(client, {
      initial: baseRequest,
      extractItems: (page) => page.items,
      getNextRequest: (lastPage) => (lastPage?.cursor ? { ...baseRequest, query: { cursor: lastPage.cursor } } : null),
    });

    expect(result).toEqual({ items: [1, 2, 3], pages: 2 });
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('stops when maxPages is reached even if more pages are available', async () => {
    const pages: TestPage[] = [
      { cursor: 'cursor-1', items: [1, 2] },
      { cursor: 'cursor-2', items: [3, 4] },
    ];
    const { client, requestJson } = createClient(pages);

    const result = await paginateAll<TestPage, number>(client, {
      initial: baseRequest,
      extractItems: (page) => page.items,
      getNextRequest: (lastPage) => ({ ...baseRequest, query: { cursor: lastPage?.cursor ?? null } }),
      maxPages: 1,
    });

    expect(result).toEqual({ items: [1, 2], pages: 1 });
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('stops when maxItems is reached', async () => {
    const pages: TestPage[] = [
      { cursor: 'cursor-1', items: [1, 2] },
      { cursor: 'cursor-2', items: [3, 4] },
      { cursor: null, items: [5] },
    ];
    const { client, requestJson } = createClient(pages);

    const result = await paginateAll<TestPage, number>(client, {
      initial: baseRequest,
      extractItems: (page) => page.items,
      getNextRequest: (lastPage) => (lastPage?.cursor ? { ...baseRequest, query: { cursor: lastPage.cursor } } : null),
      maxItems: 3,
    });

    expect(result.items).toEqual([1, 2, 3, 4]);
    expect(result.pages).toBe(2);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });
});

describe('paginateIterator', () => {
  it('yields each page until the continuation returns null', async () => {
    const pages: TestPage[] = [
      { cursor: 'cursor-1', items: [1, 2] },
      { cursor: null, items: [3, 4] },
    ];
    const requestJson = vi.fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1]);
    const client = { requestJson } as unknown as HttpClient;

    const received: TestPage[] = [];
    const getNext = vi
      .fn<
        (lastPage: TestPage | undefined, state: PaginationState<TestPage>) => HttpRequestOptions | null
      >()
      .mockImplementation((lastPage) => (lastPage?.cursor ? { ...baseRequest, query: { cursor: lastPage.cursor } } : null));

    for await (const page of paginateIterator<TestPage>(client, baseRequest, getNext)) {
      received.push(page);
    }

    expect(received).toEqual(pages);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(getNext).toHaveBeenCalledTimes(2);
    expect(getNext).toHaveBeenLastCalledWith(pages[1], expect.objectContaining({ pageIndex: 2 }));
  });
});
