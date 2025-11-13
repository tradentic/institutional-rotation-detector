import { XMLParser } from 'fast-xml-parser';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';
import { ensureEntity } from './entity-utils';

export type Month = { month: string };

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

async function resolveHolderId(supabase: SupabaseClient, cik: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('entities')
    .select('entity_id,kind')
    .eq('cik', cik);
  if (error) {
    throw new Error(`Failed to load holder entity: ${error.message}`);
  }
  const rows = (data as HolderEntityRow[] | null) ?? [];
  if (rows.length === 0) {
    // Entity doesn't exist - likely an issuer company, not a fund
    return null;
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

/**
 * Extract series_id from N-PORT document header (Problem 9: Series ID for mutual funds)
 * Series ID format: S000012345 (9 digits after 'S')
 */
function extractSeriesId(content: string): string | null {
  const trimmed = content.trim();

  // Try JSON format first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      const submission = json?.edgarSubmission ?? json;
      const headerData = submission?.headerData ?? submission;
      const seriesId = headerData?.seriesId ?? headerData?.seriesID ?? headerData?.series_id;
      if (seriesId && typeof seriesId === 'string' && /^S\d{9}$/.test(seriesId)) {
        return seriesId;
      }
    } catch {
      // Fall through to XML parsing
    }
  }

  // Try XML format
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(trimmed);
    const submission = parsed?.edgarSubmission ?? parsed;
    const headerData = submission?.headerData ?? submission;
    const seriesId = headerData?.seriesId ?? headerData?.seriesID ?? headerData?.series_id;
    if (seriesId && typeof seriesId === 'string' && /^S\d{9}$/.test(seriesId)) {
      return seriesId;
    }
  } catch {
    // Fall through
  }

  return null;
}

export async function fetchMonthly(cik: string, months: Month[], now = new Date()): Promise<number> {
  const supabase = createSupabaseClient();
  const secClient = createSecClient();
  const normalizedCik = normalizeCik(cik);

  // Fetch submissions to check for N-PORT filings
  const submissionsResponse = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
  const submissionsJson = await submissionsResponse.json();
  const recentFilings = submissionsJson?.filings?.recent;
  if (!recentFilings || typeof recentFilings !== 'object') {
    throw new Error('Unexpected SEC submissions payload');
  }
  const filings = combineRecentFilings(recentFilings as Record<string, unknown>);

  // Check if there are any N-PORT filings - if not, skip (this is not a fund)
  const hasNportFilings = filings.some((f) => f?.form?.startsWith('NPORT-P'));
  if (!hasNportFilings) {
    console.log(`[fetchMonthly] No N-PORT filings found for CIK ${normalizedCik}, skipping (not a fund)`);
    return 0;
  }

  // Try to extract series_id from the most recent N-PORT filing (Problem 9)
  let seriesId: string | null = null;
  const firstNportFiling = filings.find((f) => f?.form?.startsWith('NPORT-P') && f.primaryDocument);
  if (firstNportFiling && firstNportFiling.primaryDocument) {
    try {
      const documentPath = buildDocumentUrl(normalizedCik, firstNportFiling.accessionNumber, firstNportFiling.primaryDocument);
      const documentResponse = await secClient.get(documentPath);
      const raw = await documentResponse.text();
      seriesId = extractSeriesId(raw);
      if (seriesId) {
        console.log(`[fetchMonthly] Extracted series_id ${seriesId} for CIK ${normalizedCik}`);
      }
    } catch (error) {
      console.warn(`[fetchMonthly] Failed to extract series_id from N-PORT document:`, error);
    }
  }

  // Ensure fund entity exists with series_id (auto-creates if needed)
  const { entity_id: holderId } = await ensureEntity(normalizedCik, 'fund', seriesId ?? undefined);

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
        asof: asOf,
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

function formatMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function incrementMonth(month: string, delta = 1): string | null {
  const parsed = parseMonth(month);
  if (!parsed) return null;
  parsed.setUTCMonth(parsed.getUTCMonth() + delta);
  return formatMonth(parsed);
}

function findFirstAvailableMonth(now: Date): string | null {
  let probe = formatMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  for (let i = 0; i < 24; i += 1) {
    if (isMonthAvailable(probe, now, AVAILABILITY_LAG_DAYS)) {
      return probe;
    }
    const next = incrementMonth(probe, -1);
    if (!next) {
      break;
    }
    probe = next;
  }
  return null;
}

export interface NportMonthlyPlanInput {
  lastMonth?: string | null;
  now: string;
  maxMonths?: number;
}

export interface NportMonthlyPlanResult {
  months: Month[];
  ciks: string[];
  nextCursor: string | null;
}

export async function planNportMonthlySnapshots(
  input: NportMonthlyPlanInput
): Promise<NportMonthlyPlanResult> {
  const supabase = createSupabaseClient();
  const nowDate = new Date(`${input.now}T00:00:00Z`);
  if (Number.isNaN(nowDate.getTime())) {
    throw new Error(`Invalid reference date: ${input.now}`);
  }

  const { data, error } = await supabase
    .from('entities')
    .select('cik,kind')
    .in('kind', ['fund', 'etf'])
    .not('cik', 'is', null)
    .order('cik', { ascending: true });
  if (error) {
    throw error;
  }

  const ciks = Array.from(
    new Set(
      ((data ?? []) as { cik: string | null }[])
        .map((row) => (row.cik ? normalizeCik(row.cik) : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (ciks.length === 0) {
    return { months: [], ciks: [], nextCursor: input.lastMonth ?? null };
  }

  const maxMonths = Math.max(1, input.maxMonths ?? 1);
  const months: Month[] = [];
  let candidate = input.lastMonth ? incrementMonth(input.lastMonth) : findFirstAvailableMonth(nowDate);
  let guard = 0;
  while (candidate && months.length < maxMonths) {
    if (!isMonthAvailable(candidate, nowDate, AVAILABILITY_LAG_DAYS)) {
      break;
    }
    months.push({ month: candidate });
    candidate = incrementMonth(candidate);
    guard += 1;
    if (guard > 48) {
      break;
    }
  }

  const nextCursor = months.length > 0 ? months[months.length - 1]!.month : input.lastMonth ?? null;
  return { months, ciks, nextCursor };
}
