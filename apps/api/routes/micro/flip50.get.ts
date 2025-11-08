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
  let eventsQuery = supabase
    .from('micro_flip50_events')
    .select('event_date,lookback_days,preceding_streak,offex_pct,quality_flag')
    .eq('symbol', ticker.toUpperCase())
    .order('event_date', { ascending: true });
  if (from) {
    eventsQuery = eventsQuery.gte('event_date', from);
  }
  if (to) {
    eventsQuery = eventsQuery.lte('event_date', to);
  }
  const [{ data: events, error: eventsError }, { data: studies, error: studiesError }] = await Promise.all([
    eventsQuery,
    supabase
      .from('micro_event_study_results')
      .select('*')
      .eq('symbol', ticker.toUpperCase())
      .eq('event_type', 'Flip50'),
  ]);
  if (eventsError) {
    return new Response(eventsError.message, { status: 500 });
  }
  if (studiesError) {
    return new Response(studiesError.message, { status: 500 });
  }
  const studyByDate = new Map<string, any>();
  for (const row of studies ?? []) {
    studyByDate.set(row.anchor_date, row);
  }
  const result = (events ?? []).map((event) => ({
    ...event,
    study: studyByDate.get(event.event_date) ?? null,
  }));
  return Response.json(result);
}
