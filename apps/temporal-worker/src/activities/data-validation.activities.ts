/**
 * Data Validation Activities
 *
 * Post-ingestion validation to catch data quality issues early.
 * These activities can be run after ingestion workflows to ensure data integrity.
 */

import { createSupabaseClient } from '../lib/supabase';

export interface ValidationResult {
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    category: string;
    message: string;
    count?: number;
    examples?: string[];
  }>;
}

/**
 * Validate ATS weekly data quality
 *
 * Checks for:
 * - UNKNOWN venues (should have actual venue codes)
 * - Invalid CUSIPs (must be 9 alphanumeric characters)
 * - Tickers stored as CUSIPs
 *
 * @param cik - Company CIK to validate
 * @param dateRange - Date range to check
 */
export async function validateATSWeeklyData(
  cik: string,
  dateRange: { start: string; end: string }
): Promise<ValidationResult> {
  const supabase = createSupabaseClient();
  const issues: ValidationResult['issues'] = [];

  // Get ticker for this CIK
  const { data: entityData } = await supabase
    .from('entities')
    .select('ticker')
    .eq('cik', cik)
    .maybeSingle();

  const ticker = entityData?.ticker;

  // Get CUSIPs for this CIK
  const { data: cusipData } = await supabase
    .from('cusip_issuer_map')
    .select('cusip')
    .eq('issuer_cik', cik);

  const validCusips = (cusipData || [])
    .map(r => r.cusip)
    .filter(c => c && /^[0-9A-Z]{9}$/.test(c));

  // Check 1: UNKNOWN venues
  const { data: unknownVenues, count: unknownCount } = await supabase
    .from('ats_weekly')
    .select('week_end, cusip, venue', { count: 'exact' })
    .in('cusip', validCusips)
    .eq('venue', 'UNKNOWN')
    .gte('week_end', dateRange.start)
    .lte('week_end', dateRange.end)
    .limit(5);

  if (unknownCount && unknownCount > 0) {
    issues.push({
      severity: 'error',
      category: 'ATS_UNKNOWN_VENUE',
      message: `Found ${unknownCount} ATS weekly records with venue = 'UNKNOWN'`,
      count: unknownCount,
      examples: (unknownVenues || []).map(
        r => `${r.week_end}: CUSIP ${r.cusip}`
      ),
    });
  }

  // Check 2: Invalid CUSIPs (not 9 characters)
  const { data: invalidCusips, count: invalidCount } = await supabase
    .from('ats_weekly')
    .select('week_end, cusip, venue', { count: 'exact' })
    .in('cusip', validCusips.concat(ticker ? [ticker] : []))
    .gte('week_end', dateRange.start)
    .lte('week_end', dateRange.end)
    .limit(100);

  const invalidCusipRecords = (invalidCusips || []).filter(
    r => !r.cusip || !/^[0-9A-Z]{9}$/.test(r.cusip)
  );

  if (invalidCusipRecords.length > 0) {
    issues.push({
      severity: 'error',
      category: 'ATS_INVALID_CUSIP',
      message: `Found ${invalidCusipRecords.length} ATS weekly records with invalid CUSIPs (must be 9 alphanumeric characters)`,
      count: invalidCusipRecords.length,
      examples: invalidCusipRecords.slice(0, 5).map(
        r => `${r.week_end}: '${r.cusip}' (length: ${r.cusip?.length || 0})`
      ),
    });
  }

  // Check 3: Ticker stored as CUSIP
  if (ticker) {
    const { data: tickerRecords, count: tickerCount } = await supabase
      .from('ats_weekly')
      .select('week_end, cusip, venue', { count: 'exact' })
      .eq('cusip', ticker)
      .gte('week_end', dateRange.start)
      .lte('week_end', dateRange.end)
      .limit(5);

    if (tickerCount && tickerCount > 0) {
      issues.push({
        severity: 'error',
        category: 'ATS_TICKER_AS_CUSIP',
        message: `Found ${tickerCount} ATS weekly records with ticker '${ticker}' stored as CUSIP`,
        count: tickerCount,
        examples: (tickerRecords || []).map(
          r => `${r.week_end}: ticker '${r.cusip}' should be CUSIP '${validCusips[0] || 'UNKNOWN'}'`
        ),
      });
    }
  }

  // Check 4: Missing data (no records found)
  const { count: totalRecords } = await supabase
    .from('ats_weekly')
    .select('*', { count: 'exact', head: true })
    .in('cusip', validCusips)
    .gte('week_end', dateRange.start)
    .lte('week_end', dateRange.end);

  if (!totalRecords || totalRecords === 0) {
    issues.push({
      severity: 'warning',
      category: 'ATS_NO_DATA',
      message: `No ATS weekly data found for CIK ${cik} (ticker: ${ticker}) in date range`,
      count: 0,
    });
  }

  return {
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Validate ETF holdings data quality
 *
 * Checks for:
 * - Missing ETF entities
 * - Missing holdings data
 * - Stale holdings (older than expected)
 *
 * @param etfTickers - List of ETF tickers to validate
 * @param expectedDate - Expected holdings date (e.g., latest trading day)
 */
export async function validateETFHoldings(
  etfTickers: string[],
  expectedDate?: string
): Promise<ValidationResult> {
  const supabase = createSupabaseClient();
  const issues: ValidationResult['issues'] = [];

  for (const ticker of etfTickers) {
    // Check 1: ETF entity exists
    const { data: entity } = await supabase
      .from('entities')
      .select('entity_id, cik, series_id, datasource_type, datasource_config')
      .eq('kind', 'etf')
      .eq('ticker', ticker.toUpperCase())
      .maybeSingle();

    if (!entity) {
      issues.push({
        severity: 'error',
        category: 'ETF_MISSING_ENTITY',
        message: `ETF entity not found for ticker ${ticker}`,
      });
      continue;
    }

    if (!entity.datasource_type || !entity.datasource_config) {
      issues.push({
        severity: 'warning',
        category: 'ETF_MISSING_CONFIG',
        message: `ETF ${ticker} exists but missing datasource configuration`,
      });
    }

    // Check 2: Recent holdings exist
    const { data: holdings, count: holdingsCount } = await supabase
      .from('uhf_positions')
      .select('asof', { count: 'exact' })
      .eq('holder_id', entity.entity_id)
      .eq('source', 'ETF')
      .order('asof', { ascending: false })
      .limit(1);

    if (!holdingsCount || holdingsCount === 0) {
      issues.push({
        severity: 'warning',
        category: 'ETF_NO_HOLDINGS',
        message: `No holdings data found for ETF ${ticker}`,
      });
    } else if (expectedDate && holdings && holdings[0]) {
      const latestDate = holdings[0].asof;
      const daysDiff = Math.floor(
        (new Date(expectedDate).getTime() - new Date(latestDate).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (daysDiff > 7) {
        issues.push({
          severity: 'warning',
          category: 'ETF_STALE_HOLDINGS',
          message: `ETF ${ticker} holdings are ${daysDiff} days old (latest: ${latestDate}, expected: ${expectedDate})`,
        });
      }
    }
  }

  return {
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Validate CUSIP resolution quality
 *
 * Checks for:
 * - CIKs with no CUSIPs
 * - CIKs with invalid CUSIPs
 * - CIKs with ticker fallback
 *
 * @param cik - Company CIK to validate
 */
export async function validateCUSIPResolution(cik: string): Promise<ValidationResult> {
  const supabase = createSupabaseClient();
  const issues: ValidationResult['issues'] = [];

  // Get entity info
  const { data: entity } = await supabase
    .from('entities')
    .select('ticker, name')
    .eq('cik', cik)
    .maybeSingle();

  const ticker = entity?.ticker;
  const name = entity?.name || 'Unknown';

  // Check CUSIPs
  const { data: cusipData } = await supabase
    .from('cusip_issuer_map')
    .select('cusip')
    .eq('issuer_cik', cik);

  const cusips = (cusipData || []).map(r => r.cusip).filter(Boolean);

  if (cusips.length === 0) {
    issues.push({
      severity: 'error',
      category: 'CUSIP_NONE_FOUND',
      message: `No CUSIPs found for CIK ${cik} (${name})`,
    });
    return { passed: false, issues };
  }

  // Validate CUSIP format
  const validCusips = cusips.filter(c => /^[0-9A-Z]{9}$/.test(c));
  const invalidCusips = cusips.filter(c => !/^[0-9A-Z]{9}$/.test(c));

  if (invalidCusips.length > 0) {
    issues.push({
      severity: 'error',
      category: 'CUSIP_INVALID_FORMAT',
      message: `Found ${invalidCusips.length} invalid CUSIPs for CIK ${cik}`,
      count: invalidCusips.length,
      examples: invalidCusips.slice(0, 5).map(
        c => `'${c}' (length: ${c.length})`
      ),
    });
  }

  // Check for ticker fallback (ticker stored as CUSIP)
  if (ticker && cusips.includes(ticker)) {
    issues.push({
      severity: 'error',
      category: 'CUSIP_TICKER_FALLBACK',
      message: `Ticker '${ticker}' is stored as CUSIP for CIK ${cik} - CUSIP resolution failed`,
    });
  }

  return {
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Comprehensive validation for ingestion workflow
 *
 * Runs all validation checks and returns combined result
 */
export async function validateIngestionWorkflow(
  cik: string,
  dateRange: { start: string; end: string },
  etfUniverse?: string[]
): Promise<ValidationResult> {
  const [cusipValidation, atsValidation, etfValidation] = await Promise.all([
    validateCUSIPResolution(cik),
    validateATSWeeklyData(cik, dateRange),
    etfUniverse ? validateETFHoldings(etfUniverse) : Promise.resolve({ passed: true, issues: [] }),
  ]);

  const allIssues = [
    ...cusipValidation.issues,
    ...atsValidation.issues,
    ...etfValidation.issues,
  ];

  const passed = allIssues.filter(i => i.severity === 'error').length === 0;

  // Log summary
  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;

  if (errorCount > 0 || warningCount > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 DATA VALIDATION SUMMARY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Status: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Warnings: ${warningCount}`);
    console.log(`${'='.repeat(80)}`);

    if (errorCount > 0) {
      console.error(`\n❌ ERRORS:`);
      allIssues
        .filter(i => i.severity === 'error')
        .forEach((issue, idx) => {
          console.error(`  ${idx + 1}. [${issue.category}] ${issue.message}`);
          if (issue.examples && issue.examples.length > 0) {
            issue.examples.forEach(ex => console.error(`     - ${ex}`));
          }
        });
    }

    if (warningCount > 0) {
      console.warn(`\n⚠️  WARNINGS:`);
      allIssues
        .filter(i => i.severity === 'warning')
        .forEach((issue, idx) => {
          console.warn(`  ${idx + 1}. [${issue.category}] ${issue.message}`);
          if (issue.examples && issue.examples.length > 0) {
            issue.examples.forEach(ex => console.warn(`     - ${ex}`));
          }
        });
    }

    console.log(`${'='.repeat(80)}\n`);
  } else {
    console.log(`\n✓ Data validation passed - no issues found\n`);
  }

  return { passed, issues: allIssues };
}
