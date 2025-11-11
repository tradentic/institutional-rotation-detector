/**
 * Graph Streaming Utilities
 *
 * Handles real-time graph construction via SSE, including:
 * - Event type definitions for incremental graph updates
 * - State management for animated graph construction
 * - Event parsing and validation
 * - Animation timing and coordination
 */

import { GraphNode, GraphEdge, GraphState } from './graph-utils';

// ============================================================================
// Event Types
// ============================================================================

export type GraphEventType =
  | 'graphStarted'
  | 'nodeAdded'
  | 'edgeAdded'
  | 'nodeUpdated'
  | 'edgeUpdated'
  | 'communityDetected'
  | 'graphComplete'
  | 'graphError';

export interface BaseGraphEvent {
  type: GraphEventType;
  timestamp: string;
  workflowId: string;
}

export interface GraphStartedEvent extends BaseGraphEvent {
  type: 'graphStarted';
  data: {
    graphType: string;
    estimatedNodes: number;
    estimatedEdges: number;
  };
}

export interface NodeAddedEvent extends BaseGraphEvent {
  type: 'nodeAdded';
  data: {
    node: GraphNode;
    reason?: string; // Why this node was added (e.g., "mentioned in answer", "related institution")
  };
}

export interface EdgeAddedEvent extends BaseGraphEvent {
  type: 'edgeAdded';
  data: {
    edge: GraphEdge;
    reason?: string; // Why this edge was added (e.g., "co-holding detected", "correlation > 0.8")
  };
}

export interface NodeUpdatedEvent extends BaseGraphEvent {
  type: 'nodeUpdated';
  data: {
    nodeId: string;
    updates: Partial<GraphNode>;
  };
}

export interface EdgeUpdatedEvent extends BaseGraphEvent {
  type: 'edgeUpdated';
  data: {
    edgeId: string;
    updates: Partial<GraphEdge>;
  };
}

export interface CommunityDetectedEvent extends BaseGraphEvent {
  type: 'communityDetected';
  data: {
    communityId: string;
    nodeIds: string[];
    description?: string;
  };
}

export interface GraphCompleteEvent extends BaseGraphEvent {
  type: 'graphComplete';
  data: {
    totalNodes: number;
    totalEdges: number;
    totalCommunities?: number;
    durationMs: number;
  };
}

export interface GraphErrorEvent extends BaseGraphEvent {
  type: 'graphError';
  data: {
    error: string;
    recoverable: boolean;
  };
}

export type GraphEvent =
  | GraphStartedEvent
  | NodeAddedEvent
  | EdgeAddedEvent
  | NodeUpdatedEvent
  | EdgeUpdatedEvent
  | CommunityDetectedEvent
  | GraphCompleteEvent
  | GraphErrorEvent;

// ============================================================================
// Animation State
// ============================================================================

export interface AnimationState {
  newNodeIds: Set<string>; // Nodes to animate in
  newEdgeIds: Set<string>; // Edges to animate in
  updatedNodeIds: Set<string>; // Nodes to pulse/highlight
  highlightedNodeIds: Set<string>; // Nodes currently highlighted
  animationQueue: GraphEvent[]; // Events waiting to be animated
  isAnimating: boolean;
  animationSpeed: 'slow' | 'medium' | 'fast' | 'instant';
}

export function createInitialAnimationState(): AnimationState {
  return {
    newNodeIds: new Set(),
    newEdgeIds: new Set(),
    updatedNodeIds: new Set(),
    highlightedNodeIds: new Set(),
    animationQueue: [],
    isAnimating: false,
    animationSpeed: 'medium',
  };
}

// ============================================================================
// Animation Timing
// ============================================================================

const ANIMATION_DELAYS = {
  slow: {
    nodeDelay: 500, // ms between nodes
    edgeDelay: 300, // ms between edges
    fadeDuration: 400, // fade in duration
    pulseDuration: 600, // pulse duration for updates
  },
  medium: {
    nodeDelay: 200,
    edgeDelay: 150,
    fadeDuration: 300,
    pulseDuration: 400,
  },
  fast: {
    nodeDelay: 50,
    edgeDelay: 30,
    fadeDuration: 150,
    pulseDuration: 200,
  },
  instant: {
    nodeDelay: 0,
    edgeDelay: 0,
    fadeDuration: 0,
    pulseDuration: 0,
  },
};

export function getAnimationDelays(speed: AnimationState['animationSpeed']) {
  return ANIMATION_DELAYS[speed];
}

// ============================================================================
// Graph State Updates
// ============================================================================

export interface IncrementalGraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Map<string, string[]>; // communityId -> nodeIds
  metadata: {
    startedAt?: Date;
    completedAt?: Date;
    graphType?: string;
    isBuilding: boolean;
    progress?: {
      currentNodes: number;
      estimatedNodes: number;
      currentEdges: number;
      estimatedEdges: number;
    };
  };
}

export function createInitialGraphState(): IncrementalGraphState {
  return {
    nodes: [],
    edges: [],
    communities: new Map(),
    metadata: {
      isBuilding: false,
    },
  };
}

export function applyGraphEvent(
  state: IncrementalGraphState,
  event: GraphEvent
): IncrementalGraphState {
  const newState = { ...state };

  switch (event.type) {
    case 'graphStarted':
      newState.metadata = {
        ...newState.metadata,
        isBuilding: true,
        startedAt: new Date(event.timestamp),
        graphType: event.data.graphType,
        progress: {
          currentNodes: 0,
          estimatedNodes: event.data.estimatedNodes,
          currentEdges: 0,
          estimatedEdges: event.data.estimatedEdges,
        },
      };
      break;

    case 'nodeAdded':
      newState.nodes = [...newState.nodes, event.data.node];
      if (newState.metadata.progress) {
        newState.metadata.progress.currentNodes += 1;
      }
      break;

    case 'edgeAdded':
      newState.edges = [...newState.edges, event.data.edge];
      if (newState.metadata.progress) {
        newState.metadata.progress.currentEdges += 1;
      }
      break;

    case 'nodeUpdated':
      newState.nodes = newState.nodes.map((node) =>
        node.id === event.data.nodeId
          ? { ...node, ...event.data.updates }
          : node
      );
      break;

    case 'edgeUpdated':
      newState.edges = newState.edges.map((edge) =>
        edge.id === event.data.edgeId
          ? { ...edge, ...event.data.updates }
          : edge
      );
      break;

    case 'communityDetected':
      newState.communities.set(event.data.communityId, event.data.nodeIds);
      // Update node colors based on community
      newState.nodes = newState.nodes.map((node) =>
        event.data.nodeIds.includes(node.id)
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                communityId: event.data.communityId,
              },
            }
          : node
      );
      break;

    case 'graphComplete':
      newState.metadata = {
        ...newState.metadata,
        isBuilding: false,
        completedAt: new Date(event.timestamp),
      };
      break;

    case 'graphError':
      newState.metadata = {
        ...newState.metadata,
        isBuilding: false,
      };
      break;
  }

  return newState;
}

// ============================================================================
// Event Parsing
// ============================================================================

export function parseGraphEvent(data: string): GraphEvent | null {
  try {
    const parsed = JSON.parse(data);

    // Validate required fields
    if (!parsed.type || !parsed.timestamp || !parsed.workflowId) {
      console.error('Invalid graph event: missing required fields', parsed);
      return null;
    }

    // Validate event type
    const validTypes: GraphEventType[] = [
      'graphStarted',
      'nodeAdded',
      'edgeAdded',
      'nodeUpdated',
      'edgeUpdated',
      'communityDetected',
      'graphComplete',
      'graphError',
    ];

    if (!validTypes.includes(parsed.type)) {
      console.error('Invalid graph event type:', parsed.type);
      return null;
    }

    return parsed as GraphEvent;
  } catch (error) {
    console.error('Failed to parse graph event:', error, data);
    return null;
  }
}

// ============================================================================
// Animation Helpers
// ============================================================================

export function shouldAnimateEvent(
  event: GraphEvent,
  speed: AnimationState['animationSpeed']
): boolean {
  // Always process graphStarted and graphComplete immediately
  if (event.type === 'graphStarted' || event.type === 'graphComplete') {
    return false;
  }

  // Instant speed = no animation
  if (speed === 'instant') {
    return false;
  }

  // Animate node/edge additions and updates
  return ['nodeAdded', 'edgeAdded', 'nodeUpdated', 'edgeUpdated'].includes(event.type);
}

export function createAnimationTimeout(
  callback: () => void,
  delay: number
): number {
  return window.setTimeout(callback, delay);
}

export function clearAnimationTimeout(timeoutId: number): void {
  window.clearTimeout(timeoutId);
}

// ============================================================================
// Progress Calculation
// ============================================================================

export function calculateGraphProgress(state: IncrementalGraphState): number {
  const { progress } = state.metadata;

  if (!progress) {
    return 0;
  }

  const nodeProgress = progress.estimatedNodes > 0
    ? progress.currentNodes / progress.estimatedNodes
    : 0;

  const edgeProgress = progress.estimatedEdges > 0
    ? progress.currentEdges / progress.estimatedEdges
    : 0;

  // Weight nodes 40%, edges 60% (edges usually take longer)
  return Math.min(nodeProgress * 0.4 + edgeProgress * 0.6, 1);
}

export function getProgressMessage(state: IncrementalGraphState): string {
  const { progress, isBuilding } = state.metadata;

  if (!isBuilding) {
    return 'Graph complete';
  }

  if (!progress) {
    return 'Initializing graph...';
  }

  const { currentNodes, estimatedNodes, currentEdges, estimatedEdges } = progress;

  if (currentNodes < estimatedNodes) {
    return `Building graph: ${currentNodes}/${estimatedNodes} institutions discovered...`;
  }

  if (currentEdges < estimatedEdges) {
    return `Analyzing connections: ${currentEdges}/${estimatedEdges} relationships found...`;
  }

  return 'Finalizing graph...';
}

// ============================================================================
// SSE Connection Management
// ============================================================================

export interface GraphStreamOptions {
  workflowId: string;
  onEvent: (event: GraphEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

export function connectToGraphStream(options: GraphStreamOptions): () => void {
  const { workflowId, onEvent, onError, onComplete } = options;

  const eventSource = new EventSource(
    `/api/qa/graph-stream?workflowId=${workflowId}`
  );

  eventSource.onmessage = (event) => {
    const graphEvent = parseGraphEvent(event.data);
    if (graphEvent) {
      onEvent(graphEvent);

      // Auto-close on complete or error
      if (graphEvent.type === 'graphComplete' || graphEvent.type === 'graphError') {
        eventSource.close();
        onComplete();
      }
    }
  };

  eventSource.onerror = (error) => {
    console.error('Graph stream error:', error);
    eventSource.close();
    onError(new Error('Graph stream connection failed'));
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}
