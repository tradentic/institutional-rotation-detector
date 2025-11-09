import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.js';

/**
 * GET /api/micro/flip50
 *
 * Query Flip50 events for a symbol
 *
 * Query params:
 * - ticker: Stock symbol (required)
 * - from: Start flip date YYYY-MM-DD (optional)
 * - to: End flip date YYYY-MM-DD (optional)
 *
 * Returns array of Flip50 events with:
 * - flip_date: Date when offex_pct crossed below 50%
 * - pre_period_start: Start of >=50% run
 * - pre_period_days: Number of consecutive days >=50%
 * - pre_avg_offex_pct: Average offex_pct during pre-period
 * - flip_offex_pct: offex_pct on flip_date
 * - quality_flag: Inherited from daily offex_ratio
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();
  const from = url.searchParams.get('from')?.trim();
  const to = url.searchParams.get('to')?.trim();

  if (!ticker) {
    return new Response('Missing ticker parameter', { status: 400 });
  }

  const supabase = createSupabaseClient();

  // Build query
  let query = supabase
    .from('micro_flip50_events')
    .select(`
      *,
      study:micro_flip50_event_studies(*)
    `)
    .eq('symbol', ticker)
    .order('flip_date', { ascending: false });

  if (from) {
    query = query.gte('flip_date', from);
  }

  if (to) {
    query = query.lte('flip_date', to);
  }

  const { data, error } = await query;

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return Response.json(data ?? []);
}
