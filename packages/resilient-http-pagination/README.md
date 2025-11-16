# @airnub/resilient-http-pagination

Pagination utilities aligned with the Resilient HTTP v0.3 specification. Built on top of `@airnub/resilient-http-core`, it provides strategy-based pagination, streaming support, and limit-aware aggregation so multi-page HTTP fetches stay observable and resilient.

## Usage

```ts
import { createDefaultHttpClient } from '@airnub/resilient-http-core';
import {
  createArrayFieldExtractor,
  paginateOffsetLimit,
} from '@airnub/resilient-http-pagination';

const client = createDefaultHttpClient();

const result = await paginateOffsetLimit({
  client,
  initialRequest: {
    url: 'https://api.example.com/resources',
    operation: 'listResources',
  },
  offsetConfig: { pageSize: 50 },
  extractor: createArrayFieldExtractor({ itemsPath: 'data.items' }),
  limits: { maxPages: 10 },
});

console.log(result.items.length);
```

See [`docs/specs/resilient_http_pagination_spec_v_0_3.md`](../../docs/specs/resilient_http_pagination_spec_v_0_3.md) for the full specification and design goals.
