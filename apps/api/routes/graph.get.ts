import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const cikParam = url.searchParams.get('cik');
  const period = url.searchParams.get('period');
  if (!period) {
    return new Response('Missing period', { status: 400 });
  }
  if (!ticker && !cikParam) {
    return new Response('Missing identifier', { status: 400 });
  }
  const supabase = createSupabaseClient();
  let issuerCik: string | null = cikParam;
  if (!issuerCik && ticker) {
    const normalizedTicker = ticker.toUpperCase();
    const { data: issuer, error: issuerError } = await supabase
      .from('entities')
      .select('cik')
      .eq('kind', 'issuer')
      .ilike('name', `%${normalizedTicker}%`)
      .maybeSingle();
    if (issuerError || !issuer?.cik) {
      return new Response('Unknown ticker', { status: 404 });
    }
    issuerCik = issuer.cik;
  }
  if (!issuerCik) {
    return new Response('Missing identifier', { status: 400 });
  }
  const { data, error } = await supabase
    .from('rotation_edges')
    .select('*')
    .eq('period_start', `${period}-01`)
    .eq('root_issuer_cik', issuerCik);
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
