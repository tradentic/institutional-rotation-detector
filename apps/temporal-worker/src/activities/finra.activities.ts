import { createSupabaseClient } from '../lib/supabase';
import { createNormalizedRow } from '@libs/finra-client';
import { getFinraClient } from '../lib/finraClient';
import crypto from 'crypto';
import type { MicroOffExVenueWeeklyRecord, MicroOffExSymbolWeeklyRecord, OffExSource } from '../lib/schema';
import { upsertCusipMapping } from './entity-utils';

// Type alias for normalized row (lowercase keys)
type NormalizedRow = Map<string, unknown>;

function normalizeIdentifier(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'number') {
    return String(value).padStart(9, '0');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.toUpperCase();
  }
  return null;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getField(row: NormalizedRow, ...candidates: string[]): unknown {
  for (const candidate of candidates) {
    const value = row.get(candidate.toLowerCase());
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function extractCusip(row: NormalizedRow): string | null {
  const value = getField(
    row,
    'cusip',
    'issueidentifier',
    'issue_id',
    'securityid',
    'securityidentifier',
    'issueid',
    'cnsissueid',
    'cins'
  );
  return normalizeIdentifier(value);
}

function extractSymbol(row: NormalizedRow): string | null {
  const value = getField(
    row,
    'issuesymbolidentifier',  // Weekly summary field
    'symbolcode',              // Short interest field (FINRA name)
    'symbol',
    'ticker',
    'securitysymbol',
    'issue_symbol'
  );
  return normalizeIdentifier(value);
}

function extractShortShares(row: NormalizedRow): number | null {
  const value = getField(
    row,
    'currentshortpositionquantity',  // FINRA field name
    'shortinterest',
    'currentshortinterestquantity',
    'currentshortinterest',
    'short_interest',
    'shortinterestqty',
    'shortinterestquantity',
    'current_short_interest',
    'short_interest_shares'
  );
  return parseNumeric(value ?? null);
}

function extractAtsShares(row: NormalizedRow): number | null {
  const value = getField(
    row,
    'totalweeklysharequantity',
    'sharequantity',
    'shares',
    'totalsharequantity',
    'total_shares'
  );
  return parseNumeric(value ?? null);
}

function extractAtsTrades(row: NormalizedRow): number | null {
  const value = getField(
    row,
    'totalweeklytradecount',
    'tradecount',
    'trades',
    'totaltradecount',
    'total_trades'
  );
  return parseNumeric(value ?? null);
}

function extractVenue(row: NormalizedRow): string {
  const value = getField(
    row,
    'atsparticipantname',
    'atsname',
    'venue',
    'marketcenter',
    'atscode',
    'ats_mp_id',
    'atsid'
  );
  const venue = normalizeIdentifier(value) ?? 'UNKNOWN';
  return venue;
}

async function loadCusips(supabase: ReturnType<typeof createSupabaseClient>, cik: string): Promise<Set<string>> {
  const cusipQuery = await supabase.from('cusip_issuer_map').select('cusip').eq('issuer_cik', cik);
  if (cusipQuery.error) {
    throw cusipQuery.error;
  }
  const cusips = new Set<string>();
  for (const row of cusipQuery.data ?? []) {
    const normalized = normalizeIdentifier(row.cusip);
    if (normalized) {
      cusips.add(normalized);
    }
  }
  return cusips;
}

async function loadTickerForCik(supabase: ReturnType<typeof createSupabaseClient>, cik: string): Promise<string | null> {
  const entityQuery = await supabase.from('entities').select('ticker').eq('cik', cik).maybeSingle();
  if (entityQuery.error) {
    console.warn(`[loadTickerForCik] Error loading ticker for CIK ${cik}:`, entityQuery.error);
    return null;
  }
  return entityQuery.data?.ticker ?? null;
}

/**
 * Seed CUSIP-to-issuer mappings for a CIK
 * Used to populate cusip_issuer_map for issuers that don't file 13F-HR
 */
export async function seedCusipMappings(cik: string, cusips: string[]): Promise<number> {
  console.log(`[seedCusipMappings] Called with CIK ${cik}, ${cusips.length} CUSIPs`);

  if (cusips.length === 0) {
    console.log(`[seedCusipMappings] No CUSIPs provided for CIK ${cik}, skipping`);
    return 0;
  }

  const supabase = createSupabaseClient();
  const records = cusips.map((cusip) => ({
    cusip: normalizeIdentifier(cusip) ?? cusip,
    issuer_cik: cik,
  }));

  const { error, count } = await (supabase
    .from('cusip_issuer_map')
    .upsert(records, { onConflict: 'cusip' }) as any)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`[seedCusipMappings] Error upserting CUSIPs for CIK ${cik}:`, error);
    throw error;
  }

  const upserted = count ?? records.length;
  console.log(`[seedCusipMappings] Successfully upserted ${upserted} CUSIP mappings for CIK ${cik}`);
  return upserted;
}

function normalizeRows(rows: Record<string, unknown>[]): NormalizedRow[] {
  return rows.map((row) => {
    const normalized = new Map<string, unknown>();
    for (const [key, value] of Object.entries(row)) {
      normalized.set(key.toLowerCase(), value);
    }
    return normalized;
  });
}

export async function fetchShortInterest(cik: string, dateRange: { start: string; end: string }): Promise<number> {
  // Ensure CUSIP mappings exist before attempting to fetch
  await upsertCusipMapping(cik);

  const supabase = createSupabaseClient();
  const finra = getFinraClient();
  const cusips = await loadCusips(supabase, cik);
  const ticker = await loadTickerForCik(supabase, cik);

  // Create set of identifiers to match (CUSIPs + ticker)
  const identifiers = new Set(cusips);
  if (ticker) {
    identifiers.add(ticker.toUpperCase());
  }

  // If still no identifiers exist, skip
  if (identifiers.size === 0) {
    console.log(`[fetchShortInterest] No CUSIP mappings or ticker found for CIK ${cik}, skipping`);
    return 0;
  }

  console.log(`[fetchShortInterest] Fetching short interest for CIK ${cik} (ticker: ${ticker}, CUSIPs: ${Array.from(cusips).join(', ')}) from ${dateRange.start} to ${dateRange.end}`);

  // Fetch date range using ticker (symbolCode per FINRA API)
  // Note: FINRA consolidatedShortInterest uses symbolCode, not CUSIP
  const dataset: unknown[] = [];
  if (ticker) {
    const records = await finra.getConsolidatedShortInterestRange({
      identifiers: { symbolCode: ticker.toUpperCase() },
      startDate: dateRange.start,
      endDate: dateRange.end,
    });
    dataset.push(...records);
  }

  const rows = normalizeRows(dataset as Record<string, unknown>[]);

  console.log(`[fetchShortInterest] Retrieved ${rows.length} total short interest records from FINRA`);

  // Group by settlement date and CUSIP
  const dataByDate = new Map<string, Array<{ cusip: string; shares: number }>>();

  for (const row of rows) {
    const cusip = extractCusip(row);
    const symbol = extractSymbol(row);
    const identifier = cusip || symbol;

    if (!identifier || !identifiers.has(identifier)) continue;

    const settleDateValue = row.get('settlementdate') ||
                           row.get('settle_date');
    const settleDate = settleDateValue instanceof Date
      ? settleDateValue.toISOString().slice(0, 10)
      : String(settleDateValue);

    const shares = extractShortShares(row);
    if (shares === null) {
      console.warn(`[fetchShortInterest] Missing short interest value for identifier ${identifier} on ${settleDate}, skipping`);
      continue;
    }

    if (!dataByDate.has(settleDate)) {
      dataByDate.set(settleDate, []);
    }
    dataByDate.get(settleDate)!.push({ cusip: identifier, shares });
  }

  if (dataByDate.size === 0) {
    console.log(`[fetchShortInterest] No FINRA short interest data found for CIK ${cik} (ticker: ${ticker}, identifiers: ${Array.from(identifiers).join(', ')}) in range ${dateRange.start} to ${dateRange.end}`);
    console.log(`[fetchShortInterest] This is expected if FINRA has no data for this security, or if dates don't align with actual settlement dates`);
    return 0;
  }

  const settlementDates = Array.from(dataByDate.keys()).sort();
  console.log(`[fetchShortInterest] Found ${dataByDate.size} settlement dates with data for CIK ${cik}: ${settlementDates.join(', ')}`);

  let upserts = 0;
  for (const [date, relevantData] of dataByDate) {
    // Store per-CUSIP data (not aggregated by CIK) to support multi-series ETFs
    const payload = relevantData.map(({ cusip, shares }) => ({
      settle_date: date,
      cusip,
      short_shares: Math.round(shares),
    }));

    const upsert = await supabase
      .from('short_interest')
      .upsert(
        payload,
        { onConflict: 'settle_date,cusip' }
      )
      .select('settle_date')
      .maybeSingle();
    if (upsert.error) {
      throw upsert.error;
    }
    upserts += 1;
  }
  return upserts;
}

export async function fetchATSWeekly(
  cik: string,
  dateRange: { start: string; end: string }
): Promise<number> {
  // Ensure CUSIP mappings exist before attempting to fetch
  await upsertCusipMapping(cik);

  const supabase = createSupabaseClient();
  const finra = getFinraClient();
  const cusips = await loadCusips(supabase, cik);
  const ticker = await loadTickerForCik(supabase, cik);

  // Create set of identifiers to match (CUSIPs + ticker)
  const identifiers = new Set(cusips);
  if (ticker) {
    identifiers.add(ticker.toUpperCase());
  }

  // If still no identifiers exist, skip
  if (identifiers.size === 0) {
    console.log(`[fetchATSWeekly] No CUSIP mappings or ticker found for CIK ${cik}, skipping`);
    return 0;
  }

  console.log(`[fetchATSWeekly] Fetching ATS data for CIK ${cik} (ticker: ${ticker}, CUSIPs: ${Array.from(cusips).join(', ')}) from ${dateRange.start} to ${dateRange.end}`);

  // Fetch date range using ticker (issueSymbolIdentifier per FINRA API)
  const dataset: unknown[] = [];
  if (ticker) {
    const records = await finra.queryWeeklySummary({
      compareFilters: [
        {
          compareType: 'EQUAL',
          fieldName: 'issueSymbolIdentifier',
          fieldValue: ticker.toUpperCase(),
        },
        {
          compareType: 'GREATER',
          fieldName: 'weekStartDate',
          fieldValue: dateRange.start,
        },
        {
          compareType: 'LESSER',
          fieldName: 'weekStartDate',
          fieldValue: dateRange.end,
        },
      ],
    });
    dataset.push(...records);
  }

  const rows = normalizeRows(dataset as Record<string, unknown>[]);

  console.log(`[fetchATSWeekly] Retrieved ${rows.length} total ATS weekly records from FINRA`);

  // Group by week_end date, then by (cusip, venue)
  const dataByWeek = new Map<string, Map<string, { shares: number; trades: number | null }>>();

  for (const row of rows) {
    const cusip = extractCusip(row);
    const symbol = extractSymbol(row);
    const identifier = cusip || symbol;

    if (!identifier || !identifiers.has(identifier)) continue;

    // FINRA API returns weekStartDate (Monday), we need to convert to week end (Sunday)
    const weekStartValue = row.get('weekstartdate') ||
                          row.get('summarystartdate') ||
                          row.get('week_start');

    if (!weekStartValue) {
      console.warn(`[fetchATSWeekly] Missing week start date for identifier ${identifier}, skipping`);
      continue;
    }

    const weekStart = weekStartValue instanceof Date
      ? weekStartValue.toISOString().slice(0, 10)
      : String(weekStartValue);

    // Convert week start (Monday) to week end (Sunday) by adding 6 days
    const weekStartDate = new Date(weekStart + 'T00:00:00Z');
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);

    const shares = extractAtsShares(row);
    if (shares === null) {
      console.warn(`[fetchATSWeekly] Missing ATS share quantity for identifier ${identifier} on week ${weekEnd}, skipping`);
      continue;
    }

    const trades = extractAtsTrades(row);
    const venue = extractVenue(row);
    const key = `${identifier}:${venue}`;

    if (!dataByWeek.has(weekEnd)) {
      dataByWeek.set(weekEnd, new Map());
    }

    const weekData = dataByWeek.get(weekEnd)!;
    const entry = weekData.get(key);
    if (entry) {
      entry.shares += shares;
      if (trades !== null) {
        entry.trades = (entry.trades ?? 0) + trades;
      }
    } else {
      weekData.set(key, { shares, trades });
    }
  }

  if (dataByWeek.size === 0) {
    console.log(`[fetchATSWeekly] No ATS weekly data found for CIK ${cik} (ticker: ${ticker}, identifiers: ${Array.from(identifiers).join(', ')}) in range ${dateRange.start} to ${dateRange.end}`);
    console.log(`[fetchATSWeekly] This is expected if FINRA has no data for this security, or if dates don't align with actual week-ending dates`);
    return 0;
  }

  const weekDates = Array.from(dataByWeek.keys()).sort();
  console.log(`[fetchATSWeekly] Found ${dataByWeek.size} weeks with data for CIK ${cik}: ${weekDates.join(', ')}`);

  let upserts = 0;
  for (const [week, cusipVenueTotals] of dataByWeek) {
    const payload = Array.from(cusipVenueTotals.entries()).map(([key, totals]) => {
      const [cusip, venue] = key.split(':');
      return {
        week_end: week,
        cusip,
        venue,
        shares: Math.round(totals.shares),
        trades:
          totals.trades === null || totals.trades === undefined
            ? null
            : Math.round(totals.trades),
      };
    });
    const upsert = await supabase
      .from('ats_weekly')
      .upsert(payload, { onConflict: 'week_end,cusip,venue' })
      .select('week_end');
    if (upsert.error) {
      throw upsert.error;
    }
    upserts += payload.length;
  }
  return upserts;
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function nextSettleAfter(date: Date): Date {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (day < 15) {
    return new Date(Date.UTC(year, month, 15));
  }
  const end = endOfMonth(date);
  if (date.getTime() < end.getTime()) {
    return end;
  }
  return new Date(Date.UTC(year, month + 1, 15));
}

function previousSettleOnOrBefore(date: Date): Date {
  const end = endOfMonth(date);
  if (date.getTime() >= end.getTime()) {
    return end;
  }
  const fifteenth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 15));
  if (date.getTime() >= fifteenth.getTime()) {
    return fifteenth;
  }
  const prevEnd = endOfMonth(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)));
  return prevEnd;
}

export interface FinraShortPlanInput {
  lastSettle?: string | null;
  now: string;
  windowSize?: number;
}

export interface FinraShortPlanResult {
  settleDates: string[];
  ciks: string[];
  nextCursor: string | null;
}

export async function planFinraShortInterest(
  input: FinraShortPlanInput
): Promise<FinraShortPlanResult> {
  const supabase = createSupabaseClient();
  const nowDate = parseDate(input.now);

  const { data, error } = await supabase.from('cusip_issuer_map').select('issuer_cik');
  if (error) {
    throw error;
  }

  const ciks = Array.from(
    new Set(
      ((data ?? []) as { issuer_cik: string | null }[])
        .map((row) => normalizeIdentifier(row.issuer_cik))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (ciks.length === 0) {
    return { settleDates: [], ciks: [], nextCursor: input.lastSettle ?? null };
  }

  const windowSize = Math.max(1, input.windowSize ?? 1);
  const settleDates: string[] = [];
  let candidate = input.lastSettle ? nextSettleAfter(parseDate(input.lastSettle)) : previousSettleOnOrBefore(nowDate);
  let guard = 0;
  while (candidate && settleDates.length < windowSize) {
    if (candidate.getTime() > nowDate.getTime()) {
      break;
    }
    const formatted = formatDate(candidate);
    if (!settleDates.includes(formatted)) {
      settleDates.push(formatted);
    }
    candidate = nextSettleAfter(candidate);
    guard += 1;
    if (guard > 24) {
      break;
    }
  }

  const nextCursor = settleDates.length > 0 ? settleDates[settleDates.length - 1] : input.lastSettle ?? null;
  return { settleDates, ciks, nextCursor };
}

// ============================================================================
// FINRA OTC Transparency: Venue-level weekly data (ATS & non-ATS)
// ============================================================================

export interface FinraOtcWeeklyInput {
  symbols?: string[];
  weekEnd: string;
  source: OffExSource; // 'ATS' | 'NON_ATS'
}

export interface FinraOtcWeeklyResult {
  venueUpsertCount: number;
  symbolUpsertCount: number;
  fileId: string;
  sha256: string;
}

function extractProduct(row: NormalizedRow): string | null {
  const value = getField(
    row,
    'tieridentifier',
    'tier',
    'product',
    'nmstier',
    'securitytype'
  );
  return normalizeIdentifier(value);
}

function extractVenueId(row: NormalizedRow, source: OffExSource): string | null {
  if (source === 'ATS') {
    const value = getField(
      row,
      'atsmpid',
      'ats_mp_id',
      'mpid',
      'marketparticipantidentifier',
      'venueid'
    );
    return normalizeIdentifier(value);
  } else {
    // NON_ATS may have masked venue IDs for de minimis
    const value = getField(
      row,
      'mpid',
      'firmmpid',
      'reportingmemberid',
      'venueid'
    );
    return normalizeIdentifier(value);
  }
}

/**
 * Fetch and parse FINRA OTC Transparency weekly data (ATS or non-ATS)
 *
 * Downloads weekly off-exchange volume data from FINRA OTC Transparency program
 * and stores venue-level records with provenance (file id + hash)
 */
export async function fetchOtcWeeklyVenue(input: FinraOtcWeeklyInput): Promise<FinraOtcWeeklyResult> {
  const supabase = createSupabaseClient();
  const finra = getFinraClient();

  // Fetch dataset from FINRA
  // Note: FINRA OTC Transparency uses weeklySummary dataset
  // Filter by summaryTypeCode: ATS_W_SMBL for ATS, OTC_W_SMBL for OTC
  const summaryTypeCode = input.source === 'ATS' ? 'ATS_W_SMBL' : 'OTC_W_SMBL';
  const dataset = await finra.queryWeeklySummary({
    compareFilters: [
      {
        compareType: 'EQUAL',
        fieldName: 'weekStartDate',
        fieldValue: input.weekEnd,
      },
      {
        compareType: 'EQUAL',
        fieldName: 'summaryTypeCode',
        fieldValue: summaryTypeCode,
      },
    ],
  });

  // Generate file provenance
  const fileId = `FINRA_OTC_${input.source}_${input.weekEnd.replace(/-/g, '')}`;
  const dataStr = JSON.stringify(dataset);
  const sha256 = crypto.createHash('sha256').update(dataStr).digest('hex');

  const rows = normalizeRows(dataset);

  // Parse venue-level records
  const venueRecords: MicroOffExVenueWeeklyRecord[] = [];
  const symbolTotals = new Map<string, { ats: number; nonats: number; product: string | null }>();

  for (const row of rows) {
    const symbol = extractSymbol(row);
    if (!symbol) continue;

    // Filter by symbols if provided
    if (input.symbols && !input.symbols.includes(symbol)) continue;

    const product = extractProduct(row);
    const venueId = extractVenueId(row, input.source);
    const shares = extractAtsShares(row);
    const trades = extractAtsTrades(row);

    if (shares === null) continue;

    venueRecords.push({
      symbol,
      week_end: input.weekEnd,
      product,
      source: input.source,
      venue_id: venueId,
      total_shares: shares,
      total_trades: trades,
      finra_file_id: fileId,
      finra_sha256: sha256,
    });

    // Aggregate by symbol
    const key = symbol;
    const existing = symbolTotals.get(key);
    if (existing) {
      if (input.source === 'ATS') {
        existing.ats += shares;
      } else {
        existing.nonats += shares;
      }
    } else {
      symbolTotals.set(key, {
        ats: input.source === 'ATS' ? shares : 0,
        nonats: input.source === 'NON_ATS' ? shares : 0,
        product,
      });
    }
  }

  // Upsert venue-level records
  let venueUpsertCount = 0;
  if (venueRecords.length > 0) {
    const { error, count } = await (supabase
      .from('micro_offex_venue_weekly')
      .upsert(venueRecords, { onConflict: 'symbol,week_end,source,venue_id' }) as any)
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Failed to upsert venue weekly: ${error.message}`);
    }
    venueUpsertCount = count ?? venueRecords.length;
  }

  // Aggregate and upsert symbol-level records
  const symbolRecords: MicroOffExSymbolWeeklyRecord[] = Array.from(symbolTotals.entries()).map(
    ([symbol, totals]) => ({
      symbol,
      week_end: input.weekEnd,
      product: totals.product,
      ats_shares: totals.ats,
      nonats_shares: totals.nonats,
      finra_file_id: fileId,
      finra_sha256: sha256,
    })
  );

  let symbolUpsertCount = 0;
  if (symbolRecords.length > 0) {
    const { error, count } = await (supabase
      .from('micro_offex_symbol_weekly')
      .upsert(symbolRecords, { onConflict: 'symbol,week_end' }) as any)
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Failed to upsert symbol weekly: ${error.message}`);
    }
    symbolUpsertCount = count ?? symbolRecords.length;
  }

  return {
    venueUpsertCount,
    symbolUpsertCount,
    fileId,
    sha256,
  };
}

/**
 * Aggregate venue-level records to symbol-level weekly totals
 *
 * This can be run independently to recompute aggregates from venue records
 */
export async function aggregateOtcSymbolWeek(weekEnd: string, symbols?: string[]): Promise<number> {
  const supabase = createSupabaseClient();

  let query = supabase
    .from('micro_offex_venue_weekly')
    .select('symbol, source, total_shares, product, finra_file_id, finra_sha256')
    .eq('week_end', weekEnd);

  if (symbols) {
    query = query.in('symbol', symbols);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query venue weekly: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return 0;
  }

  const symbolTotals = new Map<string, { ats: number; nonats: number; product: string | null; fileId: string | null; sha256: string | null }>();

  for (const row of data) {
    const key = row.symbol;
    const existing = symbolTotals.get(key);
    const shares = row.total_shares ?? 0;

    if (existing) {
      if (row.source === 'ATS') {
        existing.ats += shares;
      } else {
        existing.nonats += shares;
      }
    } else {
      symbolTotals.set(key, {
        ats: row.source === 'ATS' ? shares : 0,
        nonats: row.source === 'NON_ATS' ? shares : 0,
        product: row.product,
        fileId: row.finra_file_id,
        sha256: row.finra_sha256,
      });
    }
  }

  const symbolRecords: MicroOffExSymbolWeeklyRecord[] = Array.from(symbolTotals.entries()).map(
    ([symbol, totals]) => ({
      symbol,
      week_end: weekEnd,
      product: totals.product,
      ats_shares: totals.ats,
      nonats_shares: totals.nonats,
      finra_file_id: totals.fileId,
      finra_sha256: totals.sha256,
    })
  );

  const { error: upsertError, count } = await (supabase
    .from('micro_offex_symbol_weekly')
    .upsert(symbolRecords, { onConflict: 'symbol,week_end' }) as any)
    .select('*', { count: 'exact', head: true });

  if (upsertError) {
    throw new Error(`Failed to upsert symbol weekly aggregates: ${upsertError.message}`);
  }

  return count ?? symbolRecords.length;
}
