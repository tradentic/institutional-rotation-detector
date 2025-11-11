/**
 * Graph Visualization Data Types and Utilities
 *
 * Types and helper functions for real-time graph visualization of
 * institutional ownership networks during GraphRAG Q&A analysis.
 */

// Node types in the institutional ownership graph
export type NodeType = 'institution' | 'issuer' | 'community' | 'concept';

// Edge types representing different relationships
export type EdgeType =
  | 'holds'
  | 'increased'
  | 'decreased'
  | 'correlatedWith'
  | 'sameCommunity'
  | 'rotation';

// Graph layout algorithms
export type LayoutType = 'force' | 'circular' | 'hierarchical' | 'radial';

// Graph type based on query
export type GraphType =
  | 'community'
  | 'cross-community'
  | 'correlation'
  | 'overview'
  | 'smart-money'
  | 'single-ticker';

// Graph node
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  size: number; // Visual size (1-10 scale)
  color: string;
  metadata: {
    ticker?: string;
    institution?: string;
    communityId?: string;
    portfolioValue?: number;
    performanceRank?: number;
    shareCount?: number;
    [key: string]: any;
  };
  x?: number; // Position (set by layout algorithm)
  y?: number;
}

// Graph edge
export interface GraphEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  type: EdgeType;
  weight: number; // 0.0-1.0 (affects visual thickness)
  color: string;
  label?: string;
  metadata: {
    shares?: number;
    percentChange?: number;
    correlationCoefficient?: number;
    quarter?: string;
    value?: number;
    [key: string]: any;
  };
}

// Complete graph state
export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: LayoutType;
  graphType: GraphType;
  highlightedNodes: Set<string>;
  filteredNodeTypes: Set<NodeType>;
  isAnimating: boolean;
  timestamp: Date;
  statistics: GraphStatistics;
}

// Graph statistics
export interface GraphStatistics {
  nodeCount: number;
  edgeCount: number;
  averageDegree: number;
  maxDegree: number;
  communityCount?: number;
  networkDensity: number;
}

// SSE events for real-time graph updates
export interface GraphInitEvent {
  type: 'graph_init';
  workflowId: string;
  questionIndex: number;
  graphType: GraphType;
  recommendedLayout: LayoutType;
  metadata: {
    totalNodes?: number;
    totalEdges?: number;
  };
}

export interface NodeDiscoveredEvent {
  type: 'node_discovered';
  workflowId: string;
  node: GraphNode;
  reasoning?: string;
}

export interface EdgeDiscoveredEvent {
  type: 'edge_discovered';
  workflowId: string;
  edge: GraphEdge;
  reasoning?: string;
}

export interface GraphCompleteEvent {
  type: 'graph_complete';
  workflowId: string;
  finalNodeCount: number;
  finalEdgeCount: number;
  insights: string[];
}

export type GraphEvent =
  | GraphInitEvent
  | NodeDiscoveredEvent
  | EdgeDiscoveredEvent
  | GraphCompleteEvent;

// Decision logic: Should we show graph for this Q&A?
export function shouldShowGraphVisualization(
  questions: string[],
  category?: string
): boolean {
  // High-value categories
  const highValueCategories = [
    'graph-exploration',
    'cross-community',
    'statistical', // Some statistical queries (correlation)
  ];

  if (category && highValueCategories.includes(category)) {
    return true;
  }

  // Check for network-related keywords
  const networkKeywords = [
    'community',
    'communities',
    'cluster',
    'network',
    'connected',
    'relationship',
    'relationships',
    'correlation',
    'correlated',
    'pattern',
    'patterns',
    'rotating between',
    'across stocks',
    'between',
    'smart money',
    'top performers',
    'graph',
    'structure',
    'topology',
  ];

  const questionText = questions.join(' ').toLowerCase();
  const hasNetworkKeyword = networkKeywords.some((kw) => questionText.includes(kw));

  // Exclude low-value cases
  const lowValueKeywords = ['what does', 'what is', 'how many', 'list'];
  const isSimpleLookup = lowValueKeywords.some((kw) => questionText.startsWith(kw));

  return hasNetworkKeyword && !isSimpleLookup;
}

// Determine graph type from questions
export function determineGraphType(questions: string[]): GraphType {
  const questionText = questions.join(' ').toLowerCase();

  if (questionText.includes('community') || questionText.includes('cluster')) {
    return 'community';
  }

  if (
    questionText.includes('between') ||
    questionText.includes('across') ||
    questionText.includes('rotating')
  ) {
    return 'cross-community';
  }

  if (questionText.includes('correlation') || questionText.includes('correlated')) {
    return 'correlation';
  }

  if (questionText.includes('smart money') || questionText.includes('top performer')) {
    return 'smart-money';
  }

  if (
    questionText.includes('structure') ||
    questionText.includes('topology') ||
    questionText.includes('density')
  ) {
    return 'overview';
  }

  // Check if focusing on single ticker
  const tickerPattern = /\b[A-Z]{1,5}\b/g;
  const tickers = questionText.match(tickerPattern);
  if (tickers && tickers.length === 1) {
    return 'single-ticker';
  }

  return 'overview';
}

// Get recommended layout for graph type
export function getRecommendedLayout(graphType: GraphType): LayoutType {
  switch (graphType) {
    case 'community':
      return 'force'; // Force-directed naturally separates communities
    case 'cross-community':
      return 'force'; // Shows relationships clearly
    case 'correlation':
      return 'force'; // Clusters correlated institutions
    case 'smart-money':
      return 'radial'; // Top performers in center
    case 'single-ticker':
      return 'radial'; // Ticker in center, institutions around
    case 'overview':
      return 'force'; // General purpose
    default:
      return 'force';
  }
}

// Calculate graph statistics
export function calculateGraphStatistics(
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphStatistics {
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  // Calculate degree for each node
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  });

  const degreeValues = Array.from(degrees.values());
  const averageDegree = degreeValues.length > 0
    ? degreeValues.reduce((a, b) => a + b, 0) / degreeValues.length
    : 0;
  const maxDegree = degreeValues.length > 0 ? Math.max(...degreeValues) : 0;

  // Network density = actual edges / possible edges
  const possibleEdges = (nodeCount * (nodeCount - 1)) / 2;
  const networkDensity = possibleEdges > 0 ? edgeCount / possibleEdges : 0;

  // Count communities (if nodes have communityId)
  const communities = new Set(
    nodes
      .map((n) => n.metadata.communityId)
      .filter((id): id is string => id !== undefined)
  );
  const communityCount = communities.size > 0 ? communities.size : undefined;

  return {
    nodeCount,
    edgeCount,
    averageDegree: Math.round(averageDegree * 10) / 10,
    maxDegree,
    communityCount,
    networkDensity: Math.round(networkDensity * 1000) / 1000,
  };
}

// Color palettes for different node types
export const NODE_COLORS = {
  institution: '#3b82f6', // Blue
  issuer: '#10b981', // Green
  community: '#8b5cf6', // Purple
  concept: '#f59e0b', // Orange
};

// Color palette for communities (up to 12 distinct communities)
export const COMMUNITY_COLORS = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Orange
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f97316', // Orange-red
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#06b6d4', // Cyan
  '#a855f7', // Violet
];

// Get color for community by index
export function getCommunityColor(communityIndex: number): string {
  return COMMUNITY_COLORS[communityIndex % COMMUNITY_COLORS.length];
}

// Edge colors by type
export const EDGE_COLORS = {
  holds: '#94a3b8', // Gray
  increased: '#10b981', // Green
  decreased: '#ef4444', // Red
  correlatedWith: '#3b82f6', // Blue
  sameCommunity: '#8b5cf6', // Purple
  rotation: '#f59e0b', // Orange
};

// Get edge color with alpha based on weight
export function getEdgeColor(type: EdgeType, weight: number): string {
  const baseColor = EDGE_COLORS[type];
  // Convert hex to rgba with alpha based on weight
  const alpha = Math.max(0.2, Math.min(1, weight));
  return `${baseColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

// Calculate node size based on importance metric
export function calculateNodeSize(
  node: GraphNode,
  graphType: GraphType,
  minSize: number = 3,
  maxSize: number = 10
): number {
  let importance = 0;

  switch (graphType) {
    case 'smart-money':
      // Size by performance rank (lower rank = larger size)
      if (node.metadata.performanceRank) {
        importance = 1 / node.metadata.performanceRank;
      }
      break;

    case 'cross-community':
    case 'single-ticker':
      // Size by portfolio value or share count
      if (node.metadata.portfolioValue) {
        importance = Math.log10(node.metadata.portfolioValue + 1);
      } else if (node.metadata.shareCount) {
        importance = Math.log10(node.metadata.shareCount + 1);
      }
      break;

    default:
      // Default to degree centrality (will be calculated separately)
      importance = node.size || 5;
  }

  // Normalize to size range
  return minSize + (importance / 10) * (maxSize - minSize);
}

// Find highly connected nodes (hubs)
export function findHubNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  topN: number = 5
): GraphNode[] {
  const degrees = new Map<string, number>();

  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  });

  return nodes
    .map((node) => ({
      node,
      degree: degrees.get(node.id) || 0,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, topN)
    .map((item) => item.node);
}

// Get neighbors of a node
export function getNeighbors(nodeId: string, edges: GraphEdge[]): Set<string> {
  const neighbors = new Set<string>();

  edges.forEach((edge) => {
    if (edge.source === nodeId) {
      neighbors.add(edge.target);
    } else if (edge.target === nodeId) {
      neighbors.add(edge.source);
    }
  });

  return neighbors;
}

// Export graph data
export function exportGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  format: 'json' | 'csv'
): string {
  if (format === 'json') {
    return JSON.stringify({ nodes, edges }, null, 2);
  }

  // CSV format: nodes and edges as separate sections
  let csv = 'NODES\n';
  csv += 'id,type,label,size,color\n';
  nodes.forEach((node) => {
    csv += `"${node.id}","${node.type}","${node.label}",${node.size},"${node.color}"\n`;
  });

  csv += '\nEDGES\n';
  csv += 'id,source,target,type,weight\n';
  edges.forEach((edge) => {
    csv += `"${edge.id}","${edge.source}","${edge.target}","${edge.type}",${edge.weight}\n`;
  });

  return csv;
}
