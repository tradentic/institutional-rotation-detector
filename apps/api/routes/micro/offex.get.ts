import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.ts';

/**
 * GET /api/micro/offex
 *
 * Query off-exchange percentage time series for a symbol
 *
 * Query params:
 * - ticker: Stock symbol (required)
 * - granularity: 'weekly' | 'daily' (optional, defaults to both)
 * - from: Start date YYYY-MM-DD (optional)
 * - to: End date YYYY-MM-DD (optional)
 * - quality: Filter by quality flag (optional)
 *
 * Returns array of off-exchange ratio records with:
 * - as_of: Date
 * - granularity: 'weekly' | 'daily'
 * - offex_shares: Off-exchange shares
 * - on_ex_shares: On-exchange shares (may be null for official_partial)
 * - offex_pct: Off-exchange percentage (0-1)
 * - quality_flag: 'official' | 'official_partial' | 'approx' | 'iex_proxy'
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();
  const granularity = url.searchParams.get('granularity') as 'weekly' | 'daily' | null;
  const from = url.searchParams.get('from')?.trim();
  const to = url.searchParams.get('to')?.trim();
  const quality = url.searchParams.get('quality')?.trim();

  if (!ticker) {
    return new Response('Missing ticker parameter', { status: 400 });
  }

  const supabase = createSupabaseClient();

  // Build query
  let query = supabase
    .from('micro_offex_ratio')
    .select('*')
    .eq('symbol', ticker)
    .order('as_of', { ascending: true });

  if (granularity) {
    query = query.eq('granularity', granularity);
  }

  if (from) {
    query = query.gte('as_of', from);
  }

  if (to) {
    query = query.lte('as_of', to);
  }

  if (quality) {
    query = query.eq('quality_flag', quality);
  }

  const { data, error } = await query;

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return Response.json(data ?? []);
}
