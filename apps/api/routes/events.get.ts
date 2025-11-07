import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) {
    return new Response('Missing ticker', { status: 400 });
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('rotation_events')
    .select('*')
    .eq('issuer_cik', ticker);
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  return Response.json(data);
}
