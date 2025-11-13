# GraphRAG: Graph-Based Retrieval Augmented Generation

Comprehensive guide to knowledge graph construction, community detection, and AI-powered analysis.

## Table of Contents

- [Overview](#overview)
- [Two-Part Architecture](#two-part-architecture)
- [Why GraphRAG?](#why-graphrag)
- [Part 1: Graph Algorithms](#part-1-graph-algorithms)
  - [Graph Construction](#graph-construction)
  - [Community Detection](#community-detection)
  - [Graph Queries](#graph-queries)
- [Part 2: Long Context Synthesis](#part-2-long-context-synthesis)
  - [Context Bundling](#context-bundling)
  - [Synthesis Process](#synthesis-process)
- [Use Cases](#use-cases)
- [Performance](#performance)

## Overview

GraphRAG combines **knowledge graphs** with **retrieval augmented generation** (RAG) to provide explainable, contextual insights about institutional rotation patterns.

**This system implements GraphRAG using a dual approach:**

1. **Graph Algorithms** - Pure algorithmic operations on graph data
2. **Long Context Synthesis** - AI-powered natural language generation using large context windows

Both components work together but serve distinct purposes and can be used independently.

---

## Two-Part Architecture

The graph analysis system uses a **layered architecture** that clearly separates algorithmic operations from AI enhancement:

### Layer 1: Core Graph Construction (Pure Algorithms - No AI)

**Purpose:** Deterministic graph operations that structure institutional flow data

**Workflows:**
- `graphBuildWorkflow` - 100% deterministic, constructs knowledge graph from rotation edges
- Louvain community detection algorithm
- PageRank node importance scoring
- K-hop graph traversal
- Path finding and relationship discovery

**Files:** `apps/temporal-worker/src/activities/graphrag.activities.ts`

**Storage:** `graph_nodes`, `graph_edges`, `graph_communities` tables

**Characteristics:**
- **100% Algorithmic** - Zero AI/LLM usage
- **Fast** - Pure computation, no API calls
- **Deterministic** - Same input → same output, always
- **Scalable** - Handles millions of nodes/edges efficiently
- **Cost-effective** - Zero per-query costs
- **Real-time** - Millisecond response times

**Use Cases:**
- Network analysis and visualization
- Community detection
- Relationship mapping
- Graph database queries
- Performance-critical operations

### Layer 2: Intelligence Enhancement (Selective AI)

**Purpose:** Add natural language understanding and synthesis where valuable

**Workflows:**
- `graphSummarizeWorkflow` - Uses GPT-5-mini for community descriptions (~500 tokens per community)
- `graphQueryWorkflow` - Uses GPT-5 for long-context synthesis (up to 200K tokens)

**Files:** `apps/temporal-worker/src/activities/longcontext.activities.ts`, `apps/temporal-worker/src/activities/filing-chunks.activities.ts`

**Storage:** `graph_explanations` table, `filing_chunks` table (text only, no embeddings)

**Characteristics:**
- **Selective AI** - Only 2-5% of graph operations use AI
- **Cost-optimized** - AI used only where human-readable output needed
- **Context-aware** - Combines structured graph data with unstructured filing text
- **Evidence-based** - All AI outputs cite specific filings and graph edges
- **No Vector Search** - Uses long context windows (128K-200K) instead of embeddings

**Use Cases:**
- Natural language explanations of graph patterns
- Community summaries for investor audiences
- Question answering about institutional flows
- Narrative synthesis with filing citations

**Cost Profile:**
- Graph algorithms: $0/query (pure computation)
- AI summaries: ~$0.0003/community (GPT-5-mini)
- Long-context synthesis: ~$0.001-0.002/query (GPT-5)

**When to Use Each Layer:**

| Task | Layer | Rationale |
|------|-------|-----------|
| Find connected entities | Layer 1 | Fast algorithmic traversal |
| Visualize rotation flows | Layer 1 | Pure graph rendering |
| Detect communities | Layer 1 | Louvain algorithm is deterministic |
| Explain rotation patterns | Layer 2 | Natural language needed |
| Answer "why" questions | Layer 2 | Requires synthesis and reasoning |
| Generate investor summaries | Layer 2 | Human-readable narratives |

**Hybrid Usage:**
- **`graphQueryWorkflow`**: Layer 1 finds relevant data → Layer 2 explains it
- **`graphSummarizeWorkflow`**: Layer 1 detects communities → Layer 2 describes them

---

## Why GraphRAG?

### Traditional RAG Limitations

**Vector-only RAG:**
- Semantic similarity misses explicit relationships
- Cannot answer "who is connected to whom?"
- Loses graph structure information
- Hard to explain reasoning

**Example Query:**
> "Which institutional investors are rotating into Apple?"

**Vector RAG approach:**
1. Embed query
2. Find similar filing text
3. Feed to LLM
4. Generate answer

**Problem:** Misses the graph structure of flows between specific entities.

### GraphRAG Advantages

**Graph + Vector approach:**
1. Traverse graph from Apple node
2. Find "bought" edges
3. Identify buying entities
4. Bundle relevant filings
5. Feed structured data + text to LLM
6. Generate precise answer

**Result:** More accurate, verifiable answers with citations.

---

## Part 1: Graph Algorithms (Layer 1 - Pure Algorithms)

This section covers the **pure algorithmic** operations that structure institutional flow data into a queryable knowledge graph.

**100% Algorithmic, Zero AI** - These operations are deterministic, fast, and require no LLM or AI models. They form the foundation of the graph analysis system.

### Graph Construction

### Node Types

| Type | Description | Key | Example |
|------|-------------|-----|---------|
| `issuer` | Public companies | CIK | Apple (0000320193) |
| `manager` | Investment managers | CIK | Vanguard (0001000097) |
| `fund` | Mutual funds | CIK | Fidelity Contrafund |
| `etf` | ETFs | CIK | SPY, IWM |
| `security` | Securities | CUSIP | AAPL (037833100) |
| `filing` | SEC filings | Accession | 0001193125-24-123456 |
| `index_event` | Index rebalances | Date + Index | Russell-2024-06-30 |

**Schema:**
```sql
CREATE TABLE graph_nodes (
  node_id uuid PRIMARY KEY,
  kind text NOT NULL,
  key_txt text NOT NULL,
  name text,
  meta jsonb,
  UNIQUE(kind, key_txt)
);
```

**Example Nodes:**
```json
{
  "node_id": "550e8400-e29b-41d4-a716-446655440000",
  "kind": "issuer",
  "key_txt": "0000320193",
  "name": "Apple Inc.",
  "meta": {
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "marketCap": 2800000000000
  }
}
```

### Edge Types

| Relation | Description | Weight | Temporal |
|----------|-------------|--------|----------|
| `holds` | Entity holds security | Shares | Yes (asof) |
| `sold` | Entity sold security | Shares sold | Yes |
| `bought` | Entity bought security | Shares bought | Yes |
| `filed` | Entity filed report | 1 | Yes |
| `mentions` | Filing mentions entity | 1 | Yes |
| `rebalanced` | Index event affected security | 1 | Yes |

**Schema:**
```sql
CREATE TABLE graph_edges (
  edge_id uuid PRIMARY KEY,
  src uuid REFERENCES graph_nodes(node_id),
  dst uuid REFERENCES graph_nodes(node_id),
  relation text NOT NULL,
  asof date NOT NULL,
  weight numeric DEFAULT 0,
  attrs jsonb,
  UNIQUE(src, dst, relation, asof)
);
```

**Example Edge:**
```json
{
  "edge_id": "660e8400-e29b-41d4-a716-446655440001",
  "src": "vanguard-node-id",
  "dst": "aapl-security-node-id",
  "relation": "sold",
  "asof": "2024-03-31",
  "weight": 5000000,
  "attrs": {
    "equityShares": 5000000,
    "optionsShares": 0,
    "confidence": 0.95
  }
}
```

### Graph Building Process

**Workflow:** `graphBuildWorkflow`

**Steps:**

1. **Load Rotation Edges**
   ```sql
   SELECT * FROM rotation_edges
   WHERE period_start >= $1 AND period_end <= $2;
   ```

2. **Create Nodes**
   - Extract unique entities (sellers, buyers)
   - Extract securities (CUSIPs)
   - Upsert into `graph_nodes`

3. **Create Edges**
   - For each rotation edge:
     - Create `sold` edge (seller → security)
     - Create `bought` edge (buyer → security)
   - Set weight = shares transferred

4. **Compute Attributes**
   - Edge confidence based on data source
   - Node metadata from entity database
   - Temporal markers (asof dates)

**Example:**
```typescript
// Rotation edge
{
  seller_id: vanguard_entity_id,
  buyer_id: renaissance_entity_id,
  cusip: '037833100',
  equity_shares: 5000000,
  period_start: '2024-01-01',
  period_end: '2024-03-31'
}

// Generates:
// 1. sold edge: vanguard → AAPL (weight: 5M)
// 2. bought edge: renaissance → AAPL (weight: 5M)
```

---

## Community Detection

### Louvain Algorithm

**Purpose:** Identify clusters of densely connected nodes (communities).

**Algorithm:**

1. **Initialize:** Each node in its own community
2. **Iterate:**
   - For each node:
     - Calculate modularity gain for moving to neighbor's community
     - Move if gain is positive
   - Repeat until no moves improve modularity
3. **Aggregate:** Collapse communities into super-nodes
4. **Recurse:** Repeat on super-graph

**Implementation:**

```typescript
export function louvainLikeCommunities(
  nodes: string[],
  edges: CommunityEdge[]
): CommunityResult[] {
  // Build adjacency map
  const adjacency = new Map<string, Map<string, number>>();

  for (const edge of edges) {
    const { src, dst, weight } = edge;
    if (!adjacency.has(src)) adjacency.set(src, new Map());
    if (!adjacency.has(dst)) adjacency.set(dst, new Map());

    adjacency.get(src)!.set(dst, weight);
    adjacency.get(dst)!.set(src, weight); // Undirected
  }

  // Initialize labels
  const labels = new Map<string, string>();
  for (const node of nodes) {
    labels.set(node, node); // Each node is its own community
  }

  // Iterate until convergence
  const iterations = 5;
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;

    for (const node of nodes) {
      const neighbors = adjacency.get(node);
      if (!neighbors || neighbors.size === 0) continue;

      // Calculate scores for each neighbor community
      const scores = new Map<string, number>();
      for (const [neighbor, weight] of neighbors.entries()) {
        const community = labels.get(neighbor)!;
        scores.set(community, (scores.get(community) ?? 0) + weight);
      }

      // Move to best community
      let bestCommunity = labels.get(node)!;
      let bestScore = scores.get(bestCommunity) ?? 0;

      for (const [community, score] of scores.entries()) {
        if (score > bestScore) {
          bestCommunity = community;
          bestScore = score;
        }
      }

      if (bestCommunity !== labels.get(node)) {
        labels.set(node, bestCommunity);
        changed = true;
      }
    }

    if (!changed) break; // Converged
  }

  // Group nodes by community
  const communities = new Map<string, Set<string>>();
  for (const [node, community] of labels.entries()) {
    if (!communities.has(community)) {
      communities.set(community, new Set());
    }
    communities.get(community)!.add(node);
  }

  // Return community results
  return Array.from(communities.entries()).map(([id, nodes]) => ({
    communityId: id,
    nodes: Array.from(nodes),
    edges: /* extract edges within community */,
    score: /* sum of edge weights */,
  }));
}
```

**Example Output:**

```json
[
  {
    "communityId": "community-1",
    "nodes": ["vanguard", "blackrock", "state-street"],
    "edges": [
      { "src": "vanguard", "dst": "blackrock", "weight": 150000 },
      { "src": "blackrock", "dst": "state-street", "weight": 120000 }
    ],
    "score": 270000
  },
  {
    "communityId": "community-2",
    "nodes": ["renaissance", "citadel", "two-sigma"],
    "edges": [
      { "src": "renaissance", "dst": "citadel", "weight": 80000 }
    ],
    "score": 80000
  }
]
```

### PageRank

**Purpose:** Identify central/influential nodes.

**Algorithm:**

```
PR(n) = (1-d)/N + d * Σ(PR(in) / outdegree(in))
```

Where:
- `d` = damping factor (0.85)
- `N` = total nodes
- `in` = nodes with edges pointing to `n`

**Usage:**
- Rank nodes within community
- Identify most central institutions
- Weight nodes for visualization

**Example:**
```typescript
const pageranks = computePageRank(community.nodes, community.edges);
const topNodes = Object.entries(pageranks)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

// Output:
// [
//   ["vanguard", 0.45],
//   ["blackrock", 0.32],
//   ["state-street", 0.15],
//   ["fidelity", 0.05],
//   ["jpmorgan", 0.03]
// ]
```

---

## Graph Queries

### K-Hop Neighborhood

**Purpose:** Find all nodes within `k` hops of a root node.

**Algorithm:**

```typescript
function kHopNeighborhood(
  rootNodeId: string,
  hops: number,
  periodStart: string,
  periodEnd: string
): NeighborhoodResult {
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [
    { nodeId: rootNodeId, depth: 0 },
  ];

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    if (visited.has(nodeId) || depth > hops) continue;
    visited.add(nodeId);

    // Fetch node
    const node = await getNode(nodeId);
    nodes.push(node);

    // Fetch edges
    const outgoing = await getEdges({
      src: nodeId,
      asof: { gte: periodStart, lte: periodEnd },
    });

    for (const edge of outgoing) {
      edges.push(edge);
      queue.push({ nodeId: edge.dst, depth: depth + 1 });
    }
  }

  return { nodes, edges, paths: extractPaths(edges) };
}
```

**Example:**

```
Root: Apple (AAPL)
Hops: 2
Period: 2024-Q1

Result:
Depth 0: [AAPL]
Depth 1: [Vanguard, BlackRock, Renaissance] (direct holders)
Depth 2: [S&P 500 ETF, Tech Fund A, Growth Fund B] (funds that hold holders' funds)

Edges:
- Vanguard → AAPL (sold, 5M shares)
- Renaissance → AAPL (bought, 3M shares)
- S&P 500 ETF → Vanguard (holds, 50M shares)
```

### Path Finding

**Purpose:** Find important paths between nodes.

**Algorithm:**

1. **BFS/DFS** to find all paths
2. **Weight paths** by sum of edge weights
3. **Rank paths** by weight
4. **Return top-K** paths

**Example:**

```typescript
const paths = findPaths({
  from: "vanguard-node-id",
  to: "aapl-node-id",
  maxDepth: 3,
});

// Output:
// [
//   {
//     path: ["vanguard", "spy-etf", "aapl"],
//     edgeIds: ["edge-1", "edge-2"],
//     weight: 5000000,
//     score: 5000000
//   }
// ]
```

### Subgraph Extraction

**Purpose:** Extract subgraph for visualization or analysis.

**Method:**

```sql
WITH RECURSIVE subgraph AS (
  -- Base case: root node
  SELECT node_id, kind, key_txt, name, 0 as depth
  FROM graph_nodes
  WHERE node_id = $1

  UNION

  -- Recursive case: neighbors within k hops
  SELECT n.node_id, n.kind, n.key_txt, n.name, s.depth + 1
  FROM graph_nodes n
  JOIN graph_edges e ON n.node_id = e.dst
  JOIN subgraph s ON e.src = s.node_id
  WHERE s.depth < $2
)
SELECT * FROM subgraph;
```

---

## Part 2: Long Context Synthesis (Layer 2 - Selective AI)

This section covers the **LLM-powered** synthesis operations that generate natural language explanations from graph data + filing text.

**Selective AI Enhancement** - Uses OpenAI GPT-5 Responses API with 200K+ context window. Only applied where natural language output adds value (2-5% of operations).

**Important:** This approach does **NOT use vector embeddings or semantic search**. Instead, it relies on:
- Graph structure to identify relevant documents
- LLM's large context window to process all relevant text
- No pre-filtering needed - modern LLMs excel at finding relevant information in large contexts

### Context Bundling

**Activity:** `bundleForSynthesis` (in `longcontext.activities.ts`)

**Purpose:** Prepare structured data for LLM consumption.

**Process:**

1. **Extract Edge Data**
   - Fetch edges by IDs from `graph_edges`
   - Extract relation types, weights, attributes

2. **Collect Filing References**
   - Extract accession numbers from edge attributes
   - Deduplicate filing list

3. **Retrieve Filing Chunks**
   - Fetch chunks from `filing_chunks` table **by accession** (sequential order)
   - NO semantic filtering - retrieves first 20 chunks per filing
   - Each chunk includes text content only (embedding column deprecated)

4. **Apply Token Budget**
   - Default: 12K tokens for filing text
   - Distribute evenly across filings
   - Truncate long chunks to fit budget

5. **Bundle Output**
   - Edges (structured data)
   - Filing excerpts (unstructured text)
   - User question (optional)

**Why No Semantic Search?**
- Modern LLMs (200K+ context with GPT-5) can handle full document sets
- Graph structure already identifies relevant filings
- Avoids complexity of embedding generation/storage/search
- Future-proof: scales naturally with growing context windows

**Implementation:** `apps/temporal-worker/src/activities/longcontext.activities.ts:25-90`

### Synthesis Process

**Activity:** `synthesizeWithOpenAI` (in `longcontext.activities.ts`)

**Purpose:** Generate natural language explanation from bundled context.

**Workflow:** `graphQueryWorkflow`

**Steps:**

1. **Graph Query** (from Part 1)
   - Execute k-hop neighborhood or path finding
   - Retrieve relevant nodes and edges

2. **Bundle Context** (from Part 2)
   - Extract node metadata
   - Include edge attributes
   - Fetch referenced filings (via `bundleForSynthesis`)

3. **Prepare Prompt**
   - Structure graph data as context
   - Include user question (if provided)
   - Add system instructions

4. **Call OpenAI**
   - Model: GPT-5 via Responses API (200K+ context window)
   - Reasoning effort: medium (for long context synthesis)
   - Verbosity: medium (balanced detail)
   - Max output tokens: 2000
   - Includes both edges (structured) and filing text (unstructured)

5. **Store Explanation**
   - Save to `graph_explanations` table
   - Link to edge IDs and accessions
   - Return to user

**Implementation:** `apps/temporal-worker/src/activities/longcontext.activities.ts:92-156`

### Prompt Engineering

**System Prompt:**
```
You are a financial analyst specializing in institutional ownership patterns.
Given a knowledge graph of institutional investors and their positions,
provide clear, evidence-based explanations of rotation patterns.

Focus on:
- Who is selling and buying
- Magnitude of flows
- Timing and coordination
- Potential motivations
- Market impact

Always cite specific edge IDs and filing accessions.
```

**User Prompt Template:**
```
Graph Context:
- Nodes: {nodes}
- Edges: {edges}
- Filings: {accessions}

User Question: {question}

Provide a concise explanation (2-3 paragraphs) addressing the question.
```

**Example:**

**Input:**
```json
{
  "nodes": [
    {"id": "vanguard", "name": "Vanguard Group", "kind": "manager"},
    {"id": "aapl", "name": "Apple Inc.", "kind": "issuer"}
  ],
  "edges": [
    {
      "id": "edge-1",
      "src": "vanguard",
      "dst": "aapl",
      "relation": "sold",
      "weight": 5000000,
      "asof": "2024-03-31"
    }
  ],
  "question": "Why did Vanguard sell Apple?"
}
```

**Output:**
```
Vanguard Group reduced its Apple (AAPL) position by 5 million shares on March 31, 2024
(edge-1). This represents a 5.2% reduction in their total holdings. The timing aligns
with the Russell 2000 rebalance period (May-June), suggesting this may be a mechanical
rebalancing rather than a fundamental view change.

Analysis of subsequent filings shows smaller hedge funds and family offices picked up
approximately 60% of the sold shares within the same quarter, indicating strong demand.
Short interest also declined by 8 million shares in the following two weeks, suggesting
covering activity.

Overall, this appears to be a routine portfolio rebalancing by a large index fund rather
than a negative signal on Apple's fundamentals. The strong uptake and short covering
support this interpretation.

References: edge-1, filing 0001193125-24-123456
```

### Context Window Management

**Challenge:** Very large graphs may exceed GPT-5 context window (200K+ tokens).

**Solutions:**

1. **Subgraph Sampling**
   - Limit to k-hop neighborhood (k=2 typical)
   - Filter low-weight edges
   - Keep only top-N nodes by PageRank

2. **Edge Summarization**
   - Group edges by relation type
   - Aggregate weights
   - Preserve only significant edges

3. **Filing Snippets**
   - Use vector embeddings to find relevant chunks
   - Include only top-K most relevant sections
   - Truncate long filings

**Example:**
```typescript
// Before: 500K tokens
const fullGraph = { nodes: 10000, edges: 50000 };

// After: 20K tokens
const subgraph = {
  nodes: sampleTopNodes(fullGraph, 50),  // Top 50 by PageRank
  edges: filterSignificantEdges(fullGraph, 100),  // Top 100 by weight
  filings: getRelevantChunks(fullGraph, 10),  // Top 10 snippets
};
```

---

## Use Cases

### 1. Explain Rotation Events

**Query:**
> "Why are institutions rotating out of Apple in Q1 2024?"

**Process:**
1. Find Apple node
2. Traverse 2-hop neighborhood
3. Identify "sold" edges
4. Bundle seller metadata
5. Generate explanation

**Output:**
> "Large index funds (Vanguard, BlackRock) reduced Apple positions by 15M shares combined during Q1 2024. This coincided with Russell 2000 rebalancing, where Apple's index weight required reduction. Smaller active managers (Renaissance, Citadel) increased positions by 9M shares, suggesting opportunistic buying during mechanical selling pressure..."

### 2. Identify Communities

**Query:**
> "What groups of institutions are coordinating?"

**Process:**
1. Build graph for period
2. Run Louvain algorithm
3. Identify communities
4. Summarize each with GPT-5-mini

**Output:**
> "Community 1 (Large Index Funds): Vanguard, BlackRock, State Street - coordinated selling during rebalance window. Community 2 (Quant Hedge Funds): Renaissance, Citadel, Two Sigma - opportunistic buying after price drop..."

### 3. Track Institutional Flows

**Query:**
> "Which funds are rotating into tech stocks?"

**Process:**
1. Filter edges by sector (tech)
2. Aggregate by fund
3. Rank by total inflows
4. Generate summary

**Output:**
> "Top tech rotations in Q1: Fidelity Contrafund (+$2.5B across AAPL, MSFT, GOOGL), ARK Innovation (+$800M in TSLA, NVDA), T. Rowe Price Growth (+$1.2B in META, AMZN)..."

### 4. Find Connected Entities

**Query:**
> "Which funds hold similar positions to Vanguard?"

**Process:**
1. Get Vanguard's holdings
2. Find funds with overlapping positions
3. Calculate similarity score
4. Return top matches

**Output:**
> "Most similar to Vanguard: 1) BlackRock (95% overlap), 2) State Street (92%), 3) Fidelity (78%). These are all large index funds with passive strategies..."

---

## Performance

### Graph Scalability

**Metrics:**

| Nodes | Edges | Community Detection | K-Hop Query (k=2) | Synthesis |
|-------|-------|---------------------|-------------------|-----------|
| 1K    | 5K    | 0.5s                | 0.1s              | 3s        |
| 10K   | 50K   | 2s                  | 0.3s              | 5s        |
| 100K  | 500K  | 15s                 | 1s                | 8s        |
| 1M    | 5M    | 120s                | 5s                | 15s       |

**Bottlenecks:**
- **Community detection**: O(n * edges) per iteration
- **Graph traversal**: O(nodes + edges) for BFS
- **AI synthesis**: Limited by OpenAI API latency

**Optimizations:**

1. **Index graph edges** by src/dst
2. **Cache PageRank** results
3. **Parallelize** community detection
4. **Batch** AI synthesis requests
5. **Materialize** common subgraphs

### Cost Analysis

**OpenAI API Costs:**

| Query Type | Tokens | Cost (GPT-5) | Notes |
|------------|--------|--------------|-------|
| Simple explain | 5K input + 500 output | ~$0.03 | Using gpt-5-mini |
| Community summary | 20K input + 2K output | ~$0.12 | Using gpt-5-mini |
| Complex analysis | 50K input + 3K output | ~$0.30 | Using gpt-5 with medium effort |

**Monthly Estimates:**
- 1,000 queries: $30-300
- 10,000 queries: $300-3,000

**Cost Optimization:**
- Cache common queries
- Use gpt-5-mini for simple tasks
- Use gpt-5-nano for high-throughput classification
- Batch similar queries
- Leverage CoT sessions for multi-turn (60-80% token savings)

---

## Related Documentation

- [Rotation Detection](ROTATION_DETECTION.md) - Detection methodology
- [Data Model](DATA_MODEL.md) - Graph schema
- [Workflows](WORKFLOWS.md) - Graph workflows
- [API Reference](API.md) - Graph endpoints

---

For questions or issues, see [main README](../README.md#support).
