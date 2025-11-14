# @libs/finra-client

Shared FINRA API client library with Query API support for ATS, short interest, and Reg SHO datasets.

## Overview

This library provides typed access to FINRA's Query API datasets, including:

- **Weekly ATS and OTC Summary** - Off-exchange trading volume by symbol and venue
- **Consolidated Short Interest** - Short interest positions by settlement date
- **Reg SHO Daily Short Sale Volume** - Daily short sale transaction data
- **Threshold List** - Securities on the Reg SHO threshold list

## Features

- ✅ OAuth2 client credentials authentication with automatic token refresh
- ✅ Automatic retry with exponential backoff (429/5xx errors)
- ✅ Support for both GET (simple) and POST (complex filtering) endpoints
- ✅ Full TypeScript type definitions for all datasets
- ✅ Automatic pagination for large result sets
- ✅ CSV and JSON response parsing
- ✅ Dataset-specific helper methods with proper Query API filters

## Installation

This library is part of the monorepo and uses workspace dependencies:

```bash
pnpm install
```

## Environment Variables

### Required

- `FINRA_API_CLIENT` - Your FINRA API client ID
- `FINRA_API_SECRET` - Your FINRA API client secret

### Optional

- `FINRA_API_BASE` - Base URL (default: `https://api.finra.org`)
- `FINRA_TOKEN_URL` - OAuth token endpoint URL
- `FINRA_PAGE_SIZE` - Page size for pagination (default: 5000)
- `FINRA_MAX_RETRIES` - Maximum retry attempts (default: 3)
- `FINRA_RETRY_DELAY_MS` - Initial retry delay in ms (default: 500)

## Usage

### Basic Setup

```typescript
import { createFinraClient } from '@libs/finra-client';

// Create client from environment variables
const client = createFinraClient();

// Or with custom config overrides
const client = createFinraClient({
  pageSize: 1000,
  maxRetries: 5,
});
```

### Weekly ATS vs OTC Volume

Get weekly ATS and OTC trading volume for a symbol to calculate off-exchange percentage:

```typescript
import { createFinraClient } from '@libs/finra-client';

const client = createFinraClient();

// Get ATS and OTC data for a specific week
const weeklyData = await client.getSymbolWeeklyAtsAndOtc({
  symbol: 'IRBT',
  weekStartDate: '2024-01-08', // Monday of the week
  tierIdentifier: 'T1', // Optional: filter by tier
});

console.log('ATS shares:', weeklyData.ats?.totalWeeklyShareQuantity);
console.log('OTC shares:', weeklyData.otc?.totalWeeklyShareQuantity);

// Calculate off-exchange percentage
if (weeklyData.ats && weeklyData.otc) {
  const totalOffExchange =
    weeklyData.ats.totalWeeklyShareQuantity +
    weeklyData.otc.totalWeeklyShareQuantity;
  // Compare to total market volume to get percentage
}
```

### Consolidated Short Interest

Get short interest data for a symbol by settlement date:

```typescript
// Get short interest for a specific settlement date
const shortInterest = await client.getConsolidatedShortInterest({
  identifiers: {
    issueSymbolIdentifier: 'IRBT'
    // Or use CUSIP: { cusip: '123456789' }
  },
  settlementDate: '2024-01-15', // 15th or end of month
});

for (const record of shortInterest) {
  console.log('Settlement date:', record.settlementDate);
  console.log('Short interest:', record.shortInterestQuantity);
  console.log('Days to cover:', record.daysToCoverQuantity);
}

// Get short interest for a date range
const shortInterestRange = await client.getConsolidatedShortInterestRange({
  identifiers: { issueSymbolIdentifier: 'IRBT' },
  startDate: '2024-01-01',
  endDate: '2024-01-31',
});

console.log('Found', shortInterestRange.length, 'settlement dates');
```

### Reg SHO Daily Short Sale Volume

Get daily short sale volume data:

```typescript
const regSho = await client.getRegShoDaily({
  symbol: 'IRBT', // SIP symbol
  tradeReportDate: '2024-01-15',
  marketCode: 'Q', // Optional: 'Q' for NASDAQ, 'N' for NYSE, etc.
});

for (const record of regSho) {
  console.log('Short volume:', record.shortParQuantity);
  console.log('Short exempt volume:', record.shortExemptParQuantity);
  console.log('Total volume:', record.totalParQuantity);

  // Calculate short volume percentage
  const shortPct =
    (record.shortParQuantity / record.totalParQuantity) * 100;
  console.log('Short %:', shortPct.toFixed(2));
}
```

### Threshold List

Check if a security is on the Reg SHO threshold list:

```typescript
const threshold = await client.getThresholdList({
  symbol: 'IRBT',
  tradeDate: '2024-01-15',
  onlyOnThreshold: true, // Only return securities with 'Y' flag
});

if (threshold.length > 0) {
  console.log('Symbol is on threshold list!');
  console.log('Threshold flag:', threshold[0].regShoThresholdFlag);
}
```

## Advanced Usage

### Direct Query API Access

For advanced filtering needs, use the low-level query methods:

```typescript
// Query weekly summary with custom filters
const results = await client.queryWeeklySummary({
  compareFilters: [
    {
      compareType: 'equal',
      fieldName: 'tierIdentifier',
      fieldValue: 'T1',
    },
    {
      compareType: 'greater',
      fieldName: 'totalWeeklyShareQuantity',
      fieldValue: 1000000,
    },
  ],
  fields: [
    'issueSymbolIdentifier',
    'weekStartDate',
    'totalWeeklyShareQuantity',
    'summaryTypeCode',
  ],
  limit: 100,
});
```

### Custom POST Requests

```typescript
import type { FinraPostRequest } from '@libs/finra-client';

const request: FinraPostRequest = {
  compareFilters: [
    {
      compareType: 'equal',
      fieldName: 'settlementDate',
      fieldValue: '2024-01-15',
    },
  ],
  fields: ['issueSymbolIdentifier', 'shortInterestQuantity'],
  limit: 1000,
};

const data = await (client as any).postDataset(
  'otcMarket',
  'consolidatedShortInterest',
  request
);
```

## Dataset Reference

### Weekly Summary

**Current data:** `weeklySummary` (last ~12 months)
**Historical data:** `weeklySummaryHistoric` (older than 12 months)

**Key fields:**
- `issueSymbolIdentifier` - Symbol
- `weekStartDate` - Monday of the week (YYYY-MM-DD)
- `summaryTypeCode` - `ATS_W_SMBL` (ATS) or `OTC_W_SMBL` (OTC)
- `totalWeeklyShareQuantity` - Total shares traded
- `totalTradeCountSum` - Total trade count
- `tierIdentifier` - `T1`, `T2`, or `T3`

### Consolidated Short Interest

**Dataset:** `consolidatedShortInterest`

**Key fields:**
- `settlementDate` - Settlement date (15th or end of month)
- `issueSymbolIdentifier` - Symbol
- `cusip` - CUSIP identifier
- `shortInterestQuantity` - Total short interest
- `daysToCoverQuantity` - Days to cover ratio

**Settlement schedule:** 15th and last day of each month

### Reg SHO Daily

**Dataset:** `regShoDaily`

**Key fields:**
- `tradeReportDate` - Trade date
- `securitiesInformationProcessorSymbolIdentifier` - SIP symbol
- `shortParQuantity` - Short sale volume
- `shortExemptParQuantity` - Short exempt volume
- `totalParQuantity` - Total volume
- `marketCode` - Market code (Q=NASDAQ, N=NYSE, etc.)

### Threshold List

**Dataset:** `thresholdList`

**Key fields:**
- `tradeDate` - Trade date
- `issueSymbolIdentifier` - Symbol
- `regShoThresholdFlag` - `Y` (on list) or `N`
- `marketCategoryCode` - Market category

## Type Definitions

All dataset types are fully typed:

```typescript
import type {
  WeeklySummaryRecord,
  ConsolidatedShortInterestRecord,
  RegShoDailyRecord,
  ThresholdListRecord,
  CompareFilter,
  FinraPostRequest,
} from '@libs/finra-client';
```

## Error Handling

```typescript
import { FinraRequestError } from '@libs/finra-client';

try {
  const data = await client.getConsolidatedShortInterest({
    identifiers: { issueSymbolIdentifier: 'INVALID' },
    settlementDate: '2024-01-15',
  });
} catch (error) {
  if (error instanceof FinraRequestError) {
    console.error('FINRA API error:', error.status, error.message);
    console.error('Response body:', error.responseBody);
  } else {
    throw error;
  }
}
```

## Migration from Old Client

If you're migrating from the old `apps/temporal-worker/src/lib/finraClient.ts`:

### Old Code

```typescript
import { createFinraClient } from '../lib/finraClient';

const client = createFinraClient();
const data = await client.fetchShortInterest('2024-01-15');
```

### New Code

```typescript
import { createFinraClient } from '@libs/finra-client';

const client = createFinraClient();
const data = await client.getConsolidatedShortInterest({
  settlementDate: '2024-01-15',
});
```

**Note:** The old methods (`fetchShortInterest`, `fetchATSWeekly`, etc.) are deprecated but still available for backward compatibility. They now use proper POST requests with `compareFilters` instead of undocumented `filter=` query parameters.

## Development

### Build

```bash
pnpm --filter @libs/finra-client run build
```

### Test

```bash
pnpm --filter @libs/finra-client run test
```

### Lint

```bash
pnpm --filter @libs/finra-client run lint
```

## API Documentation

For detailed FINRA API documentation, visit:
- [FINRA API Portal](https://developer.finra.org/)
- [OTC Transparency Data](https://otctransparency.finra.org/otctransparency/)

## License

UNLICENSED - Private use only within Tradentic organization.
