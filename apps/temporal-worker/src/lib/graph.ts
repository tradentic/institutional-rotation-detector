import { randomUUID } from 'crypto';

export type GraphNodeKind =
  | 'issuer'
  | 'manager'
  | 'fund'
  | 'etf'
  | 'security'
  | 'filing'
  | 'index_event';

export interface GraphNodeInput {
  kind: GraphNodeKind;
  key: string;
  name?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface GraphEdgeInput {
  src: string;
  dst: string;
  relation: string;
  asof: string;
  weight: number;
  attrs?: Record<string, unknown>;
}

export interface PositionRecord {
  entity_id: string;
  cusip: string;
  asof: string;
  shares: number;
  opt_put_shares: number;
  opt_call_shares: number;
  accession: string | null;
}

export interface EntityRecord {
  entity_id: string;
  cik: string | null;
  name: string;
  kind: GraphNodeKind;
}

export interface CusipIssuerRecord {
  cusip: string;
  issuer_cik: string;
}

export interface FilingRecord {
  accession: string;
  cik: string;
  form: string;
  filed_date: string;
  event_date: string | null;
  period_end: string | null;
  cadence?: 'annual' | 'semiannual' | 'quarterly' | 'monthly' | 'event' | 'adhoc' | null;
  expected_publish_at?: string | null;
  published_at?: string | null;
  is_amendment?: boolean;
  amendment_of_accession?: string | null;
}

export interface BoSnapshotRecord {
  issuer_cik: string;
  holder_cik: string;
  event_date: string;
  filed_date: string;
  pct_of_class: number | null;
  shares_est: number | null;
  accession: string | null;
}

export interface UhfPositionRecord {
  holder_id: string;
  cusip: string;
  asof: string;
  shares: number;
  source: 'NPORT' | 'ETF';
}

export interface GraphBuildSource {
  positions: PositionRecord[];
  entities: EntityRecord[];
  cusipIssuers: CusipIssuerRecord[];
  filings: FilingRecord[];
  boSnapshots: BoSnapshotRecord[];
  uhfPositions: UhfPositionRecord[];
}

export interface GraphBuilderResult {
  nodesCreated: number;
  edgesUpserted: number;
  processedAccessions: string[];
}

export interface GraphStore {
  ensureNode(node: GraphNodeInput): Promise<string>;
  upsertEdge(edge: GraphEdgeInput): Promise<string>;
}

export function normalizeDate(date: string): string {
  return new Date(date + 'T00:00:00Z').toISOString().slice(0, 10);
}

export function sortChronologically(records: { asof: string }[]): void {
  records.sort((a, b) => new Date(a.asof).getTime() - new Date(b.asof).getTime());
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

interface PositionDelta {
  entityId: string;
  cusip: string;
  start: PositionRecord;
  end: PositionRecord;
  deltaShares: number;
  deltaPut: number;
  deltaCall: number;
  accessions: string[];
}

function computePositionDeltas(records: PositionRecord[]): PositionDelta[] {
  const byKey = new Map<string, PositionRecord[]>();
  for (const rec of records) {
    const key = `${rec.entity_id}__${rec.cusip}`;
    const list = byKey.get(key);
    if (list) {
      list.push(rec);
    } else {
      byKey.set(key, [rec]);
    }
  }
  const deltas: PositionDelta[] = [];
  for (const [, rows] of byKey) {
    sortChronologically(rows);
    const start = rows[0]!;
    const end = rows[rows.length - 1]!;
    const deltaShares = (end.shares ?? 0) - (start.shares ?? 0);
    const deltaPut = (end.opt_put_shares ?? 0) - (start.opt_put_shares ?? 0);
    const deltaCall = (end.opt_call_shares ?? 0) - (start.opt_call_shares ?? 0);
    if (deltaShares === 0 && deltaPut === 0 && deltaCall === 0) {
      continue;
    }
    const accessions = unique(
      rows
        .map((r) => r.accession)
        .filter((acc): acc is string => typeof acc === 'string' && acc.length > 0)
    );
    deltas.push({
      entityId: end.entity_id,
      cusip: end.cusip,
      start,
      end,
      deltaShares,
      deltaPut,
      deltaCall,
      accessions,
    });
  }
  return deltas;
}

function buildEdgeAttrs(delta: PositionDelta): Record<string, unknown> {
  return {
    delta_shares: delta.deltaShares,
    delta_put_shares: delta.deltaPut,
    delta_call_shares: delta.deltaCall,
    start_asof: delta.start.asof,
    end_asof: delta.end.asof,
    accessions: delta.accessions,
  };
}

interface IssuerLookup {
  cusip: string;
  issuerNodeId: string;
  issuerCik: string;
}

export class GraphBuilder {
  constructor(private readonly store: GraphStore) {}

  async build(source: GraphBuildSource): Promise<GraphBuilderResult> {
    const nodeCache = new Map<string, string>();
    let nodesCreated = 0;
    let edgesUpserted = 0;
    const processedAccessions = new Set<string>();

    const entitiesById = new Map(source.entities.map((entity) => [entity.entity_id, entity] as const));
    const issuerMap = new Map(source.cusipIssuers.map((row) => [row.cusip, row.issuer_cik] as const));

    const issuerCache = new Map<string, IssuerLookup>();

    const ensureNode = async (input: GraphNodeInput): Promise<string> => {
      const cacheKey = `${input.kind}:${input.key}`;
      const cached = nodeCache.get(cacheKey);
      if (cached) return cached;
      const nodeId = await this.store.ensureNode(input);
      nodeCache.set(cacheKey, nodeId);
      nodesCreated += 1;
      return nodeId;
    };

    const ensureIssuerForCusip = async (cusip: string): Promise<IssuerLookup | null> => {
      const cached = issuerCache.get(cusip);
      if (cached) return cached;
      const issuerCik = issuerMap.get(cusip);
      if (!issuerCik) return null;
      const issuerEntity = source.entities.find((entity) => entity.cik === issuerCik && entity.kind === 'issuer');
      const issuerNodeId = await ensureNode({
        kind: 'issuer',
        key: issuerCik,
        name: issuerEntity?.name ?? issuerCik,
      });
      const lookup: IssuerLookup = { cusip, issuerNodeId, issuerCik };
      issuerCache.set(cusip, lookup);
      return lookup;
    };

    const handlePositionDelta = async (delta: PositionDelta) => {
      const entity = entitiesById.get(delta.entityId);
      if (!entity) return;
      const managerNode = await ensureNode({
        kind: entity.kind,
        key: entity.cik ?? entity.entity_id,
        name: entity.name,
        meta: entity.cik ? { cik: entity.cik } : undefined,
      });
      const securityNode = await ensureNode({
        kind: 'security',
        key: delta.cusip,
      });
      const attrs = buildEdgeAttrs(delta);
      const weight = Math.abs(delta.deltaShares) + Math.abs(delta.deltaPut) + Math.abs(delta.deltaCall);
      await this.store.upsertEdge({
        src: managerNode,
        dst: securityNode,
        relation: 'REPORTS_POSITION',
        asof: normalizeDate(delta.end.asof),
        weight,
        attrs,
      });
      edgesUpserted += 1;
      for (const accession of delta.accessions) {
        processedAccessions.add(accession);
      }
      const issuerLookup = await ensureIssuerForCusip(delta.cusip);
      if (issuerLookup) {
        await this.store.upsertEdge({
          src: securityNode,
          dst: issuerLookup.issuerNodeId,
          relation: 'SECURITY_OF',
          asof: normalizeDate(delta.end.asof),
          weight: 1,
          attrs: { cusip: delta.cusip },
        });
        edgesUpserted += 1;
      }
    };

    for (const delta of computePositionDeltas(source.positions)) {
      await handlePositionDelta(delta);
    }

    for (const bo of source.boSnapshots) {
      const issuerNode = await ensureNode({
        kind: 'issuer',
        key: bo.issuer_cik,
        name: source.entities.find((entity) => entity.cik === bo.issuer_cik)?.name ?? bo.issuer_cik,
      });
      const holderNode = await ensureNode({
        kind: 'manager',
        key: bo.holder_cik,
        name: source.entities.find((entity) => entity.cik === bo.holder_cik)?.name ?? bo.holder_cik,
      });
      await this.store.upsertEdge({
        src: holderNode,
        dst: issuerNode,
        relation: 'BENEFICIAL_OWNER_OF',
        asof: normalizeDate(bo.event_date),
        weight: bo.pct_of_class ?? Math.max(bo.shares_est ?? 0, 0),
        attrs: {
          pct_of_class: bo.pct_of_class,
          shares_est: bo.shares_est,
          filed_date: bo.filed_date,
          accession: bo.accession,
        },
      });
      edgesUpserted += 1;
      if (bo.accession) processedAccessions.add(bo.accession);
    }

    const uhfKey = new Map<string, UhfPositionRecord[]>();
    for (const uhf of source.uhfPositions) {
      const key = `${uhf.holder_id}__${uhf.cusip}`;
      const list = uhfKey.get(key);
      if (list) {
        list.push(uhf);
      } else {
        uhfKey.set(key, [uhf]);
      }
    }
    for (const [, rows] of uhfKey) {
      sortChronologically(rows);
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      const deltaShares = last.shares - first.shares;
      if (deltaShares === 0) continue;
      const holderEntity = entitiesById.get(last.holder_id);
      const holderNode = await ensureNode({
        kind: holderEntity?.kind ?? 'fund',
        key: holderEntity?.cik ?? last.holder_id,
        name: holderEntity?.name ?? last.holder_id,
      });
      const securityNode = await ensureNode({
        kind: 'security',
        key: last.cusip,
      });
      await this.store.upsertEdge({
        src: holderNode,
        dst: securityNode,
        relation: 'REPORTS_UHF_POSITION',
        asof: normalizeDate(last.asof),
        weight: Math.abs(deltaShares),
        attrs: {
          source: rows.map((r) => r.source),
          start_asof: first.asof,
          end_asof: last.asof,
        },
      });
      edgesUpserted += 1;
      const issuerLookup = await ensureIssuerForCusip(last.cusip);
      if (issuerLookup) {
        await this.store.upsertEdge({
          src: securityNode,
          dst: issuerLookup.issuerNodeId,
          relation: 'SECURITY_OF',
          asof: normalizeDate(last.asof),
          weight: 1,
          attrs: { cusip: last.cusip },
        });
        edgesUpserted += 1;
      }
    }

    for (const accession of processedAccessions) {
      const filing = source.filings.find((f) => f.accession === accession);
      if (!filing) continue;
      const filerEntity = source.entities.find((entity) => entity.cik === filing.cik);
      if (!filerEntity) continue;
      const filingNode = await ensureNode({
        kind: 'filing',
        key: filing.accession,
        name: `${filing.form} ${filing.accession}`,
        meta: {
          filed_date: filing.filed_date,
          period_end: filing.period_end,
          event_date: filing.event_date,
        },
      });
      const filerNode = await ensureNode({
        kind: filerEntity.kind,
        key: filerEntity.cik ?? filerEntity.entity_id,
        name: filerEntity.name,
      });
      await this.store.upsertEdge({
        src: filingNode,
        dst: filerNode,
        relation: 'FILED_BY',
        asof: normalizeDate(filing.filed_date),
        weight: 1,
        attrs: {
          form: filing.form,
          event_date: filing.event_date,
        },
      });
      edgesUpserted += 1;
    }

    return {
      nodesCreated,
      edgesUpserted,
      processedAccessions: Array.from(processedAccessions),
    };
  }
}

export function createEmptyGraphStore(): GraphStore {
  const nodes = new Map<string, { id: string; input: GraphNodeInput }>();
  const edges = new Map<string, { id: string; input: GraphEdgeInput }>();
  return {
    async ensureNode(input) {
      const key = `${input.kind}:${input.key}`;
      const existing = nodes.get(key);
      if (existing) {
        return existing.id;
      }
      const id = randomUUID();
      nodes.set(key, { id, input });
      return id;
    },
    async upsertEdge(edge) {
      const key = `${edge.src}:${edge.dst}:${edge.relation}:${edge.asof}`;
      const existing = edges.get(key);
      if (existing) {
        existing.input = edge;
        return existing.id;
      }
      const id = randomUUID();
      edges.set(key, { id, input: edge });
      return id;
    },
  };
}
