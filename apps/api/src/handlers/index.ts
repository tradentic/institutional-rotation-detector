/**
 * API Handlers Index
 *
 * Export all handlers for use in any server framework.
 * Each handler provides both a core function (handleXxx) and a Web Standard Request handler (GET/POST).
 */

// Events
export { handleGetEvents, GET as getEvents } from './events.js';
export type { EventsParams } from './events.js';

// Graph
export { handleGetGraph, GET as getGraph } from './graph.js';
export type { GraphParams } from './graph.js';

// Graph Paths
export { handleGetGraphPaths, GET as getGraphPaths } from './graph-paths.js';
export type { GraphPathsParams } from './graph-paths.js';

// Graph Explain
export { handlePostGraphExplain, POST as postGraphExplain } from './graph-explain.js';
export type { GraphExplainParams } from './graph-explain.js';

// Run Workflow
export { handlePostRun, POST as postRun } from './run.js';
export type { RunParams } from './run.js';

// Shared types
export type { TemporalConfig } from './run.js';
