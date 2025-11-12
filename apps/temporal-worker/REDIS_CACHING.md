# Redis Caching for SEC EDGAR API

## Overview

This implementation adds Redis caching to the SEC EDGAR API client to prevent throttling from repeated requests by parallel workflows and activities.

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

Add these environment variables to your `.env` file:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=           # Optional, for secured Redis instances
REDIS_ENABLE_CACHING=true   # Set to 'false' to disable caching
```

## Benefits

1. **Reduced API Calls**: Parallel workflows/activities can share cached data
2. **Avoid Throttling**: SEC EDGAR enforces rate limits (typically 10 requests/second)
3. **Faster Response Times**: Cache hits return instantly without rate limiting delays
4. **Cost Efficiency**: Fewer API calls reduce bandwidth and processing

## Implementation Details

### Files Modified

- `apps/temporal-worker/src/lib/redisClient.ts` - Redis client wrapper with cache operations
- `apps/temporal-worker/src/lib/secClient.ts` - Updated to use Redis caching
- `apps/temporal-worker/.env.example` - Added Redis configuration variables

### Cache Key Format

Cache keys use the format: `sec:{path}`

Examples:
- `sec:/files/company_tickers.json`
- `sec:/submissions/CIK0001234567.json`

### Monitoring

The implementation includes detailed logging:

```
[RedisCache] Cache HIT: sec:/files/company_tickers.json
[RedisCache] Cache MISS: sec:/submissions/CIK0001234567.json
[RedisCache] Cache SET: sec:/submissions/CIK0001234567.json (TTL: 3600s)
[SecClient] Returning cached response for: /files/company_tickers.json
```

## Testing

To verify caching is working:

1. Enable debug logging in your Temporal worker
2. Run a workflow that fetches SEC data multiple times
3. Check logs for cache HIT/MISS messages
4. Verify subsequent requests for the same endpoint show cache HITs

## Future Enhancements

Potential improvements:

1. Cache invalidation API for manual cache clearing
2. Metrics/telemetry for cache hit rates
3. Distributed caching for multi-worker deployments
4. Configurable TTLs per endpoint via environment variables
5. Cache warming for frequently accessed data
