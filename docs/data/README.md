# Data Sources & APIs

Data sources, integrations, and API documentation.

## Data Sources

- **[Data Sources Overview](DATA_SOURCES.md)** - SEC EDGAR, UnusualWhales, FINRA, IEX integrations

### SEC EDGAR
- **13F Holdings** - Quarterly institutional holdings (45-day lag)
- **N-PORT Holdings** - Monthly mutual fund holdings
- **Form 4** - Insider transactions (2-day lag)
- **Beneficial Ownership** - 5% ownership disclosures

### Market Data
- **UnusualWhales API** - Options flow and unusual activity
- **FINRA OTC** - Alternative Trading System (ATS) data
- **IEX Exchange** - Historical trade and quote data
- **ETF Holdings** - iShares and major ETF provider data

## API Documentation

- **[REST API Reference](API.md)** - HTTP API endpoints for querying rotation events
- **[UnusualWhales API Analysis](unusualwhales-api-analysis.md)** - Comprehensive options flow endpoint analysis
- **[UnusualWhales Endpoint Scoring](unusualwhales-endpoint-groups-scoring.md)** - API endpoint evaluation and prioritization

### API Specifications

- **[uw-api-bundled.yaml](uw-api-bundled.yaml)** - Bundled OpenAPI specification
- **[uw-api.yaml](uw-api.yaml)** - Complete OpenAPI specification

## Integration Patterns

### Rate Limiting
- SEC EDGAR: 10 requests/second with proper User-Agent
- UnusualWhales: Per API key tier limits
- FINRA/IEX: Custom rate limiting per source

### Data Freshness
- **13F**: 45-day regulatory lag
- **Form 4**: 2-day regulatory lag
- **Microstructure**: 1-3 day processing lag
- **Options Flow**: Near real-time (minutes to hours)

---

[← Back to Documentation Index](../index.md)
