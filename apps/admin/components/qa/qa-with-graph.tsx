'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { QAResults, QAResultData } from '@/components/qa/qa-results';
import { GraphVisualization } from '@/components/graph/graph-visualization';
import { GraphControls } from '@/components/graph/graph-controls';
import { GraphLegend } from '@/components/graph/graph-legend';
import { GraphStats } from '@/components/graph/graph-stats';
import { GraphPlaybackControls, AnimationSpeed, GraphSnapshot } from '@/components/graph/graph-playback-controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  GraphState,
  GraphNode,
  GraphEdge,
  GraphType,
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
import {
  GraphEvent,
  IncrementalGraphState,
  createInitialGraphState,
  applyGraphEvent,
  connectToGraphStream,
  calculateGraphProgress,
  getProgressMessage,
} from '@/lib/graph-streaming';
import {
  PlaybackState,
  createInitialPlaybackState,
  addEventToHistory,
  seekToEvent,
  resetPlayback,
  togglePause,
  setSpeed,
  captureSnapshot,
  loadSnapshot as loadPlaybackSnapshot,
  exportSnapshot,
  applySpeedToDelay,
} from '@/lib/graph-playback';
import { Network, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

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
  const [isStreamingGraph, setIsStreamingGraph] = useState(false);
  const [incrementalState, setIncrementalState] = useState<IncrementalGraphState>(
    createInitialGraphState()
  );
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const [newEdgeIds, setNewEdgeIds] = useState<Set<string>>(new Set());
  const [playbackState, setPlaybackState] = useState<PlaybackState>(createInitialPlaybackState());
  const [animationSpeed, setAnimationSpeed] = useState<AnimationSpeed>('medium');
  const disconnectRef = useRef<(() => void) | null>(null);
  const eventQueueRef = useRef<GraphEvent[]>([]);

  // Determine if graph should be offered
  const shouldOfferGraph = shouldShowGraphVisualization(questions, category);
  const graphType = determineGraphType(questions);

  // Connect to graph stream when workflow is running
  useEffect(() => {
    if (!shouldOfferGraph || result.status !== 'running' || !result.workflowId) {
      return;
    }

    setIsStreamingGraph(true);
    setIncrementalState(createInitialGraphState());

    // Connect to SSE stream
    const disconnect = connectToGraphStream({
      workflowId: result.workflowId,
      onEvent: handleGraphEvent,
      onError: (error) => {
        console.error('Graph stream error:', error);
        setIsStreamingGraph(false);
      },
      onComplete: () => {
        setIsStreamingGraph(false);
        // Finalize graph state
        finalizeGraph();
      },
    });

    disconnectRef.current = disconnect;

    return () => {
      disconnect();
    };
  }, [result.workflowId, result.status, shouldOfferGraph]);

  // Handle individual graph events
  const handleGraphEvent = useCallback((event: GraphEvent) => {
    console.log('Graph event:', event.type, event.data);

    // Add to playback history
    setPlaybackState((prev) => addEventToHistory(prev, event));

    // Check if paused - if so, queue event instead of processing
    if (playbackState.isPaused) {
      eventQueueRef.current.push(event);
      return;
    }

    // Apply event to incremental state
    setIncrementalState((prev) => applyGraphEvent(prev, event));

    // Track new nodes/edges for animation
    if (event.type === 'nodeAdded') {
      const nodeId = event.data.node.id;
      setNewNodeIds((prev) => new Set(prev).add(nodeId));
      // Clear after animation completes (300ms fade + 500ms display)
      setTimeout(() => {
        setNewNodeIds((prev) => {
          const updated = new Set(prev);
          updated.delete(nodeId);
          return updated;
        });
      }, 800);
    }

    if (event.type === 'edgeAdded') {
      const edgeId = event.data.edge.id;
      setNewEdgeIds((prev) => new Set(prev).add(edgeId));
      // Clear after animation completes
      setTimeout(() => {
        setNewEdgeIds((prev) => {
          const updated = new Set(prev);
          updated.delete(edgeId);
          return updated;
        });
      }, 800);
    }

    // Auto-show graph when first nodes appear
    if (event.type === 'nodeAdded' && !showGraph) {
      setShowGraph(true);
    }
  }, [showGraph, playbackState.isPaused]);

  // Finalize graph after streaming completes
  const finalizeGraph = useCallback(() => {
    setIncrementalState((prev) => {
      if (prev.nodes.length === 0) return prev;

      // Convert incremental state to final graph state
      const statistics = calculateGraphStatistics(prev.nodes, prev.edges);
      const finalGraph: GraphState = {
        nodes: prev.nodes,
        edges: prev.edges,
        layout: getRecommendedLayout((prev.metadata.graphType || graphType) as GraphType),
        graphType: (prev.metadata.graphType || graphType) as GraphType,
        highlightedNodes: new Set(),
        filteredNodeTypes: new Set(['institution', 'issuer', 'community', 'concept']),
        isAnimating: false,
        timestamp: new Date(),
        statistics,
      };

      setGraphState(finalGraph);
      setIsGraphReady(true);
      return prev;
    });
  }, [graphType]);

  // Fallback: Generate static mock graph when workflow completes (for testing)
  useEffect(() => {
    if (result.status === 'completed' && shouldOfferGraph && !graphState && !isStreamingGraph) {
      // Only use static mock if no streaming occurred
      if (incrementalState.nodes.length === 0) {
        const mockGraphData = generateMockGraphData(questions, graphType);
        setGraphState(mockGraphData);
        setIsGraphReady(true);
      }
    }
  }, [result.status, shouldOfferGraph, questions, graphType, graphState, isStreamingGraph, incrementalState.nodes.length]);

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

  // Playback control handlers
  const handlePauseResume = useCallback(() => {
    setPlaybackState((prev) => togglePause(prev));
  }, []);

  const handleRestart = useCallback(() => {
    setPlaybackState((prev) => resetPlayback(prev));
    setIncrementalState(createInitialGraphState());
    setNewNodeIds(new Set());
    setNewEdgeIds(new Set());
  }, []);

  const handleSpeedChange = useCallback((speed: AnimationSpeed) => {
    setAnimationSpeed(speed);
    setPlaybackState((prev) => setSpeed(prev, speed));
  }, []);

  const handleSeek = useCallback((eventIndex: number) => {
    const newState = seekToEvent(playbackState, eventIndex);
    setPlaybackState(newState);
    setIncrementalState(newState.graphState);
  }, [playbackState]);

  const handleCaptureSnapshot = useCallback(() => {
    setPlaybackState((prev) =>
      captureSnapshot(
        prev,
        `Snapshot: ${incrementalState.nodes.length} nodes, ${incrementalState.edges.length} edges`
      )
    );
  }, [incrementalState]);

  const handleLoadSnapshot = useCallback((snapshotId: string) => {
    const newState = loadPlaybackSnapshot(playbackState, snapshotId);
    setPlaybackState(newState);
    setIncrementalState(newState.graphState);
  }, [playbackState]);

  const handleExportSnapshot = useCallback((snapshotId: string) => {
    const snapshot = playbackState.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return;

    const data = exportSnapshot(snapshot);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `graph-snapshot-${snapshot.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [playbackState.snapshots]);

  // If graph shouldn't be shown, just render results
  if (!shouldOfferGraph) {
    return <QAResults result={result} onClear={onClear} />;
  }

  // Convert incremental state to display-ready graph state for live streaming
  const liveGraphState: GraphState | null = isStreamingGraph && incrementalState.nodes.length > 0
    ? {
        nodes: incrementalState.nodes,
        edges: incrementalState.edges,
        layout: getRecommendedLayout((incrementalState.metadata.graphType || graphType) as GraphType),
        graphType: (incrementalState.metadata.graphType || graphType) as GraphType,
        highlightedNodes: new Set(),
        filteredNodeTypes: new Set(['institution', 'issuer', 'community', 'concept']),
        isAnimating: incrementalState.metadata.isBuilding,
        timestamp: new Date(),
        statistics: calculateGraphStatistics(incrementalState.nodes, incrementalState.edges),
      }
    : null;

  const displayGraphState = liveGraphState || graphState;

  // Side-by-side layout when graph is shown
  if (showGraph && (displayGraphState || isStreamingGraph)) {
    return (
      <div className="space-y-4">
        {/* Toggle Graph Button */}
        <div className="flex items-center justify-between">
          {isStreamingGraph ? (
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Building Graph: {incrementalState.nodes.length} nodes, {incrementalState.edges.length} edges
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1">
              <Network className="h-3 w-3" />
              Graph Visualization Active
            </Badge>
          )}
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

        {/* Progress indicator during streaming */}
        {isStreamingGraph && incrementalState.metadata.progress && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-blue-900">
                  {getProgressMessage(incrementalState)}
                </span>
                <span className="text-blue-700">
                  {Math.round(calculateGraphProgress(incrementalState) * 100)}%
                </span>
              </div>
              <Progress value={calculateGraphProgress(incrementalState) * 100} className="h-2" />
            </div>
          </div>
        )}

        {/* Side-by-side layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Text Results */}
          <div className="space-y-4">
            <QAResults result={result} onClear={onClear} />
          </div>

          {/* Right: Graph Visualization */}
          <div className="space-y-4">
            {/* Graph Canvas */}
            {displayGraphState ? (
              <>
                <div className="border rounded-lg overflow-hidden bg-white">
                  <GraphVisualization
                    graphState={displayGraphState}
                    width={600}
                    height={600}
                    backgroundColor="#ffffff"
                    newNodeIds={newNodeIds}
                    newEdgeIds={newEdgeIds}
                  />
                </div>

                {/* Graph Controls */}
                <div className="grid grid-cols-1 gap-4">
                  {/* Playback Controls */}
                  <GraphPlaybackControls
                    isStreaming={isStreamingGraph}
                    isPaused={playbackState.isPaused}
                    onPauseResume={handlePauseResume}
                    onRestart={handleRestart}
                    animationSpeed={animationSpeed}
                    onSpeedChange={handleSpeedChange}
                    totalEvents={playbackState.events.length}
                    currentEventIndex={playbackState.currentEventIndex}
                    onSeek={handleSeek}
                    canSeek={!isStreamingGraph && playbackState.events.length > 0}
                    snapshots={playbackState.snapshots}
                    onCaptureSnapshot={handleCaptureSnapshot}
                    onLoadSnapshot={handleLoadSnapshot}
                    onExportSnapshot={handleExportSnapshot}
                  />

                  <GraphControls
                    graphState={displayGraphState}
                    onLayoutChange={handleLayoutChange}
                    onNodeTypeFilter={handleNodeTypeFilter}
                    onSearchChange={handleSearchChange}
                    onExport={handleExport}
                    onReset={handleReset}
                  />

                  <GraphStats
                    statistics={displayGraphState.statistics}
                    isAnimating={displayGraphState.isAnimating}
                  />

                  <GraphLegend graphType={displayGraphState.graphType} />
                </div>
              </>
            ) : (
              <div className="border rounded-lg bg-gray-50 p-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
                <p className="text-gray-600">Initializing graph visualization...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Graph available but not shown - render with toggle button
  return (
    <div className="space-y-4">
      {/* Graph Available Notification */}
      {(isGraphReady || isStreamingGraph) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isStreamingGraph ? (
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
              ) : (
                <Network className="h-5 w-5 text-blue-600" />
              )}
              <div>
                <h4 className="font-semibold text-blue-900">
                  {isStreamingGraph ? 'Building Graph Visualization' : 'Graph Visualization Available'}
                </h4>
                <p className="text-sm text-blue-700">
                  {isStreamingGraph
                    ? `Discovering network relationships in real-time (${incrementalState.nodes.length} nodes)`
                    : 'This Q&A explores network relationships. View the interactive graph to see connections visually.'}
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

// Generate mock graph data based on question type (fallback for testing)
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
