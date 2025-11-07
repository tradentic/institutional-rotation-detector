import { createSupabaseClient } from '../lib/supabase.js';

export async function fetchShortInterest(
  cik: string,
  settleDates: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  for (const date of settleDates) {
    await supabase.from('short_interest').upsert(
      [
        {
          settle_date: date,
          cik,
          short_shares: 0,
        },
      ],
      { onConflict: 'settle_date,cik' }
    );
  }
  return settleDates.length;
}

export async function fetchATSWeekly(
  cik: string,
  weeks: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  for (const week of weeks) {
    await supabase.from('ats_weekly').upsert(
      [
        {
          week_end: week,
          cik,
          venue: 'ATS',
          shares: 0,
          trades: 0,
        },
      ],
      { onConflict: 'week_end,cik,venue' }
    );
  }
  return weeks.length;
}
