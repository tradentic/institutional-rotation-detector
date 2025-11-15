# @tradentic/resilient-http-core

`@tradentic/resilient-http-core` is a lightweight, transport-agnostic HTTP client that adds retries, budgets, caching, circuit
breaking, telemetry hooks, and policy wrapping to API calls. It is the foundation for all API clients in this monorepo.

## Configuration

Create an `HttpClient` by passing a `BaseHttpClientConfig`. All v0.2 options remain available, and v0.3 introduces the following
quality-of-life hooks:

### `baseUrl` and `resolveBaseUrl`

- `baseUrl` is now optional. If it is omitted, you may call the client with a fully-qualified `path` such as
  `https://api.example.com/v1/resource`.
- Provide `resolveBaseUrl` to pick a base URL dynamically based on the request. Returning `undefined` falls back to the static
  `baseUrl`.

```ts
const http = new HttpClient({
  clientName: 'sec',
  baseUrl: 'https://www.sec.gov',
  resolveBaseUrl: (opts) =>
    opts.path.startsWith('/submissions/') ? 'https://data.sec.gov' : undefined,
});
```

### `beforeRequest` and `afterResponse`

`beforeRequest` runs once per call before throttling, letting you shape headers or query parameters in a single place. If it
returns a partial `HttpRequestOptions`, those fields override the original request.

`afterResponse` runs after a successful HTTP response (raw or JSON) and receives both the low-level `Response` and the final
request options. Use it for custom logging or header inspection.

```ts
const http = new HttpClient({
  clientName: 'iex',
  beforeRequest: (opts) => ({
    ...opts,
    headers: { 'User-Agent': 'tradentic-bot', ...(opts.headers ?? {}) },
  }),
  afterResponse: async (response, opts) => {
    console.log('rate-limit-remaining', response.headers.get('x-ratelimit-remaining'), opts.operation);
  },
});
```

### `operationDefaults`

Declare per-operation defaults for timeouts, retries, and idempotency so each call site stays minimal:

```ts
const http = new HttpClient({
  clientName: 'hist',
  baseUrl: 'https://api.example.com',
  operationDefaults: {
    'hist.download': { timeoutMs: 120_000 },
    'orders.create': { idempotent: false, maxRetries: 0 },
  },
});
```

During a request the client applies the following precedence:

1. Explicit value from `HttpRequestOptions`.
2. Matching `operationDefaults` entry.
3. Client-level defaults (`timeoutMs`, `maxRetries`, idempotency inferred from HTTP method).

These hooks keep domain-specific routing and header rules in your client packages while the shared core continues to manage the
resilience primitives.

### `requestText` and `requestArrayBuffer`

Not every endpoint returns JSON. When you need CSV, NDJSON, or binary payloads, use the built-in helpers instead of reimplementing
`requestRaw().text()` or `.arrayBuffer()` at every call site:

```ts
const http = new HttpClient({ clientName: 'sec', baseUrl: 'https://data.sec.gov' });

const csv = await http.requestText({
  method: 'GET',
  path: '/submissions/CIK0000320193.csv',
  operation: 'sec.downloadCsv',
});

const buffer = await http.requestArrayBuffer({
  method: 'GET',
  path: '/files/bulk.gz',
  operation: 'sec.downloadBulk',
});
```

Both helpers delegate to `requestRaw`, so they automatically benefit from the same retries, rate limiting, tracing, metrics, and
hook executions before decoding the payload.
