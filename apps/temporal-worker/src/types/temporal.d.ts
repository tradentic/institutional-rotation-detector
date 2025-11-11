/**
 * Custom Temporal Search Attributes Type Definitions
 *
 * Extends the Temporal SDK's WorkflowSearchAttributes interface
 * with project-specific custom search attributes.
 *
 * These attributes must be registered in Temporal before use.
 * See: tools/setup-temporal-attributes.sh
 *
 * This file must be imported in workflows/utils.ts to ensure the
 * type augmentation is available to all workflows.
 */

declare module '@temporalio/workflow' {
  interface WorkflowSearchAttributes {
    // Core rotation detection attributes (namespaced with ird_ prefix)
    ird_Ticker?: string[];
    ird_CIK?: string[];
    ird_FilerCIK?: string[];
    ird_Form?: string[];
    ird_Accession?: string[];
    ird_PeriodEnd?: Date[];
    ird_WindowKey?: string[];
    ird_BatchId?: string[];
    ird_RunKind?: string[];

    // Microstructure data attributes (namespaced with ird_ prefix)
    ird_Symbol?: string[];
    ird_Dataset?: string[];
    ird_Granularity?: string[];
    ird_WeekEnd?: Date[];
    ird_TradeDate?: Date[];
    ird_SettlementDate?: Date[];
    ird_Provenance?: string[];
  }
}

// Export empty object to make this a module
export {};
