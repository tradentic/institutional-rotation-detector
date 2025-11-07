import { defineQuery, setHandler, upsertSearchAttributes, workflowInfo } from '@temporalio/workflow';
import {
  defineSearchAttributeKey,
  SearchAttributeType,
  type SearchAttributeUpdatePair,
} from '@temporalio/common';

export function resolveQuarterRange(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const quarters: string[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
    quarters.push(`${year}Q${q}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 3);
  }
  return Array.from(new Set(quarters));
}

export interface WorkflowSearchAttributes {
  ticker?: string;
  cik: string;
  runKind: 'backfill' | 'daily';
  quarterStart: string;
  quarterEnd: string;
}

const searchAttributesQuery = defineQuery<Record<string, string[]>>('__workflow_search_attributes');
let queryRegistered = false;
let lastAppliedAttributes: Record<string, string[]> = {};

export async function upsertWorkflowSearchAttributes(
  attrs: WorkflowSearchAttributes
): Promise<Record<string, string[]>> {
  if (!queryRegistered) {
    setHandler(searchAttributesQuery, () => lastAppliedAttributes);
    queryRegistered = true;
  }
  const updates: SearchAttributeUpdatePair[] = [
    { key: defineSearchAttributeKey('cik', SearchAttributeType.KEYWORD), value: attrs.cik },
    { key: defineSearchAttributeKey('run_kind', SearchAttributeType.KEYWORD), value: attrs.runKind },
    { key: defineSearchAttributeKey('quarter_start', SearchAttributeType.TEXT), value: attrs.quarterStart },
    { key: defineSearchAttributeKey('quarter_end', SearchAttributeType.TEXT), value: attrs.quarterEnd },
  ];
  if (attrs.ticker) {
    updates.push({ key: defineSearchAttributeKey('ticker', SearchAttributeType.KEYWORD), value: attrs.ticker });
  }
  lastAppliedAttributes = {
    cik: [attrs.cik],
    run_kind: [attrs.runKind],
    quarter_start: [attrs.quarterStart],
    quarter_end: [attrs.quarterEnd],
  };
  if (attrs.ticker) {
    lastAppliedAttributes.ticker = [attrs.ticker];
  }
  await upsertSearchAttributes(updates);
  return lastAppliedAttributes;
}

export function quarterBounds(quarter: string) {
  const match = quarter.match(/(\d{4})Q([1-4])/);
  if (!match) throw new Error('Invalid quarter');
  const year = Number(match[1]);
  const q = Number(match[2]);
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
