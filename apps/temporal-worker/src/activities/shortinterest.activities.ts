import { createSupabaseClient } from '../lib/supabase.js';
import { createFinraClient } from '../lib/finraClient.js';

interface CalendarEntry {
  settlementDate: string;
  publicationDate: string;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function adjustToBusinessDay(date: Date, direction: 1 | -1): Date {
  const result = new Date(date.getTime());
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result.setUTCDate(result.getUTCDate() + direction);
  }
  return result;
}

function addBusinessDays(date: Date, days: number): Date {
  const direction = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  const result = new Date(date.getTime());
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) {
      remaining -= 1;
    }
  }
  return result;
}

export async function loadCalendar(year: number): Promise<CalendarEntry[]> {
  if (!Number.isFinite(year)) {
    throw new Error('Invalid year provided to loadCalendar');
  }
  const entries: CalendarEntry[] = [];
  for (let month = 0; month < 12; month += 1) {
    const first = adjustToBusinessDay(new Date(Date.UTC(year, month, 15)), -1);
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0));
    const second = adjustToBusinessDay(endOfMonth, -1);
    for (const settlement of [first, second]) {
      const publication = adjustToBusinessDay(addBusinessDays(settlement, 8), 1);
      entries.push({
        settlementDate: toIso(settlement),
        publicationDate: toIso(publication),
      });
    }
  }
  return entries;
}

function extractNumeric(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const cleaned = value.replace(/[,\s]/g, '');
      if (!cleaned) continue;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractText(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed.toUpperCase();
    }
  }
  return null;
}

export async function fetchShortInterest(params: {
  symbol: string;
  settlementDate: string;
  publicationDate?: string;
}): Promise<number> {
  const symbol = params.symbol.trim().toUpperCase();
  const client = createFinraClient();
  const rows = await client.fetchShortInterest(params.settlementDate);
  const matches = rows.filter((row) => {
    const normalized = extractText(
      row,
      'symbol',
      'issueSymbolIdentifier',
      'securitySymbol',
      'ticker',
      'issuesymbol'
    );
    return normalized === symbol;
  });
  if (matches.length === 0) {
    return 0;
  }
  let total = 0;
  for (const row of matches) {
    const shares = extractNumeric(
      row,
      'shortInterest',
      'currentShortInterest',
      'currentshortinterestquantity',
      'shortinterestqty',
      'short_interest'
    );
    if (shares !== null) {
      total += shares;
    }
  }
  const supabase = createSupabaseClient();
  const { error } = await supabase
    .from('micro_short_interest_points')
    .upsert(
      [
        {
          symbol,
          settlement_date: params.settlementDate,
          publication_date: params.publicationDate ?? null,
          short_interest: Math.round(total),
          source: 'FINRA',
          provenance: { dataset: 'FINRA_SHORT_INTEREST' },
        },
      ],
      { onConflict: 'symbol,settlement_date' }
    );
  if (error) {
    throw error;
  }
  return total;
}
