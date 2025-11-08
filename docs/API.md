# API Reference

Complete REST API documentation for the Institutional Rotation Detector.

## Table of Contents

- [Overview](#overview)
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Trigger Workflows](#trigger-workflows)
  - [Query Rotation Data](#query-rotation-data)
  - [Graph Operations](#graph-operations)
  - [Explanations](#explanations)
- [Response Formats](#response-formats)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

## Overview

The API provides endpoints to:
- Trigger rotation analysis workflows
- Query rotation events and scores
- Retrieve knowledge graphs and communities
- Generate AI-powered explanations

All endpoints return JSON responses.

## Base URL

**Local Development:**
```
http://localhost:3000
```

**Production:** (configure based on deployment)
```
https://your-domain.com
```

## Authentication

Currently, the API does not require authentication. In production, consider adding:
- API keys
- JWT tokens
- OAuth 2.0

## Endpoints

### Trigger Workflows

#### `POST /api/run`

Starts a rotation analysis workflow for a ticker.

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `ticker` | string | Yes | Stock ticker symbol | `AAPL` |
| `from` | string | Yes | Start quarter or date | `2024Q1` or `2024-01-01` |
| `to` | string | Yes | End quarter or date | `2024Q4` or `2024-12-31` |
| `runKind` | string | No | Run type (default: `daily`) | `daily` or `backfill` |
| `min_pct` | number | No | Min dump % (default: 5) | `5` |

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q4&runKind=daily&min_pct=5"
```

**Example Response:**
```json
{
  "workflowId": "ingestion-AAPL-1699123456789",
  "runId": "abc123def456ghi789"
}
```

**Response Fields:**
- `workflowId` - Temporal workflow ID for tracking
- `runId` - Workflow execution run ID

**Status Codes:**
- `200` - Workflow started successfully
- `400` - Missing or invalid parameters
- `500` - Internal server error

**Monitoring Workflow:**
```bash
# Check workflow status
temporal workflow describe --workflow-id ingestion-AAPL-1699123456789

# View in Temporal UI
open http://localhost:8233
```

---

### Query Rotation Data

#### `GET /api/events`

Retrieves rotation events for a ticker or CIK.

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `ticker` | string | One of ticker/cik | Stock ticker | `AAPL` |
| `cik` | string | One of ticker/cik | SEC CIK | `0000320193` |

**Example Request:**
```bash
curl "http://localhost:3000/api/events?ticker=AAPL"
```

**Example Response:**
```json
[
  {
    "cluster_id": "550e8400-e29b-41d4-a716-446655440000",
    "issuer_cik": "0000320193",
    "anchor_filing": "0001193125-24-123456",
    "dumpz": 7.5,
    "u_same": 0.45,
    "u_next": 0.32,
    "uhf_same": 0.38,
    "uhf_next": 0.25,
    "opt_same": 0.12,
    "opt_next": 0.08,
    "shortrelief_v2": 0.22,
    "index_penalty": 0.1,
    "eow": false,
    "r_score": 18.75,
    "car_m5_p20": 0.0432,
    "t_to_plus20_days": 18,
    "max_ret_w13": 0.0567
  }
]
```

**Response Fields:**
- `cluster_id` - Unique event identifier
- `issuer_cik` - Issuer's SEC CIK
- `anchor_filing` - Reference filing accession
- `dumpz` - Dump magnitude (z-score)
- `u_same` / `u_next` - Uptake metrics
- `uhf_same` / `uhf_next` - Ultra-high-frequency metrics
- `opt_same` / `opt_next` - Options overlay metrics
- `shortrelief_v2` - Short interest relief
- `index_penalty` - Index rebalance penalty
- `eow` - End-of-window flag
- `r_score` - Overall rotation score
- `car_m5_p20` - Cumulative abnormal return (-5 to +20 days)
- `t_to_plus20_days` - Days to reach +20 days
- `max_ret_w13` - Maximum return in week 13

**Status Codes:**
- `200` - Success
- `400` - Missing identifier (ticker or cik)
- `404` - Ticker not found
- `500` - Database error

---

#### `GET /api/graph`

Retrieves the rotation graph (nodes and edges) for a period.

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `ticker` | string | One of ticker/cik | Stock ticker | `AAPL` |
| `cik` | string | One of ticker/cik | SEC CIK | `0000320193` |
| `period` | string | Yes | Period (YYYY-MM) | `2024-01` |

**Example Request:**
```bash
curl "http://localhost:3000/api/graph?ticker=AAPL&period=2024-01"
```

**Example Response:**
```json
{
  "nodes": [
    {
      "id": "0000320193",
      "label": "0000320193"
    },
    {
      "id": "0001234567",
      "label": "0001234567"
    }
  ],
  "links": [
    {
      "source": "0001234567",
      "target": "0000320193",
      "value": 1500000,
      "equity": 1500000,
      "options": 0
    }
  ]
}
```

**Response Fields:**
- `nodes` - Array of graph nodes
  - `id` - Entity ID
  - `label` - Display label
- `links` - Array of edges (flows)
  - `source` - Seller entity ID
  - `target` - Buyer entity ID
  - `value` - Total shares (equity + options)
  - `equity` - Equity shares
  - `options` - Options shares

**Status Codes:**
- `200` - Success
- `400` - Missing parameters
- `404` - Ticker not found
- `500` - Database error

**Visualization:**

This format is compatible with D3.js force-directed graphs:

```html
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
fetch('/api/graph?ticker=AAPL&period=2024-01')
  .then(res => res.json())
  .then(data => {
    // D3 force simulation
    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id(d => d.id))
      .force("charge", d3.forceManyBody())
      .force("center", d3.forceCenter(width / 2, height / 2));
  });
</script>
```

---

### Graph Operations

#### `GET /api/graph/communities`

Detects and summarizes communities in the rotation graph.

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `ticker` | string | One of ticker/cik | Stock ticker | `AAPL` |
| `cik` | string | One of ticker/cik | SEC CIK | `0000320193` |
| `period` | string | Yes | Period (YYYY-MM) | `2024-01` |

**Example Request:**
```bash
curl "http://localhost:3000/api/graph/communities?ticker=AAPL&period=2024-01"
```

**Example Response:**
```json
{
  "communityIds": [
    "660e8400-e29b-41d4-a716-446655440001",
    "770e8400-e29b-41d4-a716-446655440002"
  ],
  "summaries": [
    "This community consists of large institutional managers rotating out of Apple positions. Key players include Vanguard, BlackRock, and State Street. The rotation appears coordinated around the Russell 2000 rebalance in June 2024.",
    "Smaller hedge funds and family offices increasing positions. Notable uptake by Renaissance Technologies and Citadel. Pattern suggests opportunistic buying during institutional selling pressure."
  ]
}
```

**Response Fields:**
- `communityIds` - Array of community UUIDs
- `summaries` - AI-generated explanations for each community

**Note:** This endpoint triggers the `graphSummarizeWorkflow` synchronously and may take 5-10 seconds.

**Status Codes:**
- `200` - Success
- `400` - Missing parameters
- `500` - Workflow execution error

---

#### `GET /api/graph/paths`

Finds paths in the graph (k-hop neighborhood traversal).

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `ticker` | string | One of ticker/cik | Stock ticker | `AAPL` |
| `cik` | string | One of ticker/cik | SEC CIK | `0000320193` |
| `from` | string | Yes | Period start (YYYY-MM-DD) | `2024-01-01` |
| `to` | string | Yes | Period end (YYYY-MM-DD) | `2024-03-31` |
| `hops` | number | No | Number of hops (default: 2) | `2` |

**Example Request:**
```bash
curl "http://localhost:3000/api/graph/paths?ticker=AAPL&from=2024-01-01&to=2024-03-31&hops=2"
```

**Example Response:**
```json
{
  "issuer": {
    "nodeId": "880e8400-e29b-41d4-a716-446655440003",
    "cik": "0000320193",
    "ticker": "AAPL"
  },
  "nodes": [
    {
      "node_id": "880e8400-e29b-41d4-a716-446655440003",
      "kind": "issuer",
      "key_txt": "0000320193",
      "name": "Apple Inc."
    }
  ],
  "edges": [
    {
      "edge_id": "990e8400-e29b-41d4-a716-446655440004",
      "src": "880e8400-e29b-41d4-a716-446655440003",
      "dst": "aa0e8400-e29b-41d4-a716-446655440005",
      "relation": "sold",
      "asof": "2024-03-31",
      "weight": 1500000
    }
  ],
  "topPaths": [
    {
      "edgeIds": ["990e8400-e29b-41d4-a716-446655440004"],
      "score": 1500000
    }
  ]
}
```

**Response Fields:**
- `issuer` - Resolved issuer information
- `nodes` - Nodes in k-hop neighborhood
- `edges` - Edges in k-hop neighborhood
- `topPaths` - Most significant paths by weight

**Status Codes:**
- `200` - Success
- `400` - Missing parameters
- `500` - Workflow execution error

---

### Explanations

#### `POST /api/explain`

Generates an AI explanation for a single edge.

**Request Body:**
```json
{
  "edgeId": "990e8400-e29b-41d4-a716-446655440004"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/explain" \
  -H "Content-Type: application/json" \
  -d '{"edgeId":"990e8400-e29b-41d4-a716-446655440004"}'
```

**Example Response:**
```json
{
  "explanation": "On March 31, 2024, Vanguard Group reduced its Apple (AAPL) position by 1.5 million shares, representing a 5.2% decrease. This reduction aligns with the Russell 2000 rebalance period and was accompanied by increased options activity suggesting hedging behavior."
}
```

**Response Fields:**
- `explanation` - AI-generated explanation of the edge

**Status Codes:**
- `200` - Success
- `400` - Missing edgeId
- `500` - Activity execution error

---

#### `POST /api/graph/explain`

Generates an AI explanation for multiple edges with an optional question.

**Request Body:**
```json
{
  "edgeIds": [
    "990e8400-e29b-41d4-a716-446655440004",
    "aa0e8400-e29b-41d4-a716-446655440005"
  ],
  "question": "What is the pattern of institutional rotation in Apple during Q1 2024?"
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3000/api/graph/explain" \
  -H "Content-Type: application/json" \
  -d '{
    "edgeIds": ["990e8400-e29b-41d4-a716-446655440004"],
    "question": "Why are institutions selling Apple?"
  }'
```

**Example Response:**
```json
{
  "explanationId": "bb0e8400-e29b-41d4-a716-446655440006",
  "content": "Large institutional managers like Vanguard and BlackRock reduced Apple positions in Q1 2024 primarily due to:\n\n1. Portfolio rebalancing: Apple's weight in indices had grown significantly\n2. Valuation concerns: P/E ratio reached historical highs\n3. Regulatory risks: EU Digital Markets Act compliance costs\n4. Index reconstitution: Russell rebalance forcing selling\n\nThe rotation was partially absorbed by smaller hedge funds and family offices seeking entry points.",
  "accessions": [
    "0001193125-24-123456",
    "0001193125-24-123457"
  ]
}
```

**Response Fields:**
- `explanationId` - Stored explanation UUID
- `content` - AI-generated explanation
- `accessions` - Referenced SEC filings

**Note:** Explanations are stored in `graph_explanations` table for future reference.

**Status Codes:**
- `200` - Success
- `400` - Missing or invalid edgeIds
- `500` - Workflow execution error

---

## Response Formats

### Success Response

All successful requests return JSON with relevant data:

```json
{
  "field1": "value1",
  "field2": "value2"
}
```

### Error Response

Error responses include a message:

```json
{
  "error": "Description of the error"
}
```

Or plain text:
```
Missing parameters
```

### Array Responses

Collections return arrays:

```json
[
  { "id": 1, "name": "Item 1" },
  { "id": 2, "name": "Item 2" }
]
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Missing or invalid parameters |
| 404 | Not Found | Resource not found (e.g., unknown ticker) |
| 500 | Internal Server Error | Server or database error |

### Error Examples

**Missing Parameter:**
```bash
curl "http://localhost:3000/api/events"
# Response: 400 Bad Request
# Body: "Missing identifier"
```

**Unknown Ticker:**
```bash
curl "http://localhost:3000/api/events?ticker=INVALID"
# Response: 404 Not Found
# Body: "Unknown ticker"
```

**Database Error:**
```bash
curl "http://localhost:3000/api/events?ticker=AAPL"
# Response: 500 Internal Server Error
# Body: "connection to server failed"
```

---

## Rate Limiting

### Current Implementation

No rate limiting is currently implemented.

### Recommended for Production

Implement rate limiting to prevent abuse:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later.',
});

app.use('/api/', limiter);
```

### Temporal Workflow Rate Limiting

For workflow-triggering endpoints (`POST /api/run`), consider:
- Limiting concurrent workflows per ticker
- Deduplicating requests within time windows
- Using workflow IDs to prevent duplicates

```typescript
const workflowId = `ingestion-${ticker}-${quarter}`;

await client.start('ingestIssuerWorkflow', {
  args: [{ /* ... */ }],
  taskQueue: 'rotation-detector',
  workflowId, // Prevents duplicates
});
```

---

## Examples

### Complete Workflow: Analyze and Query

```bash
# 1. Trigger analysis
WORKFLOW_ID=$(curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily" | jq -r .workflowId)

# 2. Wait for completion (or monitor in Temporal UI)
temporal workflow describe --workflow-id $WORKFLOW_ID

# 3. Query rotation events
curl "http://localhost:3000/api/events?ticker=AAPL" | jq

# 4. Get rotation graph
curl "http://localhost:3000/api/graph?ticker=AAPL&period=2024-01" | jq

# 5. Detect communities
curl "http://localhost:3000/api/graph/communities?ticker=AAPL&period=2024-01" | jq

# 6. Find paths
curl "http://localhost:3000/api/graph/paths?ticker=AAPL&from=2024-01-01&to=2024-03-31&hops=2" | jq

# 7. Get explanation
EDGE_ID=$(curl "http://localhost:3000/api/graph?ticker=AAPL&period=2024-01" | jq -r '.links[0].source')
curl -X POST "http://localhost:3000/api/explain" \
  -H "Content-Type: application/json" \
  -d "{\"edgeId\":\"$EDGE_ID\"}" | jq
```

### JavaScript/TypeScript Client

```typescript
class RotationDetectorClient {
  constructor(private baseUrl: string) {}

  async triggerAnalysis(ticker: string, from: string, to: string) {
    const response = await fetch(
      `${this.baseUrl}/api/run?ticker=${ticker}&from=${from}&to=${to}&runKind=daily`,
      { method: 'POST' }
    );
    return response.json();
  }

  async getEvents(ticker: string) {
    const response = await fetch(
      `${this.baseUrl}/api/events?ticker=${ticker}`
    );
    return response.json();
  }

  async getGraph(ticker: string, period: string) {
    const response = await fetch(
      `${this.baseUrl}/api/graph?ticker=${ticker}&period=${period}`
    );
    return response.json();
  }

  async getCommunities(ticker: string, period: string) {
    const response = await fetch(
      `${this.baseUrl}/api/graph/communities?ticker=${ticker}&period=${period}`
    );
    return response.json();
  }

  async explain(edgeId: string) {
    const response = await fetch(
      `${this.baseUrl}/api/explain`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edgeId }),
      }
    );
    return response.json();
  }
}

// Usage
const client = new RotationDetectorClient('http://localhost:3000');
const events = await client.getEvents('AAPL');
console.log('Rotation events:', events);
```

### Python Client

```python
import requests

class RotationDetectorClient:
    def __init__(self, base_url):
        self.base_url = base_url

    def trigger_analysis(self, ticker, from_date, to_date):
        response = requests.post(
            f"{self.base_url}/api/run",
            params={
                "ticker": ticker,
                "from": from_date,
                "to": to_date,
                "runKind": "daily"
            }
        )
        return response.json()

    def get_events(self, ticker):
        response = requests.get(
            f"{self.base_url}/api/events",
            params={"ticker": ticker}
        )
        return response.json()

    def get_graph(self, ticker, period):
        response = requests.get(
            f"{self.base_url}/api/graph",
            params={"ticker": ticker, "period": period}
        )
        return response.json()

# Usage
client = RotationDetectorClient("http://localhost:3000")
events = client.get_events("AAPL")
print(f"Found {len(events)} rotation events")
```

---

## Related Documentation

- [Workflows](WORKFLOWS.md) - Workflow reference
- [Architecture](ARCHITECTURE.md) - System design
- [Setup Guide](SETUP.md) - Installation
- [Development](DEVELOPMENT.md) - Contributing guide

---

For questions or issues, see [main README](../README.md#support).
