/**
 * Shared utilities for ensuring entities and CUSIP mappings exist
 *
 * These functions implement the "ensure" pattern - they check if required
 * data exists and create it if not, making activities self-sufficient.
 */

import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';
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
 * (or ticker symbols for FINRA lookups) to issuer CIKs.
 *
 * Priority order:
 * 1. Use provided CUSIPs if given
 * 2. Check if mappings already exist in DB
 * 3. Fetch from SEC submissions API (real CUSIPs or tickers as fallback)
 *
 * @param cik - The issuer CIK
 * @param providedCusips - Optional array of CUSIPs/tickers to seed
 * @returns Info about what was added
 */
export async function upsertCusipMapping(
  cik: string,
  providedCusips?: string[]
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

  // Insert CUSIP mappings
  const mappings = cusipsToAdd.map((cusip) => ({
    cusip,
    issuer_cik: normalizedCik,
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

// Legacy aliases for backward compatibility
export const ensureEntity = upsertEntity;
export const ensureCusipMappings = upsertCusipMapping;
export const ensureEntityAndCusips = upsertEntityAndCusips;
export type EnsureEntityResult = UpsertEntityResult;
export type EnsureCusipMappingResult = UpsertCusipMappingResult;
