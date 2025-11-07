import { createSupabaseClient } from '../apps/temporal-worker/src/lib/supabase.js';

async function main() {
  const supabase = createSupabaseClient();
  const entries = [] as any[];
  for (let year = 2019; year <= 2025; year++) {
    entries.push(
      {
        index_name: 'Russell',
        phase: 'annual',
        window_start: `${year}-05-15`,
        window_end: `${year}-07-15`,
      },
      {
        index_name: 'Russell',
        phase: 'effective',
        window_start: `${year}-06-01`,
        window_end: `${year}-06-30`,
      }
    );
  }
  for (let year = 2026; year <= 2030; year++) {
    entries.push(
      {
        index_name: 'Russell',
        phase: 'semi-annual',
        window_start: `${year}-05-15`,
        window_end: `${year}-07-15`,
      },
      {
        index_name: 'Russell',
        phase: 'semi-annual',
        window_start: `${year}-10-15`,
        window_end: `${year}-12-15`,
      }
    );
  }
  const quarters = ['03-01', '06-01', '09-01', '12-01'];
  for (let year = 2019; year <= 2030; year++) {
    for (const month of quarters) {
      entries.push({
        index_name: 'S&P',
        phase: 'quarterly',
        window_start: `${year}-${month}`,
        window_end: `${year}-${month}`,
      });
    }
  }
  await supabase.from('index_windows').upsert(entries);
  console.log(`Seeded ${entries.length} windows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
