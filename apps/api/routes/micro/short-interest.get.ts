import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.js';

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) {
    return new Response('ticker is required', { status: 400 });
  }
  const from = normalizeDate(url.searchParams.get('from'));
  const to = normalizeDate(url.searchParams.get('to'));
  const supabase = createSupabaseClient();
  let query = supabase
    .from('micro_short_interest_points')
    .select('settlement_date,publication_date,short_interest,source,provenance')
    .eq('symbol', ticker.toUpperCase())
    .order('settlement_date', { ascending: true });
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
