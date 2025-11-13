import { createSupabaseClient } from '../apps/temporal-worker/src/lib/supabase.ts';

/**
 * Seeds the database with common institutional fund managers.
 * This is optional - the workflow will auto-create missing managers,
 * but pre-seeding speeds up the first ingestion run.
 */
async function main() {
  const supabase = createSupabaseClient();

  // Common institutional fund managers with their CIKs
  const managers = [
    { cik: '0001067983', name: 'Berkshire Hathaway Inc.', kind: 'manager' },
    { cik: '0000789019', name: 'Vanguard Group Inc.', kind: 'manager' },
    { cik: '0001364742', name: 'BlackRock Inc.', kind: 'manager' },
    { cik: '0000076740', name: 'Fidelity Investments', kind: 'manager' },
    { cik: '0001104659', name: 'State Street Global Advisors', kind: 'manager' },
    { cik: '0000354190', name: 'Capital Research Global Investors', kind: 'manager' },
    { cik: '0001297644', name: 'T. Rowe Price Associates', kind: 'manager' },
    { cik: '0001396684', name: 'JPMorgan Chase & Co.', kind: 'manager' },
    { cik: '0000315066', name: 'Morgan Stanley', kind: 'manager' },
    { cik: '0000886982', name: 'Geode Capital Management', kind: 'manager' },
    { cik: '0001336528', name: 'Northern Trust Corp.', kind: 'manager' },
    { cik: '0000905148', name: 'Charles Schwab Investment Management', kind: 'manager' },
    { cik: '0001633917', name: 'Invesco Ltd.', kind: 'manager' },
    { cik: '0001337932', name: 'Wellington Management Group', kind: 'manager' },
    { cik: '0001029160', name: 'Bank of America Corp.', kind: 'manager' },
    { cik: '0000315709', name: 'Goldman Sachs Group Inc.', kind: 'manager' },
    { cik: '0001413717', name: 'UBS Group AG', kind: 'manager' },
    { cik: '0000019617', name: 'JPMorgan Asset Management', kind: 'manager' },
    { cik: '0000861177', name: 'Massachusetts Financial Services', kind: 'manager' },
    { cik: '0001061768', name: 'Dimensional Fund Advisors', kind: 'manager' },
  ];

  console.log(`Seeding ${managers.length} fund managers...`);

  // Insert managers, ignoring conflicts (they already exist)
  // Note: Can't use onConflict with new constraint that uses coalesce()
  const { data, error } = await supabase
    .from('entities')
    .upsert(managers, {
      ignoreDuplicates: true,
      // Managers have series_id = null, so unique constraint is (cik, '', kind)
    });

  if (error) {
    throw new Error(`Failed to seed fund managers: ${error.message}`);
  }

  console.log(`✓ Successfully seeded ${managers.length} fund managers`);
}

main().catch((err) => {
  console.error('Error seeding fund managers:', err);
  process.exit(1);
});
