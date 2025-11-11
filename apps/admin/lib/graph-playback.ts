/**
 * Graph Playback Utilities
 *
 * Extends graph streaming with:
 * - Event history storage for time-travel
 * - Pause/resume functionality
 * - Speed control
 * - Snapshot capture and export
 * - Timeline navigation
 */

import {
  GraphEvent,
  IncrementalGraphState,
  createInitialGraphState,
  applyGraphEvent,
  AnimationState,
} from './graph-streaming';
import { GraphState, calculateGraphStatistics } from './graph-utils';

// ============================================================================
// Playback State
// ============================================================================

export interface PlaybackState {
  // Event history
  events: GraphEvent[];
  currentEventIndex: number;

  // Playback control
  isPaused: boolean;
  speed: 'slow' | 'medium' | 'fast' | 'instant';

  // Snapshots
  snapshots: GraphSnapshot[];

  // Graph state at current position
  graphState: IncrementalGraphState;
}

export interface GraphSnapshot {
  id: string;
  timestamp: Date;
  eventIndex: number;
  nodeCount: number;
  edgeCount: number;
  description: string;
  graphState: IncrementalGraphState;
}

export function createInitialPlaybackState(): PlaybackState {
  return {
    events: [],
    currentEventIndex: 0,
    isPaused: false,
    speed: 'medium',
    snapshots: [],
    graphState: createInitialGraphState(),
  };
}

// ============================================================================
// Event History Management
// ============================================================================

export function addEventToHistory(
  state: PlaybackState,
  event: GraphEvent
): PlaybackState {
  const events = [...state.events, event];
  const graphState = applyGraphEvent(state.graphState, event);
  const currentEventIndex = events.length - 1;

  return {
    ...state,
    events,
    currentEventIndex,
    graphState,
  };
}

export function seekToEvent(state: PlaybackState, eventIndex: number): PlaybackState {
  if (eventIndex < 0 || eventIndex >= state.events.length) {
    return state;
  }

  // Rebuild graph state up to the target event
  let graphState = createInitialGraphState();
  for (let i = 0; i <= eventIndex; i++) {
    graphState = applyGraphEvent(graphState, state.events[i]);
  }

  return {
    ...state,
    currentEventIndex: eventIndex,
    graphState,
  };
}

export function resetPlayback(state: PlaybackState): PlaybackState {
  return {
    ...state,
    currentEventIndex: 0,
    graphState: createInitialGraphState(),
  };
}

// ============================================================================
// Playback Control
// ============================================================================

export function togglePause(state: PlaybackState): PlaybackState {
  return {
    ...state,
    isPaused: !state.isPaused,
  };
}

export function setSpeed(
  state: PlaybackState,
  speed: PlaybackState['speed']
): PlaybackState {
  return {
    ...state,
    speed,
  };
}

// ============================================================================
// Snapshot Management
// ============================================================================

export function captureSnapshot(
  state: PlaybackState,
  description?: string
): PlaybackState {
  const snapshot: GraphSnapshot = {
    id: `snapshot-${Date.now()}`,
    timestamp: new Date(),
    eventIndex: state.currentEventIndex,
    nodeCount: state.graphState.nodes.length,
    edgeCount: state.graphState.edges.length,
    description:
      description ||
      `Snapshot at ${state.graphState.nodes.length} nodes, ${state.graphState.edges.length} edges`,
    graphState: JSON.parse(JSON.stringify(state.graphState)), // Deep clone
  };

  return {
    ...state,
    snapshots: [...state.snapshots, snapshot],
  };
}

export function loadSnapshot(state: PlaybackState, snapshotId: string): PlaybackState {
  const snapshot = state.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) {
    return state;
  }

  return {
    ...state,
    currentEventIndex: snapshot.eventIndex,
    graphState: JSON.parse(JSON.stringify(snapshot.graphState)), // Deep clone
  };
}

export function exportSnapshot(snapshot: GraphSnapshot): string {
  return JSON.stringify(
    {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      description: snapshot.description,
      nodeCount: snapshot.nodeCount,
      edgeCount: snapshot.edgeCount,
      nodes: snapshot.graphState.nodes,
      edges: snapshot.graphState.edges,
      communities: Array.from(snapshot.graphState.communities.entries()),
      metadata: snapshot.graphState.metadata,
    },
    null,
    2
  );
}

export function deleteSnapshot(state: PlaybackState, snapshotId: string): PlaybackState {
  return {
    ...state,
    snapshots: state.snapshots.filter((s) => s.id !== snapshotId),
  };
}

// ============================================================================
// Event Filtering and Analysis
// ============================================================================

export function getEventsSummary(events: GraphEvent[]): {
  total: number;
  byType: Record<string, number>;
  duration: number | null;
} {
  const byType: Record<string, number> = {};

  events.forEach((event) => {
    byType[event.type] = (byType[event.type] || 0) + 1;
  });

  const duration =
    events.length > 1
      ? new Date(events[events.length - 1].timestamp).getTime() -
        new Date(events[0].timestamp).getTime()
      : null;

  return {
    total: events.length,
    byType,
    duration,
  };
}

export function getEventsInRange(
  events: GraphEvent[],
  startIndex: number,
  endIndex: number
): GraphEvent[] {
  return events.slice(startIndex, endIndex + 1);
}

// ============================================================================
// Speed Multipliers
// ============================================================================

export function getSpeedMultiplier(speed: PlaybackState['speed']): number {
  const multipliers = {
    slow: 0.5, // Half speed
    medium: 1.0, // Normal speed
    fast: 2.0, // Double speed
    instant: 0, // No delay
  };
  return multipliers[speed];
}

export function applySpeedToDelay(
  baseDelay: number,
  speed: PlaybackState['speed']
): number {
  const multiplier = getSpeedMultiplier(speed);
  if (multiplier === 0) return 0; // Instant
  return baseDelay / multiplier;
}

// ============================================================================
// Timeline Helpers
// ============================================================================

export function getTimelineMarkers(
  events: GraphEvent[]
): Array<{ index: number; label: string; type: string }> {
  const markers: Array<{ index: number; label: string; type: string }> = [];

  events.forEach((event, index) => {
    // Mark significant events
    if (event.type === 'graphStarted') {
      markers.push({ index, label: 'Start', type: 'start' });
    } else if (event.type === 'communityDetected') {
      markers.push({
        index,
        label: `Community: ${event.data.nodeIds.length} nodes`,
        type: 'community',
      });
    } else if (event.type === 'graphComplete') {
      markers.push({
        index,
        label: `Complete: ${event.data.totalNodes} nodes`,
        type: 'complete',
      });
    }
  });

  return markers;
}

export function findNextMarker(
  events: GraphEvent[],
  currentIndex: number
): number | null {
  const markers = getTimelineMarkers(events);
  const nextMarker = markers.find((m) => m.index > currentIndex);
  return nextMarker ? nextMarker.index : null;
}

export function findPreviousMarker(
  events: GraphEvent[],
  currentIndex: number
): number | null {
  const markers = getTimelineMarkers(events);
  const previousMarker = markers
    .slice()
    .reverse()
    .find((m) => m.index < currentIndex);
  return previousMarker ? previousMarker.index : null;
}

// ============================================================================
// Diff Calculation
// ============================================================================

export function calculateEventDiff(
  beforeState: IncrementalGraphState,
  afterState: IncrementalGraphState
): {
  nodesAdded: number;
  edgesAdded: number;
  communitiesAdded: number;
} {
  return {
    nodesAdded: afterState.nodes.length - beforeState.nodes.length,
    edgesAdded: afterState.edges.length - beforeState.edges.length,
    communitiesAdded: afterState.communities.size - beforeState.communities.size,
  };
}

// ============================================================================
// Progress Estimation
// ============================================================================

export function estimateRemainingTime(
  currentEventIndex: number,
  totalEvents: number,
  elapsedTime: number // milliseconds
): number | null {
  if (currentEventIndex === 0 || totalEvents === 0) {
    return null;
  }

  const progress = currentEventIndex / totalEvents;
  const estimatedTotal = elapsedTime / progress;
  const remaining = estimatedTotal - elapsedTime;

  return Math.max(0, remaining);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
