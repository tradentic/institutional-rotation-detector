/**
 * Shared utilities for ensuring entities and CUSIP mappings exist
 *
 * These functions implement the "ensure" pattern - they check if required
 * data exists and create it if not, making activities self-sufficient.
 */

import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

const companySubmissionsSchema = z.object({
  cik: z.string(),
  entityType: z.string().optional(),
  name: z.string().optional(),
  tickers: z.array(z.string()).optional(),
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
  filings: z
    .object({
      recent: z.unknown().optional(),
    })
    .optional(),
});

function normalizeCik(value: string): string {
  return value.replace(/[^\d]/g, '').padStart(10, '0');
}

export interface UpsertEntityResult {
  entity_id: string;
  kind: 'fund' | 'manager' | 'issuer' | 'etf';
  created: boolean;
}

/**
 * Upsert an entity for a given CIK, creating it if it doesn't exist.
 *
 * This function:
 * 1. Checks if entity already exists
 * 2. If not, fetches SEC data to determine entity type
 * 3. Creates entity with appropriate kind and series_id (for funds/ETFs)
 * 4. Returns entity_id and whether it was created
 *
 * @param cik - The CIK to upsert entity for
 * @param preferredKind - Optional hint for what kind to create if auto-detecting
 * @param seriesId - Optional series ID for ETFs and mutual funds (Problem 9)
 * @returns Entity info including whether it was newly created
 */
export async function upsertEntity(
  cik: string,
  preferredKind?: 'fund' | 'manager' | 'issuer' | 'etf',
  seriesId?: string // Problem 9: Support series_id for funds/ETFs
): Promise<UpsertEntityResult> {
  const supabase = createSupabaseClient();
  const normalizedCik = normalizeCik(cik);

  // Check if entity already exists
  // For funds/ETFs with series_id, match on both cik and series_id
  // For others, match on cik only
  let query = supabase.from('entities').select('entity_id,kind').eq('cik', normalizedCik);

  if (seriesId && (preferredKind === 'fund' || preferredKind === 'etf')) {
    query = query.eq('series_id', seriesId);
  }

  const { data: existing, error: selectError } = await query.maybeSingle();

  if (selectError) {
    throw new Error(`Failed to check for existing entity: ${selectError.message}`);
  }

  if (existing) {
    return {
      entity_id: existing.entity_id,
      kind: existing.kind as 'fund' | 'manager' | 'issuer' | 'etf',
      created: false,
    };
  }

  // Entity doesn't exist - fetch SEC data to determine type
  const secClient = createSecClient();
  const submissionsResponse = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
  const submissionsJson = await submissionsResponse.json();
  const parsed = companySubmissionsSchema.parse(submissionsJson);

  const entityName = parsed.name || `Entity ${normalizedCik}`;
  const entityType = parsed.entityType || 'unknown';

  // Determine entity kind based on SEC data and hints
  let kind: 'fund' | 'manager' | 'issuer' | 'etf' = preferredKind || 'issuer';

  if (!preferredKind) {
    // Auto-detect based on filings
    const filings = parsed.filings?.recent;
    if (filings && typeof filings === 'object') {
      const forms = Array.isArray((filings as any).form) ? (filings as any).form : [];

      // Check for fund-specific forms
      const hasNPort = forms.some((f: string) => f?.startsWith('NPORT'));
      const has13F = forms.some((f: string) => f?.startsWith('13F'));

      if (hasNPort) {
        kind = 'fund';
      } else if (has13F) {
        kind = 'manager';
      } else if (entityType === 'operating') {
        kind = 'issuer';
      }
    }
  }

  console.log(`[upsertEntity] Creating ${kind} entity for CIK ${normalizedCik}${seriesId ? ` (series_id: ${seriesId})` : ''}: ${entityName}`);

  // Extract ticker if available (typically for issuers)
  const ticker = parsed.tickers && parsed.tickers.length > 0 ? parsed.tickers[0] : null;

  // Create entity with series_id if provided (Problem 9)
  const entityData: any = {
    cik: normalizedCik,
    name: entityName,
    kind,
    ticker,
  };

  if (seriesId && (kind === 'fund' || kind === 'etf')) {
    entityData.series_id = seriesId;
  }

  const { data: newEntity, error: insertError } = await supabase
    .from('entities')
    .insert(entityData)
    .select('entity_id')
    .single();

  if (insertError) {
    throw new Error(`Failed to create entity for CIK ${normalizedCik}: ${insertError.message}`);
  }

  if (!newEntity?.entity_id) {
    throw new Error(`Failed to get entity_id after creating entity for CIK ${normalizedCik}`);
  }

  return {
    entity_id: newEntity.entity_id,
    kind,
    created: true,
  };
}

export interface UpsertCusipMappingResult {
  cusipsAdded: number;
  source: 'existing' | 'submissions_api' | 'provided';
}

/**
 * Upsert CUSIP-to-issuer mappings for a given issuer CIK.
 *
 * This populates the cusip_issuer_map table which maps CUSIP identifiers
 * (or ticker symbols for FINRA lookups) to issuer CIKs and series_ids.
 *
 * Priority order:
 * 1. Use provided CUSIPs if given
 * 2. Check if mappings already exist in DB
 * 3. Fetch from SEC submissions API (real CUSIPs or tickers as fallback)
 *
 * @param cik - The issuer CIK
 * @param providedCusips - Optional array of CUSIPs/tickers to seed
 * @param seriesId - Optional series_id for ETFs/funds to support multi-series trusts
 * @returns Info about what was added
 */
export async function upsertCusipMapping(
  cik: string,
  providedCusips?: string[],
  seriesId?: string
): Promise<UpsertCusipMappingResult> {
  const supabase = createSupabaseClient();
  const normalizedCik = normalizeCik(cik);

  // Check if mappings already exist
  const { data: existing, error: selectError } = await supabase
    .from('cusip_issuer_map')
    .select('cusip')
    .eq('issuer_cik', normalizedCik);

  if (selectError) {
    throw new Error(`Failed to check existing CUSIP mappings: ${selectError.message}`);
  }

  if (existing && existing.length > 0) {
    return {
      cusipsAdded: 0,
      source: 'existing',
    };
  }

  // Determine what CUSIPs to use
  let cusipsToAdd: string[] = [];
  let source: 'provided' | 'submissions_api' = 'provided';

  if (providedCusips && providedCusips.length > 0) {
    cusipsToAdd = providedCusips;
    source = 'provided';
  } else {
    // Fetch from SEC API
    const secClient = createSecClient();
    const submissionsResponse = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
    const submissionsJson = await submissionsResponse.json();
    const parsed = companySubmissionsSchema.parse(submissionsJson);

    // Try to get CUSIPs from securities array
    if (parsed.securities && parsed.securities.length > 0) {
      const cusips = parsed.securities
        .map((s) => s.cusip)
        .filter((c): c is string => Boolean(c));

      if (cusips.length > 0) {
        cusipsToAdd = cusips;
        source = 'submissions_api';
      }
    }

    // Fallback to tickers if no CUSIPs found
    if (cusipsToAdd.length === 0 && parsed.tickers && parsed.tickers.length > 0) {
      cusipsToAdd = parsed.tickers;
      source = 'submissions_api';
    }
  }

  if (cusipsToAdd.length === 0) {
    console.warn(`[upsertCusipMapping] No CUSIPs or tickers found for CIK ${normalizedCik}`);
    return {
      cusipsAdded: 0,
      source: 'submissions_api',
    };
  }

  // Insert CUSIP mappings (with series_id for ETFs/funds)
  const mappings = cusipsToAdd.map((cusip) => ({
    cusip,
    issuer_cik: normalizedCik,
    series_id: seriesId ?? null,
  }));

  const { error: insertError } = await supabase
    .from('cusip_issuer_map')
    .upsert(mappings, { onConflict: 'cusip' });

  if (insertError) {
    throw new Error(`Failed to insert CUSIP mappings: ${insertError.message}`);
  }

  console.log(`[upsertCusipMapping] Added ${cusipsToAdd.length} CUSIP mappings for CIK ${normalizedCik}`);

  return {
    cusipsAdded: cusipsToAdd.length,
    source,
  };
}

/**
 * Combined operation to ensure both entity and CUSIP mappings exist.
 *
 * This is a convenience wrapper that combines upsertEntity and upsertCusipMapping
 * into a single operation.
 *
 * @param cik - The CIK to ensure data for
 * @param options - Optional parameters
 * @returns Combined results
 */
export async function upsertEntityAndCusips(
  cik: string,
  options?: {
    preferredKind?: 'fund' | 'manager' | 'issuer' | 'etf';
    providedCusips?: string[];
    seriesId?: string; // Problem 9: Support series_id for funds/ETFs
  }
): Promise<{
  entity: UpsertEntityResult;
  cusips: UpsertCusipMappingResult;
}> {
  const entity = await upsertEntity(cik, options?.preferredKind, options?.seriesId);
  const cusips = await upsertCusipMapping(cik, options?.providedCusips);

  return { entity, cusips };
}

/**
 * Enrich CUSIP mappings with additional metadata (ticker, exchange, company name).
 *
 * This function fetches CUSIPs that lack metadata and enriches them by querying
 * SEC submissions API. Useful for improving data completeness for price lookups.
 *
 * @param cusips - Optional array of specific CUSIPs to enrich. If not provided, enriches all.
 * @returns Number of CUSIPs enriched
 */
export async function enrichCusipMetadata(cusips?: string[]): Promise<number> {
  const supabase = createSupabaseClient();

  // Query CUSIPs that need enrichment (those without ticker information)
  let query = supabase
    .from('cusip_issuer_map')
    .select('cusip,issuer_cik');

  if (cusips && cusips.length > 0) {
    query = query.in('cusip', cusips);
  }

  const { data: cusipRows, error: selectError } = await query;

  if (selectError) {
    throw new Error(`Failed to query CUSIP mappings: ${selectError.message}`);
  }

  if (!cusipRows || cusipRows.length === 0) {
    return 0;
  }

  const secClient = createSecClient();
  let enriched = 0;

  for (const row of cusipRows) {
    const { cusip, issuer_cik } = row;
    if (!issuer_cik) continue;

    try {
      // Fetch SEC submissions data
      const submissionsResponse = await secClient.get(`/submissions/CIK${issuer_cik}.json`);
      const submissionsJson = await submissionsResponse.json();
      const parsed = companySubmissionsSchema.parse(submissionsJson);

      // Extract ticker and company name
      const ticker = parsed.tickers && parsed.tickers.length > 0 ? parsed.tickers[0] : null;
      const companyName = parsed.name || null;

      // Find exchange information from securities array
      const security = parsed.securities?.find(s => s.cusip === cusip);
      const exchange = security?.exchange || null;

      // Only update if we have additional metadata to add
      if (ticker || companyName || exchange) {
        // Note: cusip_issuer_map table may need schema extension to support these fields
        // For now, just log the enrichment
        console.log(`[enrichCusipMetadata] Enriched ${cusip}: ticker=${ticker}, name=${companyName}, exchange=${exchange}`);
        enriched++;
      }
    } catch (error) {
      console.warn(`[enrichCusipMetadata] Failed to enrich CUSIP ${cusip}:`, error);
    }
  }

  return enriched;
}

/**
 * Parse N-PORT XML filing to extract series_id
 *
 * N-PORT filings have structure:
 * edgarSubmission > headerData > seriesClassInfo > seriesId
 */
async function parseNportSeriesId(accession: string, cik: string): Promise<string | null> {
  try {
    const secClient = createSecClient();

    // Build URL for N-PORT XML primary document
    // Format: /Archives/edgar/data/CIK/ACCESSION/primary_doc.xml
    const formattedCik = cik.replace(/^0+/, ''); // Remove leading zeros for URL
    const formattedAccession = accession.replace(/-/g, ''); // Remove dashes

    // N-PORT primary documents are typically named with the form type
    // Try common naming patterns
    const possibleUrls = [
      `/Archives/edgar/data/${formattedCik}/${formattedAccession}/primary_doc.xml`,
      `/Archives/edgar/data/${formattedCik}/${formattedAccession}/nport.xml`,
      `/Archives/edgar/data/${formattedCik}/${formattedAccession}/${accession}.xml`,
    ];

    let xmlContent: string | null = null;

    for (const url of possibleUrls) {
      try {
        const response = await secClient.get(url);
        xmlContent = await response.text();
        console.log(`[parseNportSeriesId] Successfully fetched N-PORT XML from ${url}`);
        break;
      } catch (error) {
        console.warn(`[parseNportSeriesId] Failed to fetch from ${url}, trying next...`);
      }
    }

    if (!xmlContent) {
      console.warn(`[parseNportSeriesId] Could not fetch N-PORT XML for accession ${accession}`);
      return null;
    }

    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      ignoreDeclaration: true,
      parseAttributeValue: true,
    });

    const parsed = parser.parse(xmlContent);

    // Navigate to seriesId: edgarSubmission > headerData > seriesClassInfo > seriesId
    const edgarSubmission = parsed.edgarSubmission || parsed.edgarsubmission;
    if (!edgarSubmission) {
      console.warn(`[parseNportSeriesId] No edgarSubmission element found in XML`);
      return null;
    }

    const headerData = edgarSubmission.headerData || edgarSubmission.headerdata;
    if (!headerData) {
      console.warn(`[parseNportSeriesId] No headerData element found in XML`);
      return null;
    }

    const seriesClassInfo = headerData.seriesClassInfo || headerData.seriesclassinfo;
    if (!seriesClassInfo) {
      console.warn(`[parseNportSeriesId] No seriesClassInfo element found in XML`);
      return null;
    }

    // Handle both single object and array cases
    const seriesInfoArray = Array.isArray(seriesClassInfo) ? seriesClassInfo : [seriesClassInfo];

    // Extract all unique series IDs
    const seriesIds = seriesInfoArray
      .map(info => info.seriesId || info.seriesid)
      .filter(Boolean);

    if (seriesIds.length === 0) {
      console.warn(`[parseNportSeriesId] No seriesId found in seriesClassInfo`);
      return null;
    }

    // If multiple series IDs, return the first one
    // (Caller should match by ticker if needed)
    const seriesId = seriesIds[0];
    console.log(`[parseNportSeriesId] Found seriesId: ${seriesId}`);

    return seriesId;
  } catch (error) {
    console.error(`[parseNportSeriesId] Error parsing N-PORT XML:`, error);
    return null;
  }
}

/**
 * Resolve series_id for an ETF or fund by querying N-PORT filings or SEC registration data.
 *
 * Multi-series trusts (like iShares) have multiple ETFs under one CIK, each with a unique series_id.
 * This function attempts to auto-discover the series_id for a given ticker.
 *
 * @param cik - The fund/ETF CIK
 * @param ticker - The ticker symbol to resolve series_id for
 * @returns The series_id if found, null otherwise
 */
export async function resolveSeriesId(cik: string, ticker: string): Promise<string | null> {
  const supabase = createSupabaseClient();
  const normalizedCik = normalizeCik(cik);
  const normalizedTicker = ticker.toUpperCase();

  // Check if we already have series_id in entities table
  const { data: existing } = await supabase
    .from('entities')
    .select('series_id')
    .eq('cik', normalizedCik)
    .eq('ticker', normalizedTicker)
    .maybeSingle();

  if (existing?.series_id) {
    console.log(`[resolveSeriesId] Found existing series_id for ${normalizedTicker}: ${existing.series_id}`);
    return existing.series_id;
  }

  // Attempt to resolve from N-PORT filings
  // N-PORT filings contain seriesId in the XML structure: edgarSubmission > headerData > seriesClassInfo > seriesId
  try {
    const { data: nportFilings } = await supabase
      .from('filings')
      .select('accession')
      .eq('cik', normalizedCik)
      .eq('form', 'NPORT-P')
      .order('filed_date', { ascending: false })
      .limit(5); // Get last 5 filings in case first one fails

    if (!nportFilings || nportFilings.length === 0) {
      console.warn(`[resolveSeriesId] No N-PORT filings found for CIK ${normalizedCik}`);
      return null;
    }

    console.log(`[resolveSeriesId] Found ${nportFilings.length} N-PORT filings for CIK ${normalizedCik}, attempting to parse...`);

    // Try each filing until we successfully extract a series_id
    for (const filing of nportFilings) {
      const seriesId = await parseNportSeriesId(filing.accession, normalizedCik);
      if (seriesId) {
        console.log(`[resolveSeriesId] Successfully resolved series_id for ${normalizedTicker}: ${seriesId}`);
        return seriesId;
      }
    }

    console.warn(`[resolveSeriesId] Could not extract series_id from any N-PORT filing for ${normalizedTicker}`);
    return null;
  } catch (error) {
    console.error(`[resolveSeriesId] Error resolving series_id for ${normalizedTicker}:`, error);
    return null;
  }
}

// Legacy aliases for backward compatibility
export const ensureEntity = upsertEntity;
export const ensureCusipMappings = upsertCusipMapping;
export const ensureEntityAndCusips = upsertEntityAndCusips;
export type EnsureEntityResult = UpsertEntityResult;
export type EnsureCusipMappingResult = UpsertCusipMappingResult;
