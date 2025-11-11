# Real-time Graph Visualization Design

## Overview

A real-time graph visualization system that displays institutional ownership networks as GraphRAG analysis progresses. The system intelligently determines when graph visualization adds value and streams updates as new connections are discovered.

## Use Case Analysis

### ✅ HIGH VALUE - Graph Visualization is Critical

#### 1. Community Detection Queries
**Example:** "What communities exist in the institutional ownership network?"

**Value:**
- Visually shows distinct clusters of institutions
- Color-coded by community membership
- Edge thickness = co-holding strength
- Spatial separation = community boundaries

**Graph Structure:**
- **Nodes:** Institutions (colored by community)
- **Edges:** Co-holding relationships (thickness = similarity score)
- **Layout:** Force-directed to naturally separate communities

#### 2. Cross-Community Analysis
**Example:** "Which institutions are rotating between tech stocks?"

**Value:**
- Shows multi-stock relationships clearly
- Institution nodes connected to multiple ticker nodes
- Rotation patterns visible as edge colors (green=increase, red=decrease)
- Central institutions = active rotators

**Graph Structure:**
- **Nodes:** Institutions (circles) + Tickers (squares)
- **Edges:** Holdings (color = direction, thickness = magnitude)
- **Layout:** Bipartite (institutions on left, stocks on right)

#### 3. Correlation Analysis
**Example:** "Which institutions have highly correlated position changes?"

**Value:**
- Edge thickness = correlation strength (0.0-1.0)
- Anomalous correlations highlighted in red
- Network patterns reveal coordinated trading
- Isolated nodes = independent movers

**Graph Structure:**
- **Nodes:** Institutions (size = total portfolio value)
- **Edges:** Correlation (thickness = coefficient, color = positive/negative)
- **Layout:** Force-directed with repulsion

#### 4. Graph Structure Overview
**Example:** "What is the density of the institutional ownership network?"

**Value:**
- Visual topology of entire network
- Hub nodes immediately visible (high degree centrality)
- Network density apparent from edge count
- Subgraphs and isolated components visible

**Graph Structure:**
- **Nodes:** All entities (institutions + issuers)
- **Edges:** All relationships
- **Layout:** Force-directed or hierarchical

#### 5. Smart Money Tracking
**Example:** "What are the top performers buying now?"

**Value:**
- Top performers = larger nodes
- Consensus positions = stocks with many edges
- Divergent positions = isolated edges
- Portfolio concentration visible

**Graph Structure:**
- **Nodes:** Top institutions (size = performance rank) + Stocks
- **Edges:** Current holdings (green = recent increase)
- **Layout:** Radial (top performers in center)

### ⚠️ MEDIUM VALUE - Helpful But Not Critical

#### 1. Single Ticker Analysis
**Example:** "Which institutions increased their AAPL positions?"

**Value:**
- Central ticker node with institution satellites
- Edge color = entry/exit/increase/decrease
- Edge thickness = position size
- Quick visual of holder distribution

**Graph Structure:**
- **Nodes:** AAPL (center) + Institutions (around)
- **Edges:** Holdings (color-coded by type)
- **Layout:** Radial (ticker in center)

**Note:** Better as a list for simple queries, but graph adds value when exploring holder relationships.

#### 2. Temporal Evolution
**Example:** "How have positions evolved quarter over quarter?"

**Value:**
- Animated time-series of network changes
- Nodes appear/disappear over time
- Edge weights animate
- Growth patterns visible

**Graph Structure:**
- **Time slider:** Animate through quarters
- **Nodes:** Institutions + Stocks (opacity = activity)
- **Edges:** Holdings (animated thickness changes)

**Note:** Complex to implement, high cognitive load. Consider offering as optional view.

### ❌ LOW VALUE - Better as Tables/Lists

#### 1. Simple Lookups
**Example:** "What stocks does BlackRock hold?"

**Why Not:** Just a list. No relationships to explore. Table format is clearer.

#### 2. Statistical Outliers
**Example:** "What are the statistical outliers in position changes?"

**Why Not:** Numbers and tables communicate outliers better than spatial relationships.

#### 3. Single-Question Answers
**Example:** "What is Vanguard's largest position?"

**Why Not:** Single data point. No network to visualize.

#### 4. Quantitative Analysis
**Example:** "Calculate correlation matrix between positions"

**Why Not:** Matrix/heatmap format is superior to graph for displaying correlation data.

## Graph Data Model

### Node Types

```typescript
interface GraphNode {
  id: string;
  type: 'institution' | 'issuer' | 'community' | 'concept';
  label: string;
  size: number; // Visual size (based on importance)
  color: string; // Category or cluster color
  metadata: {
    // Type-specific data
    ticker?: string;
    institution?: string;
    communityId?: string;
    portfolioValue?: number;
    performanceRank?: number;
  };
  x?: number; // Position (for layout)
  y?: number;
}
```

### Edge Types

```typescript
interface GraphEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  type: 'holds' | 'correlatedWith' | 'sameCommunity' | 'increased' | 'decreased';
  weight: number; // Thickness/strength (0.0-1.0)
  color: string;
  label?: string;
  metadata: {
    // Type-specific data
    shares?: number;
    percentChange?: number;
    correlationCoefficient?: number;
    quarter?: string;
  };
}
```

### Graph State

```typescript
interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: 'force' | 'circular' | 'hierarchical' | 'radial';
  highlightedNodes: Set<string>;
  filteredNodeTypes: Set<string>;
  isAnimating: boolean;
  timestamp: Date;
}
```

## Real-time Streaming Protocol

### SSE Event Format

```typescript
// Event: graph_init
{
  type: 'graph_init',
  workflowId: string,
  questionIndex: number,
  graphType: 'community' | 'cross-community' | 'correlation' | 'overview' | 'smart-money',
  recommendedLayout: 'force' | 'circular' | 'radial',
  metadata: {
    totalNodes: number,
    totalEdges: number,
  }
}

// Event: node_discovered
{
  type: 'node_discovered',
  workflowId: string,
  node: GraphNode,
  reasoning: string, // Why this node is relevant
}

// Event: edge_discovered
{
  type: 'edge_discovered',
  workflowId: string,
  edge: GraphEdge,
  reasoning: string, // Why this connection matters
}

// Event: graph_complete
{
  type: 'graph_complete',
  workflowId: string,
  finalNodeCount: number,
  finalEdgeCount: number,
  insights: string[], // Key takeaways from graph structure
}
```

## Visualization Features

### Core Features

1. **Incremental Rendering**
   - Nodes appear with fade-in animation
   - Edges draw from source to target
   - Layout stabilizes after each addition
   - Smooth transitions (300ms)

2. **Interactive Controls**
   - Zoom (mouse wheel)
   - Pan (drag background)
   - Node drag (reposition)
   - Click node → Highlight neighbors
   - Hover node → Show tooltip

3. **Layout Algorithms**
   - **Force-directed:** Default for most cases (D3 force simulation)
   - **Circular:** Community detection (equal spacing around circle)
   - **Hierarchical:** Parent-child relationships (tree layout)
   - **Radial:** Single-ticker analysis (center + satellites)

4. **Visual Encoding**
   - **Node size:** Importance (portfolio value, centrality, performance)
   - **Node color:** Type or community
   - **Edge thickness:** Strength (correlation, position size, co-holding)
   - **Edge color:** Type (green=increase, red=decrease, blue=correlation)
   - **Edge style:** Solid=active, dashed=historical

### Advanced Features

1. **Graph Statistics Overlay**
   - Node count
   - Edge count
   - Average degree
   - Clustering coefficient
   - Network density
   - Largest community size

2. **Search & Filter**
   - Search by node label
   - Filter by node type (show/hide institutions, issuers)
   - Filter by edge type
   - Min/max edge weight slider

3. **Temporal Animation** (optional)
   - Time slider for quarter-by-quarter evolution
   - Play/pause animation
   - Speed control (0.5x, 1x, 2x)

4. **Export**
   - Export as PNG/SVG
   - Export graph data as JSON
   - Export adjacency matrix as CSV

## UI Integration

### Q&A Console Integration

```
┌─────────────────────────────────────────────────────────┐
│ Q&A Console                                             │
├─────────────────────────────────────────────────────────┤
│ Q: Which institutions are rotating between tech stocks? │
│                                                          │
│ A: [Streaming text answer...]                           │
│                                                          │
│ 📊 Graph View Available                                 │
│ [Show Graph] [Keep Hidden]                              │
└─────────────────────────────────────────────────────────┘

After clicking "Show Graph":

┌─────────────────────────────────────────────────────────┐
│ Q&A Console                                             │
├──────────────────────┬──────────────────────────────────┤
│ Text Answer          │ Graph Visualization               │
│                      │                                   │
│ Analysis shows...    │   [Interactive Graph]             │
│ - BlackRock rotated  │     ┌─┐                          │
│ - Vanguard reduced   │  ●──┤ │──●  AAPL                 │
│ - State Street...    │     └─┘   ╲                      │
│                      │            ╲  MSFT               │
│ [Hide Graph]         │             ●                     │
│                      │                                   │
│                      │ [Controls] [Export] [Reset]       │
└──────────────────────┴──────────────────────────────────┘
```

### Decision Logic

```typescript
function shouldShowGraph(questions: string[], questionType: string): boolean {
  // High value cases
  if (questionType === 'community-detection') return true;
  if (questionType === 'cross-community') return true;
  if (questionType === 'correlation') return true;
  if (questionType === 'smart-money') return true;
  if (questionType === 'graph-overview') return true;

  // Check for network-related keywords
  const networkKeywords = [
    'community', 'cluster', 'network', 'connected', 'relationship',
    'correlation', 'pattern', 'rotating between', 'across stocks'
  ];

  const hasNetworkKeyword = questions.some(q =>
    networkKeywords.some(kw => q.toLowerCase().includes(kw))
  );

  return hasNetworkKeyword;
}
```

## Technical Implementation

### Technology Stack

- **Visualization Library:** react-force-graph-2d
  - Pros: React-native, performant, supports incremental updates
  - Cons: Limited layout algorithms (mostly force-directed)
  - Alternative: D3.js with custom React wrapper (more flexible)

- **Graph Layout:** d3-force for force-directed simulation
  - d3-hierarchy for tree layouts
  - Custom algorithms for radial and circular

- **Streaming:** SSE (Server-Sent Events)
  - Extends existing workflow streaming
  - New event types: node_discovered, edge_discovered

- **State Management:** React useState/useReducer
  - Graph state in component
  - Updates via reducer pattern for clean incremental additions

### Performance Considerations

1. **Node Limits**
   - Up to 200 nodes: Full force simulation
   - 200-500 nodes: Simplified physics
   - 500+ nodes: Static layout or clustering

2. **Rendering Optimization**
   - Canvas rendering (not SVG) for 100+ nodes
   - Level-of-detail: Hide labels on distant nodes
   - Lazy edge rendering: Only draw visible edges

3. **Animation**
   - Debounce layout updates during rapid additions
   - Batch node/edge additions (every 200ms)
   - Pause simulation after 2 seconds of stability

## Example Scenarios

### Scenario 1: Community Detection

**Question:** "What communities exist in the institutional ownership network?"

**Graph Evolution:**
1. Initialize empty graph
2. Add institution nodes (colored by preliminary clusters)
3. Add edges between institutions with co-holdings
4. Clusters naturally separate via force simulation
5. Final graph shows 3-5 distinct communities

**Insights:**
- "3 distinct communities identified"
- "Community 1 (blue): Value investors - 8 institutions"
- "Community 2 (green): Growth investors - 12 institutions"
- "Edge thickness represents co-holding strength"

### Scenario 2: Tech Sector Rotations

**Question:** "Which institutions are rotating between AAPL, MSFT, and GOOGL?"

**Graph Evolution:**
1. Add ticker nodes (AAPL, MSFT, GOOGL) in center
2. Add institution nodes around tickers
3. Add green edges for increased positions
4. Add red edges for decreased positions
5. Highlight institutions with edges to multiple tickers

**Insights:**
- "5 institutions actively rotating"
- "BlackRock: Increased AAPL (green), Decreased MSFT (red)"
- "Pattern suggests rotation from MSFT to AAPL in tech sector"

### Scenario 3: Correlation Analysis

**Question:** "Which institutions have highly correlated position changes?"

**Graph Evolution:**
1. Add all institution nodes
2. Calculate pairwise correlations
3. Add edges for correlations > 0.7 (thick)
4. Add edges for correlations > 0.5 (medium)
5. Highlight anomalous correlations (unexpected pairs)

**Insights:**
- "Average correlation: 0.42"
- "Highly correlated pair: BlackRock ↔ Vanguard (0.87)"
- "Anomaly detected: JPMorgan ↔ Goldman Sachs (-0.65 negative correlation)"

## Implementation Priority

### Phase 1: Core Visualization (Week 1)
- [ ] Graph data types and utilities
- [ ] Force-directed graph component with react-force-graph-2d
- [ ] Basic node/edge rendering
- [ ] SSE integration for real-time updates
- [ ] Toggle graph view in Q&A console

### Phase 2: Interactivity (Week 2)
- [ ] Zoom, pan, node dragging
- [ ] Node hover tooltips
- [ ] Node click → Highlight neighbors
- [ ] Graph controls panel (layout, filters)
- [ ] Export graph as image/JSON

### Phase 3: Intelligence (Week 3)
- [ ] Auto-detect when graph is valuable
- [ ] Multiple layout algorithms
- [ ] Graph statistics overlay
- [ ] Search and filter functionality
- [ ] Optimized rendering for large graphs (100+ nodes)

## Success Metrics

1. **Adoption:** % of graph-enabled Q&A sessions where user opens graph view
2. **Engagement:** Average time spent interacting with graph
3. **Insight:** User feedback on graph helpfulness (1-5 scale)
4. **Performance:** Graph renders in < 1 second for typical cases (< 100 nodes)

## Open Questions

1. Should we support 3D graph visualization? (react-force-graph-3d)
   - Pro: More spatial relationships visible
   - Con: Harder to navigate, higher cognitive load

2. How to handle very large graphs (1000+ nodes)?
   - Option A: Clustering/aggregation
   - Option B: Show top N most relevant nodes
   - Option C: Progressive disclosure (expand clusters on click)

3. Should graph state persist across questions in same session?
   - Pro: See evolution of analysis across multiple questions
   - Con: Graph becomes cluttered

4. Mobile support?
   - Graph interaction is challenging on small screens
   - Consider showing static graph image or disabling on mobile
