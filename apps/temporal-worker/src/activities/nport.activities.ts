import { XMLParser } from 'fast-xml-parser';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase.js';
import { createSecClient } from '../lib/secClient.js';

type Month = { month: string };

const AVAILABILITY_LAG_DAYS = Number(process.env.NPORT_AVAILABILITY_LAG_DAYS ?? '60');
const HOLDINGS_CHUNK_SIZE = 500;
const KIND_PRIORITY: Record<string, number> = { fund: 0, etf: 1, manager: 2, issuer: 3 };

export interface NportHolding {
  cusip: string;
  shares: number;
}

interface FilingSummary {
  accessionNumber: string;
  reportDate?: string | null;
  primaryDocument?: string | null;
  form?: string | null;
}

interface HolderEntityRow {
  entity_id: string;
  kind: string;
}

function normalizeCik(value: string): string {
  return value.replace(/[^\d]/g, '').padStart(10, '0');
}

function normalizeCusip(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return normalized.length === 9 ? normalized : null;
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  const str = String(value).replace(/,/g, '').trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseNportJsonDocument(document: unknown): NportHolding[] {
  if (!document || typeof document !== 'object') return [];
  const root = document as Record<string, unknown>;
  const submission = (root.edgarSubmission as Record<string, unknown>) ?? root;
  const formData = (submission?.formData as Record<string, unknown>) ?? submission;
  const invstOrSecs = formData?.invstOrSecs ?? formData?.invstOrSec ?? formData?.invstOrSecurities;
  const candidates = Array.isArray(invstOrSecs)
    ? invstOrSecs
    : (invstOrSecs as { invstOrSec?: unknown })?.invstOrSec ?? invstOrSecs;
  const holdings = toArray(candidates as Record<string, unknown> | Record<string, unknown>[]);
  return extractHoldings(holdings);
}

function parseNportXmlDocument(xml: string): NportHolding[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const submission = parsed?.edgarSubmission ?? parsed;
  const formData = submission?.formData ?? submission;
  const invstOrSecs = formData?.invstOrSecs ?? formData?.invstOrSec ?? formData;
  const primary = invstOrSecs?.invstOrSec ?? invstOrSecs;
  const holdings = toArray(primary);
  return extractHoldings(holdings);
}

function extractHoldings(rawHoldings: Record<string, unknown>[]): NportHolding[] {
  const aggregated = new Map<string, number>();
  for (const holding of rawHoldings) {
    const identifiers = holding.identifiers as Record<string, unknown> | undefined;
    const cusipCandidates = [
      identifiers?.cusip,
      identifiers?.CUSIP,
      holding.cusip,
      (holding.security as Record<string, unknown> | undefined)?.cusip,
    ];
    let cusip: string | null = null;
    for (const candidate of cusipCandidates) {
      cusip = normalizeCusip(candidate);
      if (cusip) break;
    }
    if (!cusip) continue;
    const balanceCandidates = [
      holding.balance,
      holding.balanceAmt,
      holding.balanceShares,
      holding.balanceShare,
      identifiers?.balance,
      (holding.balance as { '#text'?: unknown })?.['#text'],
    ];
    let shares: number | null = null;
    for (const candidate of balanceCandidates) {
      shares = parseNumeric(candidate);
      if (shares !== null) break;
    }
    if (shares === null) continue;
    aggregated.set(cusip, (aggregated.get(cusip) ?? 0) + shares);
  }
  return Array.from(aggregated.entries()).map(([cusip, shares]) => ({ cusip, shares }));
}

function parseMonth(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex)) return null;
  return new Date(Date.UTC(year, monthIndex, 1));
}

function endOfMonth(monthStr: string): Date | null {
  const start = parseMonth(monthStr);
  if (!start) return null;
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return new Date(next.getTime() - 24 * 60 * 60 * 1000);
}

function isMonthAvailable(month: string, now: Date, lagDays: number): boolean {
  const end = endOfMonth(month);
  if (!end) return false;
  const available = new Date(end.getTime() + lagDays * 24 * 60 * 60 * 1000);
  return now >= available;
}

function monthKey(date: string | null | undefined): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})/.exec(date);
  return match ? `${match[1]}-${match[2]}` : null;
}

function sanitizeReportDate(reportDate: string | null | undefined, month: string): string {
  if (reportDate && /^(\d{4})-(\d{2})-(\d{2})$/.test(reportDate)) {
    return reportDate;
  }
  const fallback = endOfMonth(month);
  return fallback ? fallback.toISOString().slice(0, 10) : `${month}-01`;
}

function combineRecentFilings(recent: Record<string, unknown>): FilingSummary[] {
  const accessions = toArray(recent.accessionNumber as string[] | undefined);
  const reports = toArray(recent.reportDate as (string | null)[] | undefined);
  const documents = toArray(recent.primaryDocument as (string | null)[] | undefined);
  const forms = toArray(recent.form as (string | null)[] | undefined);
  const length = Math.max(accessions.length, reports.length, documents.length, forms.length);
  const filings: FilingSummary[] = [];
  for (let i = 0; i < length; i += 1) {
    filings.push({
      accessionNumber: accessions[i] ?? '',
      reportDate: reports[i] ?? null,
      primaryDocument: documents[i] ?? null,
      form: forms[i] ?? null,
    });
  }
  return filings;
}

async function resolveHolderId(supabase: SupabaseClient, cik: string): Promise<string> {
  const { data, error } = await supabase
    .from('entities')
    .select('entity_id,kind')
    .eq('cik', cik);
  if (error) {
    throw new Error(`Failed to load holder entity: ${error.message}`);
  }
  const rows = (data as HolderEntityRow[] | null) ?? [];
  if (rows.length === 0) {
    throw new Error(`Holder entity not found for CIK ${cik}`);
  }
  rows.sort((a, b) => (KIND_PRIORITY[a.kind] ?? 99) - (KIND_PRIORITY[b.kind] ?? 99));
  return rows[0]!.entity_id;
}

function buildDocumentUrl(cik: string, accession: string, document: string): string {
  const accessionSanitized = accession.replace(/-/g, '');
  const cikNumeric = String(parseInt(cik, 10));
  return `/Archives/edgar/data/${cikNumeric}/${accessionSanitized}/${document}`;
}

export function parseNportDocument(content: string): NportHolding[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      return parseNportJsonDocument(json);
    } catch (error) {
      console.warn('Failed to parse N-PORT JSON payload', error);
    }
  }
  try {
    return parseNportXmlDocument(trimmed);
  } catch (error) {
    console.warn('Failed to parse N-PORT XML payload', error);
    return [];
  }
}

export async function fetchMonthly(cik: string, months: Month[], now = new Date()): Promise<number> {
  const supabase = createSupabaseClient();
  const secClient = createSecClient();
  const normalizedCik = normalizeCik(cik);
  const holderId = await resolveHolderId(supabase, normalizedCik);

  const submissionsResponse = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
  const submissionsJson = await submissionsResponse.json();
  const recentFilings = submissionsJson?.filings?.recent;
  if (!recentFilings || typeof recentFilings !== 'object') {
    throw new Error('Unexpected SEC submissions payload');
  }
  const filings = combineRecentFilings(recentFilings as Record<string, unknown>);
  const monthToFiling = new Map<string, FilingSummary>();
  for (const filing of filings) {
    if (!filing || !filing.accessionNumber) continue;
    if (!filing.form || !filing.form.startsWith('NPORT-P')) continue;
    const key = monthKey(filing.reportDate);
    if (!key) continue;
    if (!monthToFiling.has(key)) {
      monthToFiling.set(key, filing);
    }
  }

  let totalHoldings = 0;
  for (const month of months) {
    if (!isMonthAvailable(month.month, now, AVAILABILITY_LAG_DAYS)) {
      continue;
    }
    const filing = monthToFiling.get(month.month);
    if (!filing || !filing.primaryDocument) {
      console.warn(`No N-PORT filing found for ${month.month}`);
      continue;
    }
    const documentPath = buildDocumentUrl(normalizedCik, filing.accessionNumber, filing.primaryDocument);
    try {
      const documentResponse = await secClient.get(documentPath);
      const raw = await documentResponse.text();
      const holdings = parseNportDocument(raw);
      if (holdings.length === 0) {
        console.warn(`No holdings parsed for ${month.month}`);
        continue;
      }
      const asOf = sanitizeReportDate(filing.reportDate, month.month);
      const records = holdings.map((holding) => ({
        holder_id: holderId,
        cusip: holding.cusip,
        asof,
        shares: holding.shares,
        source: 'NPORT' as const,
      }));
      for (let index = 0; index < records.length; index += HOLDINGS_CHUNK_SIZE) {
        const chunk = records.slice(index, index + HOLDINGS_CHUNK_SIZE);
        const { error } = await supabase
          .from('uhf_positions')
          .upsert(chunk, { onConflict: 'holder_id,cusip,asof,source' });
        if (error) {
          throw new Error(`Failed to upsert holdings: ${error.message}`);
        }
      }
      totalHoldings += records.length;
    } catch (error) {
      console.error(`Failed to process N-PORT for ${month.month}`, error);
    }
  }

  return totalHoldings;
}
