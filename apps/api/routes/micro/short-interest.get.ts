import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.js';

/**
 * GET /api/micro/short-interest
 *
 * Query FINRA short interest points for a symbol
 *
 * Query params:
 * - ticker: Stock symbol (required)
 * - from: Start settlement date YYYY-MM-DD (optional)
 * - to: End settlement date YYYY-MM-DD (optional)
 *
 * Returns array of short interest records with:
 * - settlement_date: FINRA settlement date (semi-monthly: 15th and month-end)
 * - publication_date: When FINRA published the data
 * - short_interest: Number of shares short
 * - avg_daily_volume: Average daily volume (if available)
 * - days_to_cover: short_interest / avg_daily_volume (if available)
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
    .from('micro_short_interest_points')
    .select('*')
    .eq('symbol', ticker)
    .order('settlement_date', { ascending: false });

  if (from) {
    query = query.gte('settlement_date', from);
  }

  if (to) {
    query = query.lte('settlement_date', to);
  }

  const { data, error } = await query;

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return Response.json(data ?? []);
}
