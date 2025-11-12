/**
 * API Handlers Index
 *
 * Export all handlers for use in any server framework.
 * Each handler provides both a core function (handleXxx) and a Web Standard Request handler (GET/POST).
 */

// Events
export { handleGetEvents, GET as getEvents } from './events';
export type { EventsParams } from './events';

// Graph
export { handleGetGraph, GET as getGraph } from './graph';
export type { GraphParams } from './graph';

// Graph Paths
export { handleGetGraphPaths, GET as getGraphPaths } from './graph-paths';
export type { GraphPathsParams } from './graph-paths';

// Graph Explain
export { handlePostGraphExplain, POST as postGraphExplain } from './graph-explain';
export type { GraphExplainParams } from './graph-explain';

// Run Workflow
export { handlePostRun, POST as postRun } from './run';
export type { RunParams } from './run';

// Shared types
export type { TemporalConfig } from './run';
