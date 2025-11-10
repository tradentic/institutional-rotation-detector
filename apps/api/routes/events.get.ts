import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.ts';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tickerParam = url.searchParams.get('ticker');
  const cikParam = url.searchParams.get('cik');
  const ticker = tickerParam?.trim();
  const issuerCikParam = cikParam?.trim();
  if (!ticker && !issuerCikParam) {
    return new Response('Missing identifier', { status: 400 });
  }
  const supabase = createSupabaseClient();
  let issuerCik: string | null = issuerCikParam ?? null;
  if (!issuerCik && ticker) {
    const normalizedTicker = ticker.toUpperCase();
    const { data: issuer, error: issuerError } = await supabase
      .from('entities')
      .select('cik')
      .eq('kind', 'issuer')
      .eq('ticker', normalizedTicker)
      .maybeSingle();
    if (issuerError) {
      return new Response(issuerError.message, { status: 500 });
    }
    if (!issuer) {
      return new Response('Unknown ticker', { status: 404 });
    }
    issuerCik = issuer.cik;
  }
  if (!issuerCik) {
    return new Response('Missing identifier', { status: 400 });
  }
  const { data, error } = await supabase
    .from('rotation_events')
    .select('*')
    .eq('issuer_cik', issuerCik);
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  return Response.json(data);
}
