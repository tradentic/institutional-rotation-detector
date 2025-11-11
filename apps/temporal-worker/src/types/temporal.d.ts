/**
 * Custom Temporal Search Attributes Type Definitions
 *
 * Extends the Temporal SDK's WorkflowSearchAttributes interface
 * with project-specific custom search attributes.
 *
 * All attributes use the "Ird_" namespace prefix (Pascal case) to identify
 * them as belonging to the Institutional Rotation Detector project and
 * prevent conflicts with other projects sharing the same Temporal namespace.
 *
 * These attributes must be registered in Temporal before use.
 * See: tools/setup-temporal-attributes.sh
 *
 * This file must be imported in workflows/utils.ts to ensure the
 * type augmentation is available to all workflows.
 */

declare module '@temporalio/workflow' {
  interface WorkflowSearchAttributes {
    // Core rotation detection attributes (namespaced with Ird_ prefix)
    Ird_Ticker?: string[];
    Ird_CIK?: string[];
    Ird_FilerCIK?: string[];
    Ird_Form?: string[];
    Ird_Accession?: string[];
    Ird_PeriodEnd?: Date[];
    Ird_WindowKey?: string[];
    Ird_BatchId?: string[];
    Ird_RunKind?: string[];

    // Microstructure data attributes (namespaced with Ird_ prefix)
    Ird_Symbol?: string[];
    Ird_Dataset?: string[];
    Ird_Granularity?: string[];
    Ird_WeekEnd?: Date[];
    Ird_TradeDate?: Date[];
    Ird_SettlementDate?: Date[];
    Ird_Provenance?: string[];
  }
}

// Export empty object to make this a module
export {};
