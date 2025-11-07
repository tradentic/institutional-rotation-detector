import { createSupabaseClient } from '../lib/supabase.js';

type Month = { month: string };

export async function fetchMonthly(cik: string, months: Month[]) {
  const supabase = createSupabaseClient();
  for (const month of months) {
    await supabase.from('uhf_positions').upsert(
      [
        {
          holder_id: cik,
          cusip: '000000000',
          asof: `${month.month}-01`,
          shares: 0,
          source: 'NPORT',
        },
      ],
      { onConflict: 'holder_id,cusip,asof,source' }
    );
  }
  return months.length;
}
