/**
 * Events Handler
 *
 * Retrieves rotation events for a ticker or CIK.
 * This handler can be used in any server framework (Express, Hono, Supabase Edge Functions, etc.)
 */

import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.ts';

export interface EventsParams {
  ticker?: string;
  cik?: string;
}

export async function handleGetEvents(params: EventsParams): Promise<Response> {
  const { ticker, cik: cikParam } = params;

  if (!ticker && !cikParam) {
    return new Response('Missing identifier', { status: 400 });
  }

  const supabase = createSupabaseClient();
  let issuerCik: string | null = cikParam ?? null;

  // Resolve ticker to CIK if needed
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

  // Fetch rotation events
  const { data, error } = await supabase
    .from('rotation_events')
    .select('*')
    .eq('issuer_cik', issuerCik);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return Response.json(data);
}

/**
 * Web Standard Request handler
 * Parses query params and delegates to core handler
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker') ?? undefined;
  const cik = url.searchParams.get('cik') ?? undefined;

  return handleGetEvents({ ticker, cik });
}
