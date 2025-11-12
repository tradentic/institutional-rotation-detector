# Redis Infrastructure for API Clients

## Overview

This implementation adds Redis-based infrastructure for API clients to prevent throttling and improve performance:

1. **Response Caching**: Cache SEC EDGAR API responses to avoid repeated requests
2. **Distributed Rate Limiting**: Coordinate rate limits across multiple worker instances

## Cached Endpoints

The following endpoints are cached with their respective TTLs:

| Endpoint | TTL | Reason |
|----------|-----|--------|
| `/files/company_tickers.json` | 24 hours | Reference data that rarely changes |
| `/submissions/CIK*.json` | 1 hour | Company submission data updated periodically |

## Architecture

### Cache-Aside Pattern

The implementation uses a cache-aside pattern:

1. Check Redis cache for the requested endpoint
2. If cache HIT: Return cached response immediately (bypasses rate limiting)
3. If cache MISS: Fetch from SEC API, cache the response, then return it

### Graceful Degradation

The caching layer is designed to fail gracefully:

- If Redis is unavailable, requests go directly to the SEC API
- Connection errors are logged but don't break the application
- Caching can be disabled via `REDIS_ENABLE_CACHING=false`

## Configuration

### Environment Variables

Add these environment variables to your `.env` file:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=           # Optional, for secured Redis instances
REDIS_ENABLE_CACHING=true   # Set to 'false' to disable caching
```

### Starting Redis Locally

For local development, use these pnpm scripts to manage Redis:

```bash
# Start Redis (detached)
pnpm redis:start

# Stop Redis
pnpm redis:stop

# Restart Redis
pnpm redis:restart

# View Redis logs
pnpm redis:logs

# Access Redis CLI
pnpm redis:cli
```

These scripts use the Docker Compose configuration from `.devcontainer/docker-compose.yml`, which configures Redis with:
- Port: 6379
- Persistence: Saves to disk every 60 seconds
- Log level: Warning
- Volume: `redis-data` for persistent storage

**Note:** In Codespaces, Redis starts automatically via the devcontainer. For local development, run `pnpm redis:start` before starting your worker.

## Distributed Rate Limiting

### Problem

Without distributed rate limiting, each worker instance maintains its own in-memory rate limiter. If you deploy 5 worker instances with a 10 req/s limit each, you'd actually send 50 req/s total to the API, violating rate limits.

### Solution

The `DistributedRateLimiter` uses Redis to coordinate rate limits across all worker instances:

- Uses Redis sorted sets for sliding window rate limiting
- Atomic operations via Lua scripts ensure consistency
- **Fails open**: Falls back to in-memory limiting if Redis is unavailable
- Shared state means 10 req/s limit applies across ALL instances
- Circuit breaker temporarily disables Redis after repeated failures
- Command timeouts prevent hanging on slow/unavailable Redis

### Supported Clients

| Client | Identifier | Rate Limit Env Var |
|--------|-----------|-------------------|
| `SecClient` | `sec-api` | `MAX_RPS_EDGAR` (default: 8) |
| `UnusualWhalesClient` | `unusualwhales-api` | `MAX_RPS_UNUSUALWHALES` (default: 10) |

### How It Works

1. Before each API request, check Redis for current request count in the sliding window
2. If under the limit, add request to the window and proceed
3. If over the limit, calculate wait time based on oldest request in window
4. Use Lua scripts for atomic operations to prevent race conditions

### Fail-Open Design

The rate limiter is designed to **always allow requests to proceed**, even if Redis fails:

**Graceful Degradation:**
- If Redis is unavailable at startup → Use in-memory rate limiting
- If Redis operations timeout (1 second) → Fall back to in-memory
- If Redis command fails → Fall back to in-memory

**Circuit Breaker:**
- After 3 consecutive Redis failures → Open circuit breaker
- While circuit is open (10 seconds) → Skip Redis, use in-memory only
- After backoff period → Reset circuit, try Redis again

**Timeouts:**
- Connection timeout: 5 seconds
- Command timeout: 2 seconds
- Rate limit operation timeout: 1 second
- Offline queue: Disabled (fail fast)

This ensures that **API requests never fail due to Redis issues**. The worst case is falling back to per-instance rate limiting, which is still better than blocking all requests.

### Monitoring Rate Limits

You can monitor current rate limit usage:

```typescript
const limiter = createDistributedRateLimiter('sec-api', 8);
const currentCount = await limiter.getCurrentCount();
console.log(`Current requests in window: ${currentCount}`);
```

## Benefits

1. **Reduced API Calls**: Parallel workflows/activities can share cached data
2. **Avoid Throttling**: SEC EDGAR enforces rate limits (typically 10 requests/second)
3. **Distributed Rate Limiting**: Multiple worker instances share the same rate limit
4. **Faster Response Times**: Cache hits return instantly without rate limiting delays
5. **Cost Efficiency**: Fewer API calls reduce bandwidth and processing
6. **Graceful Degradation**: Both caching and rate limiting work without Redis

## Implementation Details

### Files Modified/Created

- `apps/temporal-worker/src/lib/redisClient.ts` - Redis client wrapper with cache operations
- `apps/temporal-worker/src/lib/distributedRateLimit.ts` - Distributed rate limiter using Redis
- `apps/temporal-worker/src/lib/secClient.ts` - Updated to use Redis caching and distributed rate limiting
- `apps/temporal-worker/src/lib/unusualWhalesClient.ts` - Updated to use distributed rate limiting
- `apps/temporal-worker/.env.example` - Added Redis configuration variables
- `apps/temporal-worker/package.json` - Added ioredis dependency

### Redis Key Formats

**Cache Keys** use the format: `sec:{path}`

Examples:
- `sec:/files/company_tickers.json`
- `sec:/submissions/CIK0001234567.json`

**Rate Limiter Keys** use the format: `ratelimit:{identifier}`

Examples:
- `ratelimit:sec-api`
- `ratelimit:unusualwhales-api`

Rate limiter keys use Redis sorted sets where:
- Score = timestamp (milliseconds)
- Member = unique request ID

### Monitoring

The implementation includes detailed logging:

**Caching:**
```
[RedisCache] Cache HIT: sec:/files/company_tickers.json
[RedisCache] Cache MISS: sec:/submissions/CIK0001234567.json
[RedisCache] Cache SET: sec:/submissions/CIK0001234567.json (TTL: 3600s)
[SecClient] Returning cached response for: /files/company_tickers.json
```

**Rate Limiting:**
```
[SecClient] Fetching: { path: '/submissions/CIK0001234567.json', cacheTTL: '3600s', ... }
[DistributedRateLimiter] Redis error, falling back to in-memory: [error details]
```

## Testing

### Verify Caching

1. Enable debug logging in your Temporal worker
2. Run a workflow that fetches SEC data multiple times
3. Check logs for cache HIT/MISS messages
4. Verify subsequent requests for the same endpoint show cache HITs

### Verify Distributed Rate Limiting

1. Start multiple worker instances (e.g., 3 workers)
2. Configure `MAX_RPS_EDGAR=10` in environment
3. Run parallel workflows that make SEC API requests
4. Monitor Redis: `redis-cli --scan --pattern "ratelimit:*"`
5. Verify total request rate across all instances stays at ~10 req/s
6. Check worker logs for rate limiting delays

## Future Enhancements

Potential improvements:

1. Cache invalidation API for manual cache clearing
2. Metrics/telemetry for cache hit rates
3. Distributed caching for multi-worker deployments
4. Configurable TTLs per endpoint via environment variables
5. Cache warming for frequently accessed data
