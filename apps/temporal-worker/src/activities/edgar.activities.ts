import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';
import type { FilingCadence, FilingRecord } from '../lib/schema';

const tickerSearchSchema = z.record(
  z.string(),
  z.object({
    cik_str: z.number(),
    ticker: z.string(),
    title: z.string(),
  })
);

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

function normalizeCusip(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (cleaned.length === 9) return cleaned;
  return null;
}

function normalizeName(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function addHyphenToAccession(accession: string): string {
  if (accession.length !== 18) return accession;
  return `${accession.slice(0, 10)}-${accession.slice(10, 12)}-${accession.slice(12)}`;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

type ExpectedDateSource = 'filed_date' | 'period_end' | 'event_date';

interface FilingFormRule {
  cadence: FilingCadence;
  expectedLagDays?: number;
  expectedBase?: ExpectedDateSource;
  isAmendment?: boolean;
}

const DEFAULT_FORM_RULE: FilingFormRule = {
  cadence: 'adhoc',
  expectedBase: 'filed_date',
};

const FILING_FORM_RULES: Record<string, FilingFormRule> = {
  '13F-HR': { cadence: 'quarterly', expectedLagDays: 45, expectedBase: 'period_end' },
  '13F-HR/A': { cadence: 'quarterly', expectedLagDays: 45, expectedBase: 'period_end', isAmendment: true },
  '13F-HR-A': { cadence: 'quarterly', expectedLagDays: 45, expectedBase: 'period_end', isAmendment: true },
  '13G': { cadence: 'annual', expectedLagDays: 45, expectedBase: 'period_end' },
  '13G-A': { cadence: 'annual', expectedLagDays: 45, expectedBase: 'period_end', isAmendment: true },
  '13G/A': { cadence: 'annual', expectedLagDays: 45, expectedBase: 'period_end', isAmendment: true },
  '13D': { cadence: 'event', expectedLagDays: 10, expectedBase: 'event_date' },
  '13D-A': { cadence: 'event', expectedLagDays: 10, expectedBase: 'event_date', isAmendment: true },
  '13D/A': { cadence: 'event', expectedLagDays: 10, expectedBase: 'event_date', isAmendment: true },
  '10-K': { cadence: 'annual', expectedLagDays: 60, expectedBase: 'period_end' },
  '10-K/A': { cadence: 'annual', expectedLagDays: 60, expectedBase: 'period_end', isAmendment: true },
  '10-Q': { cadence: 'quarterly', expectedLagDays: 45, expectedBase: 'period_end' },
  '10-Q/A': { cadence: 'quarterly', expectedLagDays: 45, expectedBase: 'period_end', isAmendment: true },
  '8-K': { cadence: 'event', expectedLagDays: 4, expectedBase: 'event_date' },
  '8-K/A': { cadence: 'event', expectedLagDays: 4, expectedBase: 'event_date', isAmendment: true },
};

function getFormRule(formType: string): FilingFormRule {
  const normalized = formType.toUpperCase();
  const override = FILING_FORM_RULES[normalized];
  if (override) {
    return { ...DEFAULT_FORM_RULE, ...override };
  }
  return DEFAULT_FORM_RULE;
}

function isAmendmentForm(formType: string): boolean {
  return /(?:\/-A|\/A|-A)$/.test(formType);
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function resolveExpectedPublishAt(
  rule: FilingFormRule,
  dates: { filedDate: string; periodEnd: string | null; eventDate: string | null }
): string | null {
  const baseSource = rule.expectedBase ?? DEFAULT_FORM_RULE.expectedBase!;
  const baseDate =
    baseSource === 'period_end'
      ? parseIsoDate(dates.periodEnd)
      : baseSource === 'event_date'
      ? parseIsoDate(dates.eventDate) ?? parseIsoDate(dates.periodEnd)
      : parseIsoDate(dates.filedDate);
  if (!baseDate) return null;
  const expected = rule.expectedLagDays ? addDays(baseDate, rule.expectedLagDays) : baseDate;
  return expected.toISOString();
}

export async function resolveCIK(ticker: string) {
  const tickerUpper = ticker.toUpperCase();
  const client = createSecClient();
  // Allow configuring the ticker lookup endpoint (default: /files/company_tickers.json)
  const tickerEndpoint = process.env.SEC_TICKER_ENDPOINT ?? '/files/company_tickers.json';
  const searchResponse = await client.get(tickerEndpoint);
  const searchJson = await searchResponse.json();
  const tickerData = tickerSearchSchema.parse(searchJson);

  // Find the matching ticker from the record
  const match = Object.values(tickerData).find((entry) => entry.ticker.toUpperCase() === tickerUpper);
  if (!match) {
    throw new Error(`CIK not found for ${ticker}`);
  }

  const cik = normalizeCik(match.cik_str.toString());

  // Get CUSIPs from database (populated by parsing 13G/13D filings)
  // The securities field in the SEC API only exists for 13F filers (institutional investors),
  // not for issuers (companies like AAPL, TSLA). This workflow is designed to track
  // institutional rotation IN issuers, so we need to get CUSIPs from the database
  // where they're extracted from 13G/13D filings ABOUT the issuer.
  const supabase = createSupabaseClient();
  const { data: cusipRows, error: cusipError } = await supabase
    .from('cusip_issuer_map')
    .select('cusip')
    .eq('issuer_cik', cik);

  if (cusipError) {
    console.error(`Error fetching CUSIPs for ${ticker} (${cik}):`, cusipError);
    throw cusipError;
  }

  const cusips = (cusipRows ?? [])
    .map((row: any) => row.cusip)
    .filter(Boolean);

  // Note: CUSIPs may be empty on first run - they get populated by parse13G13D
  // activity when 13G/13D filings are processed in fetchFilings
  return { cik, cusips };
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

  const records: FilingRecord[] = filtered.map((filing) => {
    const accession = filing.accessionNumber.replace(/-/g, '');
    const formRule = getFormRule(filing.formType);
    const periodEnd = filing.reportDate ?? null;
    const reportedEventDate = filing.reportDate ?? null;
    const acceptanceDate = filing.acceptanceDateTime ?? null;
    const eventDate = reportedEventDate ?? acceptanceDate?.slice(0, 10) ?? null;
    const publishedAt = parseIsoDate(acceptanceDate) ?? parseIsoDate(filing.filingDate);
    const expectedPublishAt = resolveExpectedPublishAt(formRule, {
      filedDate: filing.filingDate,
      periodEnd,
      eventDate,
    });
    const isAmendment = formRule.isAmendment ?? isAmendmentForm(filing.formType);
    return {
      accession,
      cik: normalizedCik,
      form: filing.formType,
      filed_date: filing.filingDate,
      period_end: periodEnd,
      event_date: eventDate,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${filing.primaryDocument}`,
      cadence: formRule.cadence,
      expected_publish_at: expectedPublishAt,
      published_at: publishedAt?.toISOString() ?? null,
      is_amendment: isAmendment,
      amendment_of_accession: null,
    } satisfies FilingRecord;
  });

  const supabase = createSupabaseClient();

  // Link amendments to their original filings
  // For each amendment, try to find the original filing it amends
  for (const record of records) {
    if (record.is_amendment && record.amendment_of_accession === null) {
      // Find the original filing by matching:
      // - Same CIK
      // - Same period_end (for periodic reports) or event_date (for 8-K)
      // - Base form type (without /A suffix)
      const baseForm = record.form.replace(/\/A$|\/A-$/i, '');

      const { data: originals, error } = await supabase
        .from('filings')
        .select('accession, filed_date')
        .eq('cik', record.cik)
        .eq('form', baseForm)
        .eq('is_amendment', false)
        .order('filed_date', { ascending: false })
        .limit(10);

      if (!error && originals && originals.length > 0) {
        // Match by period_end or event_date
        const matchingOriginal = originals.find((orig: any) => {
          // For now, use simple filed_date proximity (within 90 days before amendment)
          // A more sophisticated approach would parse the amendment text
          const origDate = new Date(orig.filed_date);
          const amendDate = new Date(record.filed_date);
          const daysDiff = (amendDate.getTime() - origDate.getTime()) / (1000 * 60 * 60 * 24);
          return daysDiff > 0 && daysDiff <= 90;
        });

        if (matchingOriginal) {
          record.amendment_of_accession = matchingOriginal.accession;
        }
      }
    }
  }

  await supabase.from('filings').upsert(records, { onConflict: 'accession' });
  return records;
}

export async function parse13FInfoTables(accessions: FilingRecord[]) {
  const supabase = createSupabaseClient();
  const sec = createSecClient();
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
  });
  const entityCache = new Map<string, string>();
  const issuerNameCache = new Map<string, string | null>();
  const cusipIssuerCache = new Map<string, string>();

  const getEntityId = async (cik: string): Promise<string> => {
    const cached = entityCache.get(cik);
    if (cached) return cached;
    const { data, error } = await supabase
      .from('entities')
      .select('entity_id,kind')
      .eq('cik', cik)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.entity_id) {
      throw new Error(`Entity not found for CIK ${cik}`);
    }
    entityCache.set(cik, data.entity_id);
    return data.entity_id;
  };

  const resolveIssuerCikByName = async (name: string): Promise<string | null> => {
    const normalized = normalizeName(name);
    const cached = issuerNameCache.get(normalized);
    if (cached !== undefined) {
      return cached;
    }
    const sanitized = name.replace(/[’']/g, '').replace(/[%_]/g, '').trim();
    if (!sanitized) {
      issuerNameCache.set(normalized, null);
      return null;
    }
    const pattern = sanitized
      .split(/\s+/)
      .filter(Boolean)
      .join('%');
    const { data, error } = await supabase
      .from('entities')
      .select('cik,name')
      .eq('kind', 'issuer')
      .ilike('name', `%${pattern}%`)
      .limit(1);
    if (error) throw error;
    const cik = data?.[0]?.cik ?? null;
    issuerNameCache.set(normalized, cik);
    return cik;
  };

  const loadExistingCusipMappings = async (cusips: string[]) => {
    const unknown = cusips.filter((cusip) => !cusipIssuerCache.has(cusip));
    if (unknown.length > 0) {
      const { data, error } = await supabase
        .from('cusip_issuer_map')
        .select('cusip,issuer_cik')
        .in('cusip', unknown);
      if (error) throw error;
      for (const row of data ?? []) {
        if (row.issuer_cik) {
          cusipIssuerCache.set(row.cusip, row.issuer_cik);
        }
      }
      for (const cusip of unknown) {
        if (!cusipIssuerCache.has(cusip)) {
          cusipIssuerCache.set(cusip, '');
        }
      }
    }
  };

  for (const filing of accessions) {
    const asof = filing.period_end ?? filing.filed_date;
    const entityId = await getEntityId(filing.cik);
    const accessionWithHyphen = addHyphenToAccession(filing.accession);
    const baseNumber = Number(filing.cik);
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${baseNumber}/${filing.accession}/${accessionWithHyphen}-index.html`;

    const indexHtmlResponse = await sec.get(indexUrl);
    const indexHtml = await indexHtmlResponse.text();
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    let infoHref: string | null = null;
    const rows = indexHtml.match(rowRegex) ?? [];
    for (const row of rows) {
      if (/INFORMATION TABLE/i.test(row) && /\.xml/i.test(row)) {
        const hrefMatch = row.match(/href="([^"]+)"/i);
        if (hrefMatch) {
          infoHref = hrefMatch[1];
          break;
        }
      }
    }
    if (!infoHref) {
      throw new Error(`InfoTable not found for accession ${filing.accession}`);
    }
    const infoUrl = new URL(infoHref, 'https://www.sec.gov').toString();
    const xmlResponse = await sec.get(infoUrl);
    const xml = await xmlResponse.text();
    const parsed = xmlParser.parse(xml);
    const tables = toArray(parsed?.informationTable?.infoTable ?? parsed?.edgarSubmission?.formData?.informationTable?.infoTable);
    if (tables.length === 0) {
      continue;
    }

    const aggregated = new Map<string, { shares: number; put: number; call: number; issuerName: string | null }>();
    for (const table of tables as any[]) {
      const cusip = normalizeCusip(table.cusip);
      if (!cusip) continue;
      const issuerName = typeof table.nameOfIssuer === 'string' ? table.nameOfIssuer : null;
      const amountRaw = table?.shrsOrPrnAmt?.sshPrnamt ?? table?.sshPrnamt ?? table?.shares;
      const amount = Number(String(amountRaw ?? '0').replace(/[,\s]/g, ''));
      if (!Number.isFinite(amount)) continue;
      const putCall = String(table.putCall ?? '').trim().toUpperCase();
      const current = aggregated.get(cusip) ?? { shares: 0, put: 0, call: 0, issuerName: issuerName };
      const issuerLabel = current.issuerName || issuerName || null;
      if (putCall === 'PUT') {
        current.put += amount;
      } else if (putCall === 'CALL') {
        current.call += amount;
      } else {
        current.shares += amount;
      }
      current.issuerName = issuerLabel;
      aggregated.set(cusip, current);
    }
    if (aggregated.size === 0) {
      continue;
    }

    const positions = Array.from(aggregated.entries()).map(([cusip, totals]) => ({
      entity_id: entityId,
      cusip,
      asof,
      shares: Math.round(totals.shares),
      opt_put_shares: Math.round(totals.put),
      opt_call_shares: Math.round(totals.call),
      accession: filing.accession,
    }));

    const { error: upsertError } = await supabase
      .from('positions_13f')
      .upsert(positions, { onConflict: 'entity_id,cusip,asof,accession' });
    if (upsertError) throw upsertError;

    const cusips = positions.map((position) => position.cusip);
    await loadExistingCusipMappings(cusips);
    const mappings: { cusip: string; issuer_cik: string }[] = [];
    for (const [cusip, totals] of aggregated.entries()) {
      let issuerCik = cusipIssuerCache.get(cusip) || null;
      if (!issuerCik || issuerCik.length === 0) {
        if (totals.issuerName) {
          issuerCik = await resolveIssuerCikByName(totals.issuerName);
        }
      }
      if (issuerCik && issuerCik.length > 0) {
        mappings.push({ cusip, issuer_cik: issuerCik });
        cusipIssuerCache.set(cusip, issuerCik);
      }
    }
    if (mappings.length > 0) {
      const { error: mapError } = await supabase
        .from('cusip_issuer_map')
        .upsert(mappings, { onConflict: 'cusip' });
      if (mapError) throw mapError;
    }
  }
  return accessions.length;
}

export async function parse13G13D(accessions: FilingRecord[]) {
  const supabase = createSupabaseClient();
  const sec = createSecClient();
  const cusipIssuerCache = new Map<string, string>();

  const matchGroup = (text: string, regex: RegExp): string | null => {
    const match = regex.exec(text);
    return match && match[1] ? match[1].trim() : null;
  };

  const parseDate = (value: string | null): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  };

  for (const filing of accessions) {
    const accessionWithHyphen = addHyphenToAccession(filing.accession);
    const baseNumber = Number(filing.cik);
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${baseNumber}/${filing.accession}/${accessionWithHyphen}-index.html`;

    const indexHtmlResponse = await sec.get(indexUrl);
    const indexHtml = await indexHtmlResponse.text();
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    let textHref: string | null = null;
    const rows = indexHtml.match(rowRegex) ?? [];
    for (const row of rows) {
      if (/complete submission text file/i.test(row) || /\.txt/i.test(row)) {
        const hrefMatch = row.match(/href="([^"]+)"/i);
        if (hrefMatch && /\.txt$/i.test(hrefMatch[1])) {
          textHref = hrefMatch[1];
          break;
        }
      }
    }
    if (!textHref) {
      throw new Error(`Submission text file not found for accession ${filing.accession}`);
    }
    const textUrl = new URL(textHref, 'https://www.sec.gov').toString();
    const textResponse = await sec.get(textUrl);
    const rawText = await textResponse.text();
    const plainText = rawText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');

    const issuerCik = normalizeCik(
      matchGroup(rawText, /SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*([0-9]+)/i) ?? filing.cik
    );
    const holderCik = matchGroup(rawText, /FILED BY:[\s\S]*?CENTRAL INDEX KEY:\s*([0-9]+)/i);
    if (!holderCik) {
      throw new Error(`Holder CIK missing in accession ${filing.accession}`);
    }
    const normalizedHolderCik = normalizeCik(holderCik);
    const eventDateStr =
      matchGroup(
        plainText,
        /Date of Event Which Requires Filing of this Statement\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
      ) ?? filing.event_date ?? filing.filed_date;
    const eventDate = parseDate(eventDateStr) ?? filing.event_date ?? filing.filed_date;
    const sharesStr = matchGroup(
      plainText,
      /AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON\s+([0-9,]+)/i
    );
    const shares = sharesStr ? Number(sharesStr.replace(/[,\s]/g, '')) : null;
    const pctStr = matchGroup(
      plainText,
      /PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW\s+\d+\s+([0-9.]+)/i
    );
    const pct = pctStr ? Number(pctStr) : null;
    const cusip = normalizeCusip(
      matchGroup(plainText, /CUSIP (?:NUMBER|No\.)\s*([0-9A-Za-z]+)/i) ??
        matchGroup(plainText, /CUSIP\s+No\.\s*([0-9A-Za-z]+)/i)
    );

    const { error: upsertError } = await supabase
      .from('bo_snapshots')
      .upsert(
        [
          {
            issuer_cik: issuerCik,
            holder_cik: normalizedHolderCik,
            event_date: eventDate,
            filed_date: filing.filed_date,
            pct_of_class: pct ?? null,
            shares_est: shares ?? null,
            accession: filing.accession,
          },
        ],
        { onConflict: 'issuer_cik,holder_cik,event_date,accession' }
      );
    if (upsertError) throw upsertError;

    if (cusip && !cusipIssuerCache.has(cusip)) {
      const { error: mapError } = await supabase
        .from('cusip_issuer_map')
        .upsert([{ cusip, issuer_cik: issuerCik }], { onConflict: 'cusip' });
      if (mapError) throw mapError;
      cusipIssuerCache.set(cusip, issuerCik);
    }
  }
  return accessions.length;
}

export interface EdgarSubmissionWindowInput {
  windowStart: string;
  windowEnd: string;
  forms: string[];
  batchSize: number;
}

export interface EdgarSubmissionWindowResult {
  nextCursor: string;
  processed: number;
  accessions: string[];
}

function normalizeIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date.toISOString();
}

export async function recordEdgarSubmissionWindow(
  input: EdgarSubmissionWindowInput
): Promise<EdgarSubmissionWindowResult> {
  const supabase = createSupabaseClient();
  const windowStart = normalizeIsoDate(input.windowStart);
  const windowEnd = normalizeIsoDate(input.windowEnd);

  if (input.forms.length === 0) {
    return { nextCursor: windowEnd, processed: 0, accessions: [] };
  }

  const query = supabase
    .from('filings')
    .select('accession,filed_date', { head: false })
    .in('form', input.forms)
    .gte('filed_date', windowStart)
    .lte('filed_date', windowEnd)
    .order('filed_date', { ascending: true })
    .limit(input.batchSize);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = (data as { accession: string; filed_date: string }[] | null) ?? [];
  const processed = rows.length;
  const nextCursor = processed > 0 ? new Date(rows[processed - 1]!.filed_date).toISOString() : windowEnd;
  const accessions = rows.map((row) => row.accession);

  return { nextCursor, processed, accessions };
}
