/**
 * API Handlers Index
 *
 * Export all handlers for use in any server framework.
 * Each handler provides both a core function (handleXxx) and a Web Standard Request handler (GET/POST).
 */

// Events
export { handleGetEvents, GET as getEvents } from './events.ts';
export type { EventsParams } from './events.ts';

// Graph
export { handleGetGraph, GET as getGraph } from './graph.ts';
export type { GraphParams } from './graph.ts';

// Graph Paths
export { handleGetGraphPaths, GET as getGraphPaths } from './graph-paths.ts';
export type { GraphPathsParams } from './graph-paths.ts';

// Graph Explain
export { handlePostGraphExplain, POST as postGraphExplain } from './graph-explain.ts';
export type { GraphExplainParams } from './graph-explain.ts';

// Run Workflow
export { handlePostRun, POST as postRun } from './run.ts';
export type { RunParams } from './run.ts';

// Shared types
export type { TemporalConfig } from './run.ts';
