# Real-time Graph Visualization System

## Overview

This system provides intelligent, real-time graph visualization of institutional ownership networks during GraphRAG Q&A analysis. It automatically determines when graph visualization adds value and streams updates as new connections are discovered.

## Status

**Phase: Design & Foundation Complete** ✅

- ✅ Comprehensive use case analysis
- ✅ Graph data types and utilities
- ✅ Decision logic for when to show graphs
- ✅ SSE event protocol design
- ⏳ Interactive visualization component (next phase)
- ⏳ Q&A console integration (next phase)

## When Graph Visualization is Shown

### ✅ HIGH VALUE (Always Show)

1. **Community Detection** - "What communities exist in the institutional ownership network?"
   - **Why:** Visual clusters show distinct investment styles
   - **Graph:** Institutions colored by community, edges = co-holdings

2. **Cross-Community Analysis** - "Which institutions are rotating between tech stocks?"
   - **Why:** Multi-stock relationships are clearer visually
   - **Graph:** Bipartite layout (institutions ↔ stocks), edge colors = direction

3. **Correlation Analysis** - "Which institutions have correlated position changes?"
   - **Why:** Network patterns reveal coordinated trading
   - **Graph:** Edge thickness = correlation strength

4. **Graph Overview** - "What is the network topology?"
   - **Why:** Visual topology reveals structure immediately
   - **Graph:** Force-directed layout of entire network

5. **Smart Money Tracking** - "What are top performers buying?"
   - **Why:** Consensus positions visible as converging edges
   - **Graph:** Radial layout (top performers in center)

### ⚠️ MEDIUM VALUE (Offer as Option)

- Single ticker analysis (radial view)
- Temporal evolution (animated)

### ❌ NOT SHOWN (Better as Tables)

- Simple lookups
- Statistical outliers
- Single data points

## Architecture

### Data Flow

```
Q&A Question Submitted
        ↓
Decision: Should Show Graph?
  ├─ YES → Initialize Graph View
  │        ↓
  │   GraphRAG Analysis Begins
  │        ↓
  │   SSE Stream: node_discovered
  │        ↓
  │   Add Node to Graph (animated)
  │        ↓
  │   SSE Stream: edge_discovered
  │        ↓
  │   Add Edge to Graph (animated)
  │        ↓
  │   Layout Algorithm Updates
  │        ↓
  │   SSE Stream: graph_complete
  │        ↓
  │   Show Final Insights
  │
  └─ NO → Show Text-Only Results
```

### Graph Data Model

```typescript
// Nodes represent entities
GraphNode {
  id: string
  type: 'institution' | 'issuer' | 'community' | 'concept'
  label: string
  size: number (1-10, based on importance)
  color: string
  metadata: { ticker?, institution?, communityId?, ... }
}

// Edges represent relationships
GraphEdge {
  id: string
  source: string (node ID)
  target: string (node ID)
  type: 'holds' | 'increased' | 'decreased' | 'correlatedWith' | ...
  weight: number (0.0-1.0, affects thickness)
  color: string
  metadata: { shares?, percentChange?, ... }
}
```

### SSE Event Protocol

```typescript
// Initialize graph
{ type: 'graph_init', graphType: 'community', recommendedLayout: 'force' }

// Add node
{ type: 'node_discovered', node: GraphNode, reasoning: "..." }

// Add edge
{ type: 'edge_discovered', edge: GraphEdge, reasoning: "..." }

// Complete
{ type: 'graph_complete', insights: ["3 communities found", ...] }
```

## Usage

### Automatic Detection

```typescript
import { shouldShowGraphVisualization, determineGraphType } from '@/lib/graph-utils';

const questions = [
  "Which institutions are rotating between AAPL and MSFT?",
  "What patterns exist in the tech sector?"
];

if (shouldShowGraphVisualization(questions, 'cross-community')) {
  const graphType = determineGraphType(questions); // 'cross-community'
  const layout = getRecommendedLayout(graphType); // 'force'

  // Initialize graph view
  initializeGraph({ graphType, layout });
}
```

### Manual Graph Building

```typescript
import { GraphNode, GraphEdge, calculateGraphStatistics } from '@/lib/graph-utils';

// Create nodes
const nodes: GraphNode[] = [
  {
    id: 'blackrock',
    type: 'institution',
    label: 'BlackRock Inc',
    size: 8,
    color: '#3b82f6',
    metadata: { institution: 'BlackRock', portfolioValue: 9000000000 }
  },
  {
    id: 'aapl',
    type: 'issuer',
    label: 'AAPL',
    size: 6,
    color: '#10b981',
    metadata: { ticker: 'AAPL' }
  }
];

// Create edges
const edges: GraphEdge[] = [
  {
    id: 'blackrock-aapl',
    source: 'blackrock',
    target: 'aapl',
    type: 'increased',
    weight: 0.8,
    color: '#10b981',
    metadata: { percentChange: 25.5, shares: 5000000 }
  }
];

// Calculate statistics
const stats = calculateGraphStatistics(nodes, edges);
// { nodeCount: 2, edgeCount: 1, averageDegree: 1.0, ... }
```

### Export Graph Data

```typescript
import { exportGraphData } from '@/lib/graph-utils';

// Export as JSON
const json = exportGraphData(nodes, edges, 'json');

// Export as CSV
const csv = exportGraphData(nodes, edges, 'csv');

// Download
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'graph-data.json';
a.click();
```

## Implementation Roadmap

### Phase 1: Foundation ✅ (Current)
- [x] Design document with use case analysis
- [x] Graph data types and interfaces
- [x] Utility functions (colors, sizes, statistics)
- [x] Decision logic for when to show graphs
- [x] SSE event protocol design

### Phase 2: Interactive Component (Next)
- [ ] Install react-force-graph-2d dependency
- [ ] Create `<GraphVisualization>` component
- [ ] Implement force-directed layout with D3
- [ ] Add zoom, pan, and drag interactions
- [ ] Node hover tooltips
- [ ] Click to highlight neighbors

### Phase 3: Integration
- [ ] Add graph view toggle to Q&A console
- [ ] Connect SSE stream to graph component
- [ ] Animate node/edge additions
- [ ] Display graph statistics overlay
- [ ] Export graph as PNG/SVG

### Phase 4: Advanced Features
- [ ] Multiple layout algorithms (circular, radial, hierarchical)
- [ ] Search and filter controls
- [ ] Temporal animation for evolution over time
- [ ] Graph comparison (before/after)
- [ ] Performance optimization for large graphs (500+ nodes)

## Example Scenarios

### Scenario 1: Community Detection

**Input:**
```typescript
Question: "What communities exist in the institutional ownership network?"
```

**Graph Output:**
```
Nodes: 45 institutions
Edges: 89 co-holding relationships
Layout: Force-directed
Communities: 4 (color-coded)

Insights:
- Community 1 (blue): Value investors - 12 institutions
- Community 2 (green): Growth investors - 18 institutions
- Community 3 (red): Index funds - 10 institutions
- Community 4 (orange): Hedge funds - 5 institutions
```

### Scenario 2: Tech Sector Rotations

**Input:**
```typescript
Questions: [
  "Which institutions increased AAPL positions?",
  "Which decreased MSFT positions?",
  "Are there rotation patterns?"
]
```

**Graph Output:**
```
Nodes: 3 tickers (AAPL, MSFT, GOOGL) + 15 institutions
Edges: 32 holdings (green=increased, red=decreased)
Layout: Force-directed

Insights:
- 5 institutions rotated from MSFT to AAPL
- BlackRock: +25% AAPL, -15% MSFT (green edge, red edge)
- Pattern: Momentum shift toward AAPL in tech sector
```

## Dependencies

### Required (Future)
```json
{
  "react-force-graph-2d": "^1.25.4",
  "d3-force": "^3.0.0",
  "d3-hierarchy": "^3.1.2"
}
```

### Alternative Libraries

**Option A: react-force-graph-2d** (Recommended)
- Pros: React-native, performant, easy to use
- Cons: Less customization, primarily force-directed layout
- Use case: Most scenarios (community, correlation, overview)

**Option B: D3.js + Custom React Wrapper**
- Pros: Maximum flexibility, all layout algorithms
- Cons: More complex, steeper learning curve
- Use case: Advanced visualizations, custom layouts

**Option C: vis.js**
- Pros: Feature-rich, good documentation
- Cons: Not React-native, larger bundle size
- Use case: Rapid prototyping

## Performance Considerations

### Node Count Thresholds

- **< 100 nodes:** Full force simulation, all features enabled
- **100-200 nodes:** Simplified physics, hide some labels
- **200-500 nodes:** Static layout or clustering
- **500+ nodes:** Aggregation required (show top N or cluster)

### Optimization Strategies

1. **Canvas rendering** (not SVG) for 100+ nodes
2. **Level-of-detail:** Hide labels on distant nodes during zoom
3. **Lazy edge rendering:** Only draw visible edges in viewport
4. **Debounced layout:** Batch updates every 200ms
5. **Animation limits:** Pause simulation after 2s of stability

## Testing Strategy

### Unit Tests
- Utility functions (colors, sizes, statistics)
- Decision logic (shouldShowGraph, determineGraphType)
- Data export (JSON, CSV formats)

### Integration Tests
- SSE event processing
- Incremental graph building
- Layout algorithm correctness

### Visual Tests
- Snapshot testing for different graph types
- Interactive behavior (zoom, pan, click)
- Animation smoothness

## Questions & Decisions

### Q: Support 3D graphs?
**Decision:** No for MVP. 3D adds complexity and cognitive load. Focus on 2D with excellent UX.

### Q: How to handle 1000+ node graphs?
**Decision:**
- Option 1: Show top 100 most relevant nodes
- Option 2: Cluster nodes by community (clickable to expand)
- Option 3: Progressive disclosure (start with high-level, drill down)

**Recommendation:** Option 2 (clustering) provides best balance.

### Q: Should graph persist across multiple questions?
**Decision:** Yes, but with clear button. User can see how analysis evolves, but can reset to avoid clutter.

### Q: Mobile support?
**Decision:** Show static graph image on mobile (< 768px). Interactive graph requires desktop screen size.

## References

- **Design Doc:** `GRAPH_VISUALIZATION_DESIGN.md`
- **Utilities:** `lib/graph-utils.ts`
- **D3 Force Simulation:** https://github.com/d3/d3-force
- **react-force-graph:** https://github.com/vasturiano/react-force-graph

## Contact

For questions or contributions related to graph visualization:
- Review design doc for detailed analysis
- Check utility functions for data model
- See roadmap for implementation phases
