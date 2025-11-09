/**
 * Helper utilities for managing Continue-As-New in long-running workflows.
 *
 * Temporal workflows should use Continue-As-New to prevent unbounded history growth.
 * This module provides utilities to track iterations and trigger Continue-As-New.
 */

/**
 * Default maximum iterations before triggering Continue-As-New.
 * This prevents workflow history from growing too large.
 *
 * For different polling cadences:
 * - 5 min cadence: 100 iterations = ~8 hours of history
 * - 1 hour cadence: 100 iterations = ~4 days of history
 * - 24 hour cadence: 100 iterations = ~3 months of history
 */
export const DEFAULT_MAX_ITERATIONS = 100;

/**
 * Check if it's time to reset iteration count (trigger Continue-As-New).
 */
export function shouldResetIteration(
  currentIteration: number,
  maxIterations: number = DEFAULT_MAX_ITERATIONS
): boolean {
  return currentIteration >= maxIterations;
}

/**
 * Increment iteration counter, resetting to 0 if max is reached.
 */
export function incrementIteration(
  currentIteration: number | undefined,
  maxIterations: number = DEFAULT_MAX_ITERATIONS
): number {
  const next = (currentIteration ?? 0) + 1;
  return shouldResetIteration(next, maxIterations) ? 0 : next;
}

/**
 * Base interface for workflows that use Continue-As-New with iteration tracking.
 */
export interface ContinuableWorkflowInput {
  iterationCount?: number;
  maxIterations?: number;
}
