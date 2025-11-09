/**
 * Custom Temporal Search Attributes Type Definitions
 *
 * Extends the Temporal SDK's WorkflowSearchAttributes interface
 * with project-specific custom search attributes.
 *
 * These attributes must be registered in Temporal before use.
 * See: tools/setup-temporal-attributes.sh
 */

import '@temporalio/workflow';

declare module '@temporalio/workflow' {
  interface WorkflowSearchAttributes {
    // Core rotation detection attributes
    Ticker?: string[];
    CIK?: string[];
    FilerCIK?: string[];
    Form?: string[];
    Accession?: string[];
    PeriodEnd?: Date[];
    WindowKey?: string[];
    BatchId?: string[];
    RunKind?: string[];

    // Microstructure data attributes
    Symbol?: string[];
    Dataset?: string[];
    Granularity?: string[];
    WeekEnd?: Date[];
    TradeDate?: Date[];
    SettlementDate?: Date[];
    Provenance?: string[];
  }
}
