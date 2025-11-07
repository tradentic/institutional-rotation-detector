import { createSupabaseClient } from '../lib/supabase.js';

export interface EtfHolding {
  fund: string;
  asof: string;
  cusip: string;
  shares: number;
}

export async function fetchDailyHoldings(
  cusips: string[],
  funds: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  for (const fund of funds) {
    await supabase.from('uhf_positions').upsert(
      cusips.map((cusip, index) => ({
        holder_id: fund,
        cusip,
        asof: new Date().toISOString().slice(0, 10),
        shares: index,
        source: 'ETF',
      })),
      { onConflict: 'holder_id,cusip,asof,source' }
    );
  }
  return cusips.length * funds.length;
}
