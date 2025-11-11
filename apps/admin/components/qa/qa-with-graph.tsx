'use client';

import { useState, useEffect } from 'react';
import { QAResults, QAResultData } from '@/components/qa/qa-results';
import { GraphVisualization } from '@/components/graph/graph-visualization';
import { GraphControls } from '@/components/graph/graph-controls';
import { GraphLegend } from '@/components/graph/graph-legend';
import { GraphStats } from '@/components/graph/graph-stats';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  GraphState,
  GraphNode,
  GraphEdge,
  LayoutType,
  NodeType,
  shouldShowGraphVisualization,
  determineGraphType,
  getRecommendedLayout,
  calculateGraphStatistics,
  exportGraphData,
  NODE_COLORS,
  EDGE_COLORS,
  getCommunityColor,
} from '@/lib/graph-utils';
import { Network, ChevronLeft, ChevronRight } from 'lucide-react';

interface QAWithGraphProps {
  result: QAResultData;
  questions: string[];
  category?: string;
  onClear?: () => void;
}

export function QAWithGraph({ result, questions, category, onClear }: QAWithGraphProps) {
  const [showGraph, setShowGraph] = useState(false);
  const [graphState, setGraphState] = useState<GraphState | null>(null);
  const [isGraphReady, setIsGraphReady] = useState(false);

  // Determine if graph should be offered
  const shouldOfferGraph = shouldShowGraphVisualization(questions, category);
  const graphType = determineGraphType(questions);

  // Initialize graph state when results complete
  useEffect(() => {
    if (result.status === 'completed' && shouldOfferGraph && !graphState) {
      // Generate mock graph data based on the question type
      const mockGraphData = generateMockGraphData(questions, graphType);
      setGraphState(mockGraphData);
      setIsGraphReady(true);
    }
  }, [result.status, shouldOfferGraph, questions, graphType, graphState]);

  const handleLayoutChange = (layout: LayoutType) => {
    if (!graphState) return;
    setGraphState({ ...graphState, layout });
  };

  const handleNodeTypeFilter = (types: Set<NodeType>) => {
    if (!graphState) return;
    setGraphState({ ...graphState, filteredNodeTypes: types });
  };

  const handleSearchChange = (query: string) => {
    if (!graphState) return;
    // Implement search logic (highlight matching nodes)
    const matchingNodeIds = graphState.nodes
      .filter((node) => node.label.toLowerCase().includes(query.toLowerCase()))
      .map((node) => node.id);
    setGraphState({ ...graphState, highlightedNodes: new Set(matchingNodeIds) });
  };

  const handleExport = (format: 'png' | 'svg' | 'json' | 'csv') => {
    if (!graphState) return;

    if (format === 'json' || format === 'csv') {
      const data = exportGraphData(graphState.nodes, graphState.edges, format);
      const blob = new Blob([data], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `graph-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }
    // PNG/SVG export would require canvas-to-image conversion
  };

  const handleReset = () => {
    if (!graphState) return;
    setGraphState({
      ...graphState,
      highlightedNodes: new Set(),
      layout: getRecommendedLayout(graphType),
    });
  };

  // If graph shouldn't be shown, just render results
  if (!shouldOfferGraph) {
    return <QAResults result={result} onClear={onClear} />;
  }

  // Side-by-side layout when graph is shown
  if (showGraph && graphState) {
    return (
      <div className="space-y-4">
        {/* Toggle Graph Button */}
        <div className="flex items-center justify-between">
          <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
            <Network className="h-3 w-3" />
            Graph Visualization Active
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowGraph(false)}
            className="flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Hide Graph
          </Button>
        </div>

        {/* Side-by-side layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Text Results */}
          <div className="space-y-4">
            <QAResults result={result} onClear={onClear} />
          </div>

          {/* Right: Graph Visualization */}
          <div className="space-y-4">
            {/* Graph Canvas */}
            <div className="border rounded-lg overflow-hidden bg-white">
              <GraphVisualization
                graphState={graphState}
                width={600}
                height={600}
                backgroundColor="#ffffff"
              />
            </div>

            {/* Graph Controls */}
            <div className="grid grid-cols-1 gap-4">
              <GraphControls
                graphState={graphState}
                onLayoutChange={handleLayoutChange}
                onNodeTypeFilter={handleNodeTypeFilter}
                onSearchChange={handleSearchChange}
                onExport={handleExport}
                onReset={handleReset}
              />

              <GraphStats
                statistics={graphState.statistics}
                isAnimating={graphState.isAnimating}
              />

              <GraphLegend graphType={graphState.graphType} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Graph available but not shown - render with toggle button
  return (
    <div className="space-y-4">
      {/* Graph Available Notification */}
      {isGraphReady && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Network className="h-5 w-5 text-blue-600" />
              <div>
                <h4 className="font-semibold text-blue-900">Graph Visualization Available</h4>
                <p className="text-sm text-blue-700">
                  This Q&A explores network relationships. View the interactive graph to see
                  connections visually.
                </p>
              </div>
            </div>
            <Button onClick={() => setShowGraph(true)} className="flex items-center gap-1">
              Show Graph
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
      <QAResults result={result} onClear={onClear} />
    </div>
  );
}

// Generate mock graph data based on question type
function generateMockGraphData(questions: string[], graphType: string): GraphState {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Generate different graph structures based on type
  switch (graphType) {
    case 'community':
      // 3 communities with 5-8 institutions each
      for (let c = 0; c < 3; c++) {
        const communitySize = Math.floor(Math.random() * 4) + 5;
        for (let i = 0; i < communitySize; i++) {
          nodes.push({
            id: `inst-${c}-${i}`,
            type: 'institution',
            label: `Institution ${String.fromCharCode(65 + c)}${i + 1}`,
            size: Math.random() * 5 + 3,
            color: getCommunityColor(c),
            metadata: {
              institution: `Institution ${String.fromCharCode(65 + c)}${i + 1}`,
              communityId: `community-${c}`,
              portfolioValue: Math.random() * 10_000_000_000 + 1_000_000_000,
            },
          });
        }
      }

      // Add edges within communities
      nodes.forEach((node, idx) => {
        const communityNodes = nodes.filter(
          (n) => n.metadata.communityId === node.metadata.communityId
        );
        communityNodes.slice(0, 3).forEach((target) => {
          if (target.id !== node.id) {
            edges.push({
              id: `edge-${node.id}-${target.id}`,
              source: node.id,
              target: target.id,
              type: 'sameCommunity',
              weight: Math.random() * 0.5 + 0.5,
              color: EDGE_COLORS.sameCommunity,
              metadata: {},
            });
          }
        });
      });
      break;

    case 'cross-community':
      // Multiple tickers + institutions
      const tickers = ['AAPL', 'MSFT', 'GOOGL'];
      tickers.forEach((ticker) => {
        nodes.push({
          id: ticker,
          type: 'issuer',
          label: ticker,
          size: 8,
          color: NODE_COLORS.issuer,
          metadata: { ticker },
        });
      });

      // Institutions
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: `inst-${i}`,
          type: 'institution',
          label: `Institution ${i + 1}`,
          size: Math.random() * 4 + 4,
          color: NODE_COLORS.institution,
          metadata: {
            institution: `Institution ${i + 1}`,
            portfolioValue: Math.random() * 5_000_000_000,
          },
        });
      }

      // Connect institutions to tickers
      nodes
        .filter((n) => n.type === 'institution')
        .forEach((inst) => {
          const numHoldings = Math.floor(Math.random() * 2) + 1;
          const selectedTickers = tickers.slice(0, numHoldings);

          selectedTickers.forEach((ticker) => {
            const isIncrease = Math.random() > 0.5;
            edges.push({
              id: `edge-${inst.id}-${ticker}`,
              source: inst.id,
              target: ticker,
              type: isIncrease ? 'increased' : 'decreased',
              weight: Math.random() * 0.7 + 0.3,
              color: isIncrease ? EDGE_COLORS.increased : EDGE_COLORS.decreased,
              metadata: {
                percentChange: (Math.random() * 50 - 25) * (isIncrease ? 1 : -1),
              },
            });
          });
        });
      break;

    case 'correlation':
      // Institutions with correlation edges
      for (let i = 0; i < 15; i++) {
        nodes.push({
          id: `inst-${i}`,
          type: 'institution',
          label: `Institution ${i + 1}`,
          size: Math.random() * 5 + 3,
          color: NODE_COLORS.institution,
          metadata: {
            institution: `Institution ${i + 1}`,
            portfolioValue: Math.random() * 8_000_000_000,
          },
        });
      }

      // Add correlation edges (sparse)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < Math.min(i + 4, nodes.length); j++) {
          const correlation = Math.random();
          if (correlation > 0.5) {
            edges.push({
              id: `edge-${nodes[i].id}-${nodes[j].id}`,
              source: nodes[i].id,
              target: nodes[j].id,
              type: 'correlatedWith',
              weight: correlation,
              color: EDGE_COLORS.correlatedWith,
              metadata: {
                correlationCoefficient: correlation,
              },
            });
          }
        }
      }
      break;

    default:
      // Generic overview graph
      for (let i = 0; i < 20; i++) {
        nodes.push({
          id: `node-${i}`,
          type: i < 15 ? 'institution' : 'issuer',
          label: i < 15 ? `Institution ${i + 1}` : `Ticker ${i - 14}`,
          size: Math.random() * 5 + 3,
          color: i < 15 ? NODE_COLORS.institution : NODE_COLORS.issuer,
          metadata: {},
        });
      }

      // Random edges
      for (let i = 0; i < 25; i++) {
        const source = nodes[Math.floor(Math.random() * nodes.length)];
        const target = nodes[Math.floor(Math.random() * nodes.length)];
        if (source.id !== target.id) {
          edges.push({
            id: `edge-${i}`,
            source: source.id,
            target: target.id,
            type: 'holds',
            weight: Math.random() * 0.8 + 0.2,
            color: EDGE_COLORS.holds,
            metadata: {},
          });
        }
      }
  }

  const statistics = calculateGraphStatistics(nodes, edges);

  return {
    nodes,
    edges,
    layout: getRecommendedLayout(graphType as any),
    graphType: graphType as any,
    highlightedNodes: new Set(),
    filteredNodeTypes: new Set(['institution', 'issuer', 'community', 'concept']),
    isAnimating: false,
    timestamp: new Date(),
    statistics,
  };
}
