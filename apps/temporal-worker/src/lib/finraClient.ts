/**
 * Backward compatibility shim for FINRA client
 *
 * This file re-exports everything from @libs/finra-client to maintain
 * compatibility with existing imports in the temporal-worker app.
 *
 * @deprecated Import directly from '@libs/finra-client' in new code
 */

export * from '@libs/finra-client';

// Re-export the type alias for NormalizedRow for backward compatibility
export type { createNormalizedRow as NormalizedRowFactory } from '@libs/finra-client';

// Type alias to maintain compatibility with existing code
export type NormalizedRow = Map<string, unknown>;
