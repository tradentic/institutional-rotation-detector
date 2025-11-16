# @airnub/resilient-http-core

`@airnub/resilient-http-core` provides a fetch-first HTTP substrate with resilience, telemetry hooks, and interceptor wiring aligned to the v0.7 specification. It supports correlation metadata, agent context, retry profiles, and extensible interceptors while remaining dependency-light.

## Usage

```ts
import { HttpClient } from '@airnub/resilient-http-core';

const client = new HttpClient({ clientName: 'example' });

const data = await client.requestJson<{ ok: boolean }>({
  method: 'GET',
  operation: 'example.fetch',
  url: 'https://api.example.com/v1/resource',
});
```

The client exposes `requestJson`, `requestText`, `requestArrayBuffer`, and `requestRaw` along with:

- **Resilience profiles** (`maxAttempts`, `perAttemptTimeoutMs`, `overallTimeoutMs`, `retryEnabled`).
- **Correlation metadata** (`requestId`, `correlationId`, `parentCorrelationId`) and **AgentContext** that flow to interceptors and metrics.
- **Interceptors** for `beforeSend`, `afterResponse`, and `onError` with ordering guarantees.
- **Metrics and tracing hooks** through `MetricsSink` and `TracingAdapter`.
- **Compatibility** legacy `beforeRequest`/`afterResponse` hooks wrapped as an interceptor and a pnpm override alias for `@tradentic/resilient-http-core`.
