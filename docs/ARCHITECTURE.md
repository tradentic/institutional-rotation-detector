# Architecture

System design, component overview, and architectural patterns for the Institutional Rotation Detector.

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Component Overview](#component-overview)
- [Data Flow](#data-flow)
- [Workflow Orchestration](#workflow-orchestration)
- [Activity Layer](#activity-layer)
- [Database Design](#database-design)
- [Integration Patterns](#integration-patterns)
- [Scalability & Reliability](#scalability--reliability)
- [Design Decisions](#design-decisions)

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ REST API     │  │ Temporal CLI │  │ Backfill Scripts│  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
└─────────┼──────────────────┼───────────────────┼───────────┘
          │                  │                   │
┌─────────▼──────────────────▼───────────────────▼───────────┐
│                  Temporal.io Workflows                      │
│  ┌────────────────────────────────────────────────────────┐│
│  │ Ingestion Workflows                                    ││
│  │  • ingestIssuerWorkflow  - Multi-quarter coordination  ││
│  │  • ingestQuarterWorkflow - Single quarter processing   ││
│  └────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────┐│
│  │ Analysis Workflows                                     ││
│  │  • rotationDetectWorkflow - Signal detection & scoring ││
│  │  • eventStudyWorkflow     - Market impact analysis     ││
│  └────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────┐│
│  │ Graph Workflows                                        ││
│  │  • graphBuildWorkflow     - Knowledge graph creation   ││
│  │  • graphSummarizeWorkflow - Community detection        ││
│  │  • graphQueryWorkflow     - Path finding & traversal   ││
│  └────────────────────────────────────────────────────────┘│
└─────────┬──────────────────────────────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────┐
│                    Activity Layer                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ EDGAR    │ │ FINRA    │ │ Graph    │ │ OpenAI       │ │
│  │ Client   │ │ Client   │ │ Algos    │ │ Integration  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Position │ │ Scoring  │ │ Rate     │ │ ETF          │ │
│  │ Tracking │ │ Engine   │ │ Limiting │ │ Processing   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │
└─────────┬──────────────────────────────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────┐
│              Data Layer (PostgreSQL + pgvector)             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ Filings        │  │ Graph Store    │  │ Vector Store │ │
│  │ • entities     │  │ • graph_nodes  │  │ • embeddings │ │
│  │ • filings      │  │ • graph_edges  │  │ (via pgvector)│ │
│  │ • positions_13f│  │ • communities  │  └──────────────┘ │
│  │ • bo_snapshots │  │ • explanations │                    │
│  └────────────────┘  └────────────────┘                    │
│  ┌────────────────┐  ┌────────────────┐                    │
│  │ Rotation Data  │  │ Reference Data │                    │
│  │ • events       │  │ • index_calendar│                   │
│  │ • edges        │  │ • cusip_map    │                    │
│  └────────────────┘  └────────────────┘                    │
└─────────────────────────────────────────────────────────────┘

External Services: SEC EDGAR, FINRA, OpenAI API
```

## Component Overview

### 1. API Layer (`apps/api/`)

Provides REST endpoints for querying data and triggering workflows.

**Key Routes:**
- `POST /api/run` - Trigger rotation analysis workflow
- `GET /api/events` - Query rotation events by ticker/CIK
- `GET /api/graph` - Fetch rotation graph for a period
- `GET /api/graph/communities` - Get detected communities
- `GET /api/graph/paths` - Find paths between entities
- `POST /api/explain` - Generate AI explanation for events
- `POST /api/graph/explain` - Generate graph-based explanation

**Design:**
- Stateless HTTP handlers
- Direct Supabase queries for read operations
- Temporal client for workflow triggers
- No business logic (delegated to workflows/activities)

### 2. Temporal Worker (`apps/temporal-worker/`)

Long-running process that executes workflows and activities.

**Structure:**
```
temporal-worker/
├── src/
│   ├── workflows/       # Durable workflow definitions
│   ├── activities/      # Stateless activity implementations
│   ├── lib/             # Shared utilities and libraries
│   └── __tests__/       # Unit and integration tests
├── temporal.config.ts   # Worker configuration
└── package.json
```

**Worker Configuration:**
- Task queue: `rotation-detector`
- Max concurrent workflow tasks: 100
- Max concurrent activity tasks: 50
- Activity timeout: 5 minutes (configurable per activity)

### 3. Workflows

Workflows are durable, fault-tolerant orchestrations that coordinate activities.

**Key Characteristics:**
- Deterministic execution (no random, Date.now(), etc.)
- Automatic retries on failure
- State persistence across process restarts
- Built-in versioning support
- Search attributes for querying

**Workflow Catalog:**

| Workflow | Purpose | Duration | Complexity |
|----------|---------|----------|------------|
| `ingestIssuerWorkflow` | Fetch all quarters for a ticker | Hours | High |
| `ingestQuarterWorkflow` | Process single quarter | 10-30 min | Medium |
| `rotationDetectWorkflow` | Detect and score rotations | 5-10 min | High |
| `eventStudyWorkflow` | Calculate CAR metrics | 2-5 min | Low |
| `graphBuildWorkflow` | Build knowledge graph | 5-15 min | Medium |
| `graphSummarizeWorkflow` | Generate summaries | 5-10 min | Medium |
| `graphQueryWorkflow` | Execute graph queries | 1-3 min | Low |
| `testProbeWorkflow` | Test search attributes | <1 min | Low |

**Workflow Patterns:**

1. **Continue-As-New**: For long-running iterations
   ```typescript
   // Process quarters in batches to avoid history bloat
   if (remaining.length > 0) {
     await continueAsNew({ ...input, quarters: remaining });
   }
   ```

2. **Child Workflows**: For parallel sub-tasks
   ```typescript
   // Launch child workflow for each quarter
   const child = await startChild('ingestQuarterWorkflow', { args: [...] });
   await child.result();
   ```

3. **Search Attributes**: For workflow visibility
   ```typescript
   await upsertWorkflowSearchAttributes({
     ticker: input.ticker,
     cik: input.cik,
     runKind: input.runKind,
     windowKey: input.quarter,
     periodEnd: bounds.end,
     batchId: `issuer:${input.quarter}`,
   });
   ```

### 4. Activities

Activities are stateless functions that interact with external systems.

**Activity Groups:**

| File | Purpose | External Dependencies |
|------|---------|----------------------|
| `edgar.activities.ts` | SEC filing downloads | SEC EDGAR API |
| `nport.activities.ts` | N-PORT processing | SEC EDGAR API |
| `finra.activities.ts` | Short interest data | FINRA API |
| `etf.activities.ts` | ETF holdings processing | Internal DB |
| `compute.activities.ts` | Rotation scoring | Internal DB |
| `graph.activities.ts` | Graph construction | Internal DB |
| `graphrag.activities.ts` | Graph algorithms (Louvain, PageRank, k-hop) | Internal DB, OpenAI |
| `rag.activities.ts` | RAG operations (embedding-based) | OpenAI, pgvector |
| `sankey.activities.ts` | Flow visualization | Internal DB |
| `longcontext.activities.ts` | Long-context synthesis (128K window) | OpenAI |

**Activity Design Patterns:**

1. **Rate Limiting**:
   ```typescript
   const limiter = new RateLimiter(10); // 10 req/sec
   await limiter.acquire();
   // Make API call
   ```

2. **Idempotency**:
   ```typescript
   // Use upserts to allow safe retries
   await supabase.from('filings').upsert(data, { onConflict: 'accession' });
   ```

3. **Chunking**:
   ```typescript
   // Process large datasets in batches
   await pMap(items, processItem, { concurrency: 10 });
   ```

### 5. Library Layer (`src/lib/`)

Shared utilities and domain logic.

**Key Modules:**

- **`schema.ts`**: TypeScript interfaces for data models
- **`supabase.ts`**: Database client creation and configuration
- **`secClient.ts`**: SEC EDGAR API client with rate limiting
- **`openai.ts`**: OpenAI client wrapper
- **`graph.ts`**: Graph construction and algorithms
- **`pagerank_louvain.ts`**: Community detection algorithms
- **`scoring.ts`**: Rotation scoring engine
- **`rateLimit.ts`**: Generic rate limiter implementation
- **`indexCalendar.ts`**: Russell rebalance date utilities

## Data Flow

### Ingestion Flow

```
User Request (ticker, date range)
         │
         ▼
┌────────────────────┐
│ ingestIssuerWorkflow│
│ • Resolve CIK      │
│ • Split quarters   │
└────────┬───────────┘
         │
         ▼ (for each quarter)
┌────────────────────┐
│ingestQuarterWorkflow│
│ 1. Fetch 13F filings│
│ 2. Extract positions│
│ 3. Fetch N-PORT     │
│ 4. Fetch BO reports │
│ 5. Fetch ETF data   │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│rotationDetectWorkflow│
│ 1. Detect dumps    │
│ 2. Calculate uptake│
│ 3. Compute signals │
│ 4. Score events    │
│ 5. Build edges     │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ eventStudyWorkflow │
│ • Fetch price data │
│ • Calculate CAR    │
│ • Store metrics    │
└────────────────────┘
```

### Graph Analysis Flow

```
Rotation Events (in database)
         │
         ▼
┌────────────────────────────────────────────┐
│         graphBuildWorkflow                 │
│  [Graph Algorithms Only]                   │
│  • Create nodes from entities              │
│  • Create edges from rotation flows        │
│  • Compute edge weights                    │
└────────┬───────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│      graphSummarizeWorkflow                │
│  [Graph Algorithms + Short AI Summaries]   │
│  1. Run Louvain (community detection)      │
│  2. Compute PageRank (node importance)     │
│  3. Generate AI summary per community      │
│     (uses GPT-5-mini, short prompt)        │
└────────┬───────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│        graphQueryWorkflow                  │
│  [Graph Algorithms + Long Context]         │
│  1. K-hop neighborhood traversal           │
│  2. Path finding (graph algorithms)        │
│  3. Bundle edges + filing chunks           │
│  4. Long context synthesis (128K window)   │
│     → Natural language explanation         │
└────────────────────────────────────────────┘
```

### Query Flow

```
API Request (ticker, period)
         │
         ▼
┌────────────────────┐
│  Supabase Query    │
│  • rotation_events │
│  • rotation_edges  │
│  • graph_nodes     │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Response Format   │
│  • JSON            │
│  • Graph structure │
│  • Metadata        │
└────────────────────┘
```

## Database Design

### Schema Principles

1. **Normalization**: Entities stored once, referenced by ID
2. **Temporal Modeling**: `asof` dates for point-in-time queries
3. **Immutability**: Append-only for filings and positions
4. **Denormalization**: Computed metrics stored for performance

### Key Relationships

```
entities (institutional investors, issuers)
    │
    ├──→ filings (13F, N-PORT, beneficial ownership)
    │       │
    │       └──→ positions_13f (holdings)
    │
    └──→ rotation_edges (flows between entities)

graph_nodes (knowledge graph)
    │
    └──→ graph_edges (relationships)
            │
            └──→ graph_communities (detected clusters)
```

### Indexes

Critical indexes for performance:
- `filings(cik, filed_date)` - Filing lookups
- `positions_13f(cusip, asof)` - Position queries
- `rotation_events(issuer_cik)` - Event retrieval
- `rotation_edges(period_start, root_issuer_cik)` - Graph queries
- `graph_edges(src, dst)` - Graph traversal

## Integration Patterns

### SEC EDGAR Integration

**Pattern**: Rate-limited HTTP client with retry logic

```typescript
class SECClient {
  private limiter = new RateLimiter(10); // 10 req/sec

  async fetch(url: string) {
    await this.limiter.acquire();
    const response = await fetch(url, {
      headers: { 'User-Agent': SEC_USER_AGENT }
    });
    if (!response.ok) {
      if (response.status === 429) {
        await sleep(60000); // Back off
        return this.fetch(url); // Retry
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  }
}
```

**Considerations:**
- Respect 10 req/sec limit
- Proper User-Agent required
- Handle 429 rate limit responses
- Parse XML filings (13F-HR)
- Handle malformed data gracefully

### OpenAI Integration

**Pattern**: Model-agnostic client with GPT-5 Responses API

```typescript
import { createClient } from '@libs/openai-client';

async function summarizeCommunity(nodes: GraphNode[]) {
  // Model-agnostic client - easy to upgrade to future models
  const client = createClient({ model: 'gpt-5-mini' });

  const response = await client.createResponse({
    input: buildPrompt(nodes),
    reasoning: { effort: 'minimal' }, // Explicit reasoning configuration
    text: { verbosity: 'low' },       // Explicit verbosity control
    max_output_tokens: 500,
  });

  return response.output_text;
}
```

**Modern Patterns Used:**
- ✅ Model-agnostic: `createClient({ model: 'gpt-5' | 'gpt-5-mini' })`
- ✅ Explicit reasoning effort: `reasoning: { effort: 'minimal' | 'low' | 'medium' | 'high' }`
- ✅ Explicit verbosity: `text: { verbosity: 'low' | 'medium' | 'high' }`
- ✅ Chain of Thought (CoT): `createAnalysisSession()` for multi-turn with 60-80% token savings
- ✅ E2B Code Execution: `createCodeSession({ enableE2B: true })` for statistical analysis

**Considerations:**
- Handle rate limits (exponential backoff)
- Monitor token usage (input, output, reasoning)
- Use CoT sessions for multi-turn conversations
- Validate responses
- Handle errors gracefully

### Supabase Integration

**Pattern**: Connection pooling with prepared statements

```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'public' },
  auth: { persistSession: false },
});

// Type-safe queries
const { data, error } = await supabase
  .from('rotation_events')
  .select('*')
  .eq('issuer_cik', cik);
```

**Considerations:**
- Use service role key for activities
- Enable connection pooling
- Handle network failures
- Batch inserts for performance
- Use RPC for complex queries

## Scalability & Reliability

### Horizontal Scaling

**Temporal Workers:**
- Run multiple worker processes
- Each connects to same task queue
- Temporal handles work distribution
- Add workers to increase throughput

**Database:**
- Read replicas for query endpoints
- Connection pooling (PgBouncer)
- Partitioning for large tables (time-based)

### Fault Tolerance

**Workflow Retries:**
- Automatic retry with exponential backoff
- Configurable retry policies per activity
- Dead letter queue for permanent failures

**Data Consistency:**
- Idempotent activities (upserts)
- Database transactions for multi-table updates
- Saga pattern for distributed transactions

### Monitoring

**Key Metrics:**
- Workflow completion rate
- Activity duration (p50, p95, p99)
- Error rates by activity type
- Database query performance
- API response times
- External API rate limit usage

**Observability:**
- Temporal UI for workflow visibility
- PostgreSQL slow query log
- Application logs (structured JSON)
- APM integration (optional)

## Design Decisions

### Why Temporal.io?

**Alternatives Considered**: Airflow, Prefect, Celery

**Chosen Because:**
- Durable execution (survives crashes)
- Built-in retries and error handling
- Excellent visibility (Temporal UI)
- Versioning support
- Strong TypeScript support
- Scales horizontally

### Why PostgreSQL + pgvector?

**Alternatives Considered**: Neo4j, MongoDB, Pinecone

**Chosen Because:**
- Single database for relational + vector data
- ACID guarantees
- Mature ecosystem
- Cost-effective
- Supabase integration
- Graph queries possible via recursive CTEs

### Why TypeScript?

**Alternatives Considered**: Python, Go

**Chosen Because:**
- Type safety reduces bugs
- Excellent IDE support
- Temporal SDK has great TS support
- Large ecosystem (npm)
- Good for API and workflows

### Why GraphRAG?

**Alternatives Considered**: Traditional RAG, Fine-tuned models

**Chosen Because:**
- Captures relationships explicitly
- Better for connected data (institutional flows)
- Interpretable (can visualize graph)
- Community detection adds structure
- Combines graph algorithms + LLM strengths

**Implementation Details:**

GraphRAG in this system uses a **dual approach**:

1. **Graph Algorithms** (`graphrag.activities.ts`):
   - **Louvain algorithm** for community detection (clusters of coordinated investors)
   - **PageRank** for identifying influential nodes
   - **K-hop neighborhood** for graph traversal and relationship discovery
   - **Pure algorithmic** - no LLM required for graph operations
   - Results stored in `graph_nodes`, `graph_edges`, `graph_communities` tables

2. **Long Context Synthesis** (`longcontext.activities.ts`):
   - Uses OpenAI's **200K+ context window** (GPT-5 Responses API)
   - Bundles graph edges with filing text chunks
   - **No semantic pre-filtering** - sends full relevant text to LLM
   - Generates natural language explanations from structured + unstructured data
   - Enables answering complex questions about rotation patterns
   - Results stored in `graph_explanations` table

**When Each is Used:**
- `graphBuildWorkflow`: Pure graph algorithms (no LLM)
- `graphSummarizeWorkflow`: Graph algorithms + short LLM summaries per community
- `graphQueryWorkflow`: **Both** - graph traversal finds relevant data, then long context synthesizes explanation

**Why No Vector Store/Semantic Search?**

This system deliberately **does not use** vector embeddings or semantic search:
- ✅ **Modern LLMs handle large contexts** - 200K+ tokens (GPT-5) and growing
- ✅ **Simpler architecture** - no embedding generation, storage, or search overhead
- ✅ **No embedding drift** - embeddings don't go stale over time
- ✅ **Lower latency** - no vector search computation
- ✅ **Future-proof** - scales naturally with growing LLM context windows

**Trade-off:** More input tokens sent to LLM, but manageable with modern context windows.

This hybrid approach provides:
- **Structure** from graph algorithms (who's connected to whom)
- **Context** from long context synthesis (why it matters, what it means)
- **Simplicity** from avoiding vector search infrastructure

---

**Next**: See [WORKFLOWS.md](WORKFLOWS.md) for detailed workflow documentation (Phase 2)
