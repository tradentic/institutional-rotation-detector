import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const period = url.searchParams.get('period');
  if (!ticker || !period) {
    return new Response('Missing parameters', { status: 400 });
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('rotation_edges')
    .select('*')
    .eq('period_start', `${period}-01`);
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  const nodes = new Set<string>();
  const links = (data ?? []).map((edge) => {
    nodes.add(edge.seller_id ?? 'unknown');
    nodes.add(edge.buyer_id ?? 'unknown');
    return {
      source: edge.seller_id ?? 'unknown',
      target: edge.buyer_id ?? 'unknown',
      value: edge.equity_shares + edge.options_shares,
      equity: edge.equity_shares,
      options: edge.options_shares,
    };
  });
  return Response.json({
    nodes: [...nodes].map((id) => ({ id, label: id })),
    links,
  });
}
