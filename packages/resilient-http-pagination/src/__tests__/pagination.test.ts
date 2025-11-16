import { describe, expect, it, vi } from 'vitest';
import type { HttpRequestOptions } from '@airnub/resilient-http-core';
import {
  createArrayFieldExtractor,
  createCursorStrategy,
  paginateOffsetLimit,
  paginateStream,
  type PaginationResult,
} from '../index';
import type { PageExtractor } from '../index';

class FakeHttpClient {
  requests: HttpRequestOptions[] = [];

  constructor(private readonly responses: Array<{ body: any; status?: number }>) {}

  getClientName() {
    return 'fake-client';
  }

  async requestRaw(opts: HttpRequestOptions): Promise<Response> {
    this.requests.push(opts);
    const payloadIndex = Math.min(this.requests.length - 1, this.responses.length - 1);
    const payload = this.responses[payloadIndex];
    return new Response(JSON.stringify(payload.body), { status: payload.status ?? 200 });
  }

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    const response = await this.requestRaw(opts);
    return response.json() as Promise<T>;
  }

  async requestText(opts: HttpRequestOptions): Promise<string> {
    const response = await this.requestRaw(opts);
    return response.text();
  }

  async requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    const response = await this.requestRaw(opts);
    return response.arrayBuffer();
  }
}

describe('pagination', () => {
  const extractor = createArrayFieldExtractor<number>({ itemsPath: 'items' });

  it('enforces maxPages and aggregates outcomes', async () => {
    const client = new FakeHttpClient([
      { body: { items: [1, 2] } },
      { body: { items: [3] } },
      { body: { items: [] } },
    ]);

    const result = await paginateOffsetLimit({
      client: client as any,
      initialRequest: {
        method: 'GET',
        url: '/things',
        operation: 'paginate.test',
        correlation: { correlationId: 'corr-1' },
        agentContext: { agent: 'tester' },
      },
      extractor,
      offsetConfig: { pageSize: 2 },
      limits: { maxPages: 2 },
    });

    expect(result.pageCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('maxPages');
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.aggregateOutcome?.status).toBe(200);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[0].correlation?.correlationId).toBe('corr-1');
    expect(client.requests[1].correlation?.correlationId).toBe('corr-1');
    expect(client.requests[1].agentContext?.agent).toBe('tester');
  });

  it('enforces maxItems when streaming', async () => {
    const client = new FakeHttpClient([
      { body: { items: [1, 2], next: 'b' } },
      { body: { items: [3, 4], next: null } },
    ]);

    const extractorWithCursor: PageExtractor<number, any> = {
      extractPage: (raw) => ({ items: raw.items ?? [], raw, state: raw.next }),
    };
    const strategy = createCursorStrategy({
      cursorParam: 'cursor',
      getNextCursor: (raw) => raw.next,
    });

    const stream = paginateStream({
      client: client as any,
      initialRequest: { method: 'GET', url: '/cursor', operation: 'cursor.test' },
      model: 'cursor',
      strategy,
      extractor: extractorWithCursor,
      limits: { maxItems: 3 },
    });

    const received: number[] = [];
    let next = await stream.next();
    while (!next.done) {
      received.push(...next.value.items);
      next = await stream.next();
    }

    const result: PaginationResult<number, any> | undefined = next.value;

    expect(received).toEqual([1, 2, 3, 4]);
    expect(result?.truncated).toBe(true);
    expect(result?.truncationReason).toBe('maxItems');
    expect(result?.aggregateOutcome?.status).toBe(200);
  });

  it('respects maxDuration without issuing requests', async () => {
    const client = new FakeHttpClient([{ body: { items: [1] } }]);
    const observer = { onStart: vi.fn(), onComplete: vi.fn() };

    const result = await paginateOffsetLimit({
      client: client as any,
      initialRequest: { method: 'GET', url: '/timeout', operation: 'duration.test' },
      extractor,
      offsetConfig: { pageSize: 1 },
      limits: { maxDurationMs: 0 },
      observer,
    });

    expect(result.pageCount).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('maxDurationMs');
    expect(client.requests).toHaveLength(0);
    expect(observer.onStart).toHaveBeenCalled();
    expect(observer.onComplete).toHaveBeenCalled();
  });
});
