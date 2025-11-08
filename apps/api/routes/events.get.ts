import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const cikParam = url.searchParams.get('cik');
  if (!ticker && !cikParam) {
    return new Response('Missing identifier', { status: 400 });
  }
  const supabase = createSupabaseClient();
  let issuerCik: string | null = cikParam;
  if (!issuerCik && ticker) {
    const { data: issuer, error: issuerError } = await supabase
      .from('issuers')
      .select('cik')
      .eq('ticker', ticker.toUpperCase())
      .single();
    if (issuerError || !issuer) {
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
