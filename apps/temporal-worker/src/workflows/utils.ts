import { defineQuery, setHandler, upsertSearchAttributes } from '@temporalio/workflow';
import { defineSearchAttributeKey, SearchAttributeType, type SearchAttributeUpdatePair } from '@temporalio/common';

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
  symbol?: string;
  ticker?: string;
  cik?: string;
  filerCik?: string;
  form?: string;
  accession?: string;
  periodEnd?: string | Date;
  windowKey?: string;
  batchId?: string;
  runKind?: 'backfill' | 'daily' | 'query';
  dataset?: string;
  granularity?: string;
  weekEnd?: string | Date;
  tradeDate?: string | Date;
  provenance?: string;
}

const searchAttributesQuery = defineQuery<Record<string, string[]>>('__workflow_search_attributes');
let queryRegistered = false;
let lastAppliedAttributes: Record<string, string[]> = {};

const attributeConfig: Record<keyof Required<WorkflowSearchAttributes>, { name: string; type: SearchAttributeType }> = {
  symbol: { name: 'Symbol', type: SearchAttributeType.KEYWORD },
  ticker: { name: 'Ticker', type: SearchAttributeType.KEYWORD },
  cik: { name: 'CIK', type: SearchAttributeType.KEYWORD },
  filerCik: { name: 'FilerCIK', type: SearchAttributeType.KEYWORD },
  form: { name: 'Form', type: SearchAttributeType.KEYWORD },
  accession: { name: 'Accession', type: SearchAttributeType.KEYWORD },
  periodEnd: { name: 'PeriodEnd', type: SearchAttributeType.DATETIME },
  windowKey: { name: 'WindowKey', type: SearchAttributeType.KEYWORD },
  batchId: { name: 'BatchId', type: SearchAttributeType.KEYWORD },
  runKind: { name: 'RunKind', type: SearchAttributeType.KEYWORD },
  dataset: { name: 'Dataset', type: SearchAttributeType.KEYWORD },
  granularity: { name: 'Granularity', type: SearchAttributeType.KEYWORD },
  weekEnd: { name: 'WeekEnd', type: SearchAttributeType.DATETIME },
  tradeDate: { name: 'TradeDate', type: SearchAttributeType.DATETIME },
  provenance: { name: 'Provenance', type: SearchAttributeType.KEYWORD },
};

const cachedKeys = new Map<string, ReturnType<typeof defineSearchAttributeKey>>();

function getSearchAttributeKey(name: string, type: SearchAttributeType) {
  const cacheKey = `${name}:${type}`;
  const cached = cachedKeys.get(cacheKey);
  if (cached) return cached;
  const key = defineSearchAttributeKey(name, type);
  cachedKeys.set(cacheKey, key);
  return key;
}

export async function upsertWorkflowSearchAttributes(
  attrs: WorkflowSearchAttributes
): Promise<Record<string, string[]>> {
  if (!queryRegistered) {
    setHandler(searchAttributesQuery, () => lastAppliedAttributes);
    queryRegistered = true;
  }

  const updates: SearchAttributeUpdatePair[] = [];
  const applied: Record<string, string[]> = { ...lastAppliedAttributes };

  const entries = Object.entries(attrs) as [
    keyof WorkflowSearchAttributes,
    WorkflowSearchAttributes[keyof WorkflowSearchAttributes]
  ][];

  for (const [prop, value] of entries) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const config = attributeConfig[prop as keyof Required<WorkflowSearchAttributes>];
    if (!config) continue;

    if (config.type === SearchAttributeType.DATETIME) {
      const dateValue = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(dateValue.getTime())) {
        continue;
      }
      applied[config.name] = [dateValue.toISOString()];
      updates.push({ key: getSearchAttributeKey(config.name, config.type), value: dateValue });
      continue;
    }

    const textValue = String(value);
    applied[config.name] = [textValue];
    updates.push({ key: getSearchAttributeKey(config.name, config.type), value: textValue });
  }

  if (updates.length > 0) {
    await upsertSearchAttributes(updates);
    lastAppliedAttributes = applied;
  }

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
