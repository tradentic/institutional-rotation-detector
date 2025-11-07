import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase.js';
import { createSecClient } from '../lib/secClient.js';
import type { FilingRecord } from '../lib/schema.js';

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
      })
    )
    .optional(),
  facts: z.unknown().optional(),
});

export async function resolveCIK(ticker: string) {
  const client = createSecClient();
  const path = `/submissions/CIK${ticker}.json`;
  const response = await client.get(path);
  const json = await response.json();
  const parsed = companySubmissionsSchema.parse(json);
  const primarySecurity = parsed.securities?.find(
    (sec) => sec.ticker?.toUpperCase() === ticker.toUpperCase()
  );
  if (!primarySecurity?.cik) {
    throw new Error(`CIK not found for ${ticker}`);
  }

  const cusips = parsed.securities
    ?.map((sec) => sec.ticker)
    .filter((value): value is string => Boolean(value));

  return { cik: primarySecurity.cik, cusips: cusips ?? [] };
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
  const response = await client.get(`/submissions/CIK${cik}.json`);
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
    cik,
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
    await supabase.from('positions_13f').upsert(
      [
        {
          entity_id: uuid(),
          cusip: '000000000',
          asof: filing.period_end ?? filing.filed_date,
          shares: 0,
          opt_put_shares: 0,
          opt_call_shares: 0,
          accession: filing.accession,
        },
      ],
      { onConflict: 'entity_id,cusip,asof,accession' }
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
