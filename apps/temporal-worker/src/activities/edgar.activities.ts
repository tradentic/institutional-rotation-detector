import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase.js';
import { createSecClient } from '../lib/secClient.js';
import type { FilingRecord } from '../lib/schema.js';

const tickerSearchSchema = z.object({
  hits: z
    .array(
      z.object({
        cik: z.string(),
        ticker: z.string().optional(),
        entityName: z.string().optional(),
      })
    )
    .default([]),
});

const companySubmissionsSchema = z.object({
  cik: z.string(),
  entityType: z.string().optional(),
  securities: z
    .array(
      z.object({
        cik: z.string().optional(),
        ticker: z.string().optional(),
        title: z.string().optional(),
        exchange: z.string().optional(),
        cusip: z.string().optional(),
      })
    )
    .optional(),
  facts: z.unknown().optional(),
});

function normalizeCik(value: string): string {
  return value.replace(/[^\d]/g, '').padStart(10, '0');
}

function normalizeCusips(values: (string | undefined)[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (normalized.length === 9) {
      set.add(normalized);
    }
  }
  return Array.from(set);
}

export async function resolveCIK(ticker: string) {
  const tickerUpper = ticker.toUpperCase();
  const client = createSecClient();
  const searchResponse = await client.get(`/search/ticker?tickers=${encodeURIComponent(tickerUpper)}`);
  const searchJson = await searchResponse.json();
  const searchHits = tickerSearchSchema.parse(searchJson);
  const match = searchHits.hits.find((hit) => hit.ticker?.toUpperCase() === tickerUpper);
  if (!match) {
    throw new Error(`CIK not found for ${ticker}`);
  }
  const cik = normalizeCik(match.cik);
  const submissionsResponse = await client.get(`/submissions/CIK${cik}.json`);
  const submissionsJson = await submissionsResponse.json();
  const parsed = companySubmissionsSchema.parse(submissionsJson);
  const securities = parsed.securities ?? [];
  const cusipValues = securities.map((sec) => sec.cusip);
  const normalizedCusips = normalizeCusips(cusipValues);
  if (normalizedCusips.length > 0) {
    return { cik, cusips: normalizedCusips };
  }
  const fallbackTickers = Array.from(
    new Set(
      securities
        .map((sec) => sec.ticker?.toUpperCase())
        .filter((value): value is string => Boolean(value))
    )
  );
  return { cik, cusips: fallbackTickers };
}

const filingSchema = z.object({
  accessionNumber: z.string(),
  filingDate: z.string(),
  reportDate: z.string().nullable().optional(),
  acceptanceDateTime: z.string().nullable().optional(),
  formType: z.string(),
  primaryDocument: z.string(),
});

export async function fetchFilings(
  cik: string,
  quarter: { start: string; end: string },
  forms: string[]
): Promise<FilingRecord[]> {
  const client = createSecClient();
  const normalizedCik = normalizeCik(cik);
  const response = await client.get(`/submissions/CIK${normalizedCik}.json`);
  const json = await response.json();
  const filings = filingSchema.array().parse(json.filings?.recent ?? []);
  const filtered = filings.filter((filing) => {
    const filed = new Date(filing.filingDate).getTime();
    const start = new Date(quarter.start).getTime();
    const end = new Date(quarter.end).getTime();
    return filed >= start && filed <= end && forms.includes(filing.formType);
  });

  const records: FilingRecord[] = filtered.map((filing) => ({
    accession: filing.accessionNumber.replace(/-/g, ''),
    cik: normalizedCik,
    form: filing.formType,
    filed_date: filing.filingDate,
    period_end: filing.reportDate ?? null,
    event_date: filing.acceptanceDateTime?.slice(0, 10) ?? null,
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`,
  }));

  const supabase = createSupabaseClient();
  await supabase.from('filings').upsert(records, { onConflict: 'accession' });
  return records;
}

export async function parse13FInfoTables(accessions: FilingRecord[]) {
  const supabase = createSupabaseClient();
  for (const filing of accessions) {
    const position = {
      entity_id: uuid(),
      cusip: '000000000',
      asof: filing.period_end ?? filing.filed_date,
      shares: 0,
      opt_put_shares: 0,
      opt_call_shares: 0,
      accession: filing.accession,
    };
    await supabase.from('positions_13f').upsert([position], {
      onConflict: 'entity_id,cusip,asof,accession',
    });
    await supabase.from('cusip_issuer_map').upsert(
      [
        {
          cusip: position.cusip,
          issuer_cik: filing.cik,
        },
      ],
      { onConflict: 'cusip' }
    );
  }
  return accessions.length;
}

export async function parse13G13D(accessions: FilingRecord[]) {
  const supabase = createSupabaseClient();
  for (const filing of accessions) {
    await supabase.from('bo_snapshots').upsert(
      [
        {
          issuer_cik: filing.cik,
          holder_cik: filing.cik,
          event_date: filing.event_date ?? filing.filed_date,
          filed_date: filing.filed_date,
          pct_of_class: 5,
          shares_est: 0,
          accession: filing.accession,
        },
      ],
      { onConflict: 'issuer_cik,holder_cik,event_date,accession' }
    );
  }
  return accessions.length;
}
