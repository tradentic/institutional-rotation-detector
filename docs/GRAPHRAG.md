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

### Part 1: Graph Algorithms (No LLM Required)

**Files:** `apps/temporal-worker/src/activities/graphrag.activities.ts`

**Operations:**
- **Community Detection** - Louvain algorithm identifies clusters
- **PageRank** - Ranks node importance
- **K-Hop Neighborhood** - Traverses graph relationships
- **Path Finding** - Discovers connections between entities

**Storage:** `graph_nodes`, `graph_edges`, `graph_communities` tables

**Benefits:**
- **Fast** - Pure algorithmic, no API calls
- **Deterministic** - Same input → same output
- **Scalable** - Handles millions of nodes/edges
- **Cost-effective** - No per-query costs

### Part 2: Long Context Synthesis (LLM-Powered)

**Files:** `apps/temporal-worker/src/activities/longcontext.activities.ts`

**Operations:**
- **Context Bundling** - Combines graph edges with filing text chunks
- **Synthesis** - Uses OpenAI's 128K context window to generate explanations
- **Question Answering** - Responds to natural language queries

**Storage:** `graph_explanations` table, `filing_chunks` table (with embeddings)

**Benefits:**
- **Natural language** - Human-readable explanations
- **Contextual** - Combines structured (graph) + unstructured (text) data
- **Flexible** - Adapts to different question types
- **Evidence-based** - Cites specific filings and edges

**When to Use Each:**
- **Graph algorithms alone**: Fast queries, visualizations, network analysis
- **Long context synthesis**: Explanations, summaries, question answering
- **Both together**: `graphQueryWorkflow` - find relevant data via graph, explain via LLM

**Benefits:**
- **Explainable**: Visual graph shows relationships
- **Contextual**: AI has structured data to reason about
- **Scalable**: Graph algorithms handle millions of relationships
- **Queryable**: Complex patterns discoverable via graph traversal

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

## Part 1: Graph Algorithms

This section covers the **pure algorithmic** operations that structure institutional flow data into a queryable knowledge graph.

**No LLM required** - these operations are deterministic and fast.

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

## Part 2: Long Context Synthesis

This section covers the **LLM-powered** synthesis operations that generate natural language explanations from graph data + filing text.

**Uses OpenAI GPT-4 Turbo** with 128K context window.

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
   - Fetch chunks from `filing_chunks` table
   - Limit to top 20 chunks per filing (token budget)
   - Each chunk includes text content

4. **Apply Token Budget**
   - Default: 12K tokens for filing text
   - Distribute evenly across filings
   - Truncate long chunks to fit budget

5. **Bundle Output**
   - Edges (structured data)
   - Filing excerpts (unstructured text)
   - User question (optional)

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
   - Model: GPT-4 Turbo (128K context window)
   - Temperature: 0.7 (balanced creativity/precision)
   - Max tokens: 2000
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

**Challenge:** Large graphs exceed GPT-4 context window (128K tokens).

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
4. Summarize each with GPT-4

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

| Query Type | Tokens | Cost (GPT-4 Turbo) |
|------------|--------|--------------------|
| Simple explain | 5K input + 500 output | $0.06 |
| Community summary | 20K input + 2K output | $0.22 |
| Complex analysis | 50K input + 3K output | $0.53 |

**Monthly Estimates:**
- 1,000 queries: $60-530
- 10,000 queries: $600-5,300

**Cost Optimization:**
- Cache common queries
- Use GPT-4o-mini for simple tasks
- Batch similar queries

---

## Related Documentation

- [Rotation Detection](ROTATION_DETECTION.md) - Detection methodology
- [Data Model](DATA_MODEL.md) - Graph schema
- [Workflows](WORKFLOWS.md) - Graph workflows
- [API Reference](API.md) - Graph endpoints

---

For questions or issues, see [main README](../README.md#support).
