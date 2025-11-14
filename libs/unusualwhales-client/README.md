# @libs/unusualwhales-client

Reusable Unusual Whales HTTP API client that centralizes authentication, retry logic, optional rate limiting, and curated endpoint helpers.

## Installation

This package is part of the monorepo and published under the private scope `@libs`. Consumers should add it as a workspace dependency:

```bash
pnpm add @libs/unusualwhales-client -w
```

## Usage

```ts
import { createUnusualWhalesClientFromEnv } from '@libs/unusualwhales-client';
import { createDistributedRateLimiter } from '../../apps/temporal-worker/src/lib/distributedRateLimit';

const rateLimiter = createDistributedRateLimiter('unusualwhales-api', 10);
const client = createUnusualWhalesClientFromEnv({ rateLimiter });

const shorts = await client.getShortData('AAPL');
const flow = await client.getGreekFlow('AAPL', { date: '2024-11-01' });
```

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UNUSUALWHALES_API_KEY` | ✅ | – | API key issued by Unusual Whales |
| `UNUSUALWHALES_BASE_URL` | ❌ | `https://api.unusualwhales.com` | Override base URL for testing |
| `UNUSUALWHALES_MAX_RETRIES` | ❌ | `3` | Number of retries for transient failures |
| `UNUSUALWHALES_RETRY_DELAY_MS` | ❌ | `500` | Base delay (ms) used for exponential backoff |
| `UNUSUALWHALES_TIMEOUT_MS` | ❌ | – | Abort requests that take longer than this timeout |

### Endpoints

The client exposes thin wrappers for frequently used datasets:

- Shorts: `/api/shorts/{ticker}/...`
- Stock flow overlays: `/api/stock/{ticker}/oi-per-strike`, `/api/stock/{ticker}/greek-flow`, ...
- Group/sector overlays and seasonality insights
- Institutions & holdings
- Stock screener and option flow tape

All helpers are built on top of the generic `request()` / `get()` helpers so additional endpoints can be accessed without new methods.
