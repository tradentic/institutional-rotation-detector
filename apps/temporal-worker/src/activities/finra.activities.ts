import { createSupabaseClient } from '../lib/supabase.js';
import { createFinraClient, FinraClient, type NormalizedRow } from '../lib/finraClient.js';

let cachedClient: FinraClient | null = null;

function getFinraClient(): FinraClient {
  if (!cachedClient) {
    cachedClient = createFinraClient();
  }
  return cachedClient;
}

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
    'issuesymbolidentifier',
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
  if (cusips.size === 0) {
    throw new Error(`No CUSIP mappings found for CIK ${cik}`);
  }
  return cusips;
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

export async function fetchShortInterest(cik: string, settleDates: string[]): Promise<number> {
  const supabase = createSupabaseClient();
  const finra = getFinraClient();
  const cusips = await loadCusips(supabase, cik);
  let upserts = 0;
  for (const date of settleDates) {
    const dataset = await finra.fetchShortInterest(date);
    const rows = normalizeRows(dataset);
    const relevant: number[] = [];
    for (const row of rows) {
      const cusip = extractCusip(row) ?? extractSymbol(row);
      if (!cusip || !cusips.has(cusip)) continue;
      const shares = extractShortShares(row);
      if (shares === null) {
        throw new Error(`Missing short interest value for CUSIP ${cusip} on ${date}`);
      }
      relevant.push(shares);
    }
    if (relevant.length === 0) {
      throw new Error(`No FINRA short interest rows matched CIK ${cik} for ${date}`);
    }
    const totalShares = relevant.reduce((acc, value) => acc + value, 0);
    if (!Number.isFinite(totalShares) || totalShares < 0) {
      throw new Error(`Invalid short interest total for ${cik} on ${date}`);
    }
    const upsert = await supabase
      .from('short_interest')
      .upsert(
        [
          {
            settle_date: date,
            cik,
            short_shares: Math.round(totalShares),
          },
        ],
        { onConflict: 'settle_date,cik' }
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
  weeks: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  const finra = getFinraClient();
  const cusips = await loadCusips(supabase, cik);
  let upserts = 0;
  for (const week of weeks) {
    const dataset = await finra.fetchATSWeekly(week);
    const rows = normalizeRows(dataset);
    const venueTotals = new Map<string, { shares: number; trades: number | null }>();
    for (const row of rows) {
      const cusip = extractCusip(row) ?? extractSymbol(row);
      if (!cusip || !cusips.has(cusip)) continue;
      const shares = extractAtsShares(row);
      if (shares === null) {
        throw new Error(`Missing ATS share quantity for ${cusip} on week ${week}`);
      }
      const trades = extractAtsTrades(row);
      const venue = extractVenue(row);
      const entry = venueTotals.get(venue);
      if (entry) {
        entry.shares += shares;
        if (trades !== null) {
          entry.trades = (entry.trades ?? 0) + trades;
        }
      } else {
        venueTotals.set(venue, { shares, trades });
      }
    }
    if (venueTotals.size === 0) {
      throw new Error(`No ATS weekly rows matched CIK ${cik} for week ending ${week}`);
    }
    const payload = Array.from(venueTotals.entries()).map(([venue, totals]) => ({
      week_end: week,
      cik,
      venue,
      shares: Math.round(totals.shares),
      trades:
        totals.trades === null || totals.trades === undefined
          ? null
          : Math.round(totals.trades),
    }));
    const upsert = await supabase
      .from('ats_weekly')
      .upsert(payload, { onConflict: 'week_end,cik,venue' })
      .select('week_end');
    if (upsert.error) {
      throw upsert.error;
    }
    upserts += payload.length;
  }
  return upserts;
}
