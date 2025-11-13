import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';

// ============================================================================
// XML Schemas for Form 4 Parsing
// ============================================================================

const ownerDataSchema = z.object({
  reportingOwnerId: z.object({
    rptOwnerCik: z.string().optional(),
    rptOwnerName: z.string().optional(),
  }).optional(),
  reportingOwnerAddress: z.any().optional(),
  reportingOwnerRelationship: z.object({
    isDirector: z.union([z.string(), z.number()]).optional(),
    isOfficer: z.union([z.string(), z.number()]).optional(),
    isTenPercentOwner: z.union([z.string(), z.number()]).optional(),
    isOther: z.union([z.string(), z.number()]).optional(),
    officerTitle: z.string().optional(),
  }).optional(),
});

const derivativeTransactionSchema = z.object({
  securityTitle: z.object({
    value: z.string(),
  }).optional(),
  transactionDate: z.object({
    value: z.string(),
  }).optional(),
  transactionCoding: z.object({
    transactionFormType: z.string().optional(),
    transactionCode: z.string().optional(),
    equitySwapInvolved: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  transactionAmounts: z.object({
    transactionShares: z.object({ value: z.string() }).optional(),
    transactionPricePerShare: z.object({ value: z.string() }).optional(),
    transactionAcquiredDisposedCode: z.object({ value: z.string() }).optional(),
  }).optional(),
  exerciseDate: z.object({
    value: z.string().optional(),
  }).optional(),
  expirationDate: z.object({
    value: z.string().optional(),
  }).optional(),
  underlyingSecurity: z.object({
    underlyingSecurityTitle: z.object({ value: z.string() }).optional(),
    underlyingSecurityShares: z.object({ value: z.string() }).optional(),
  }).optional(),
  conversionOrExercisePrice: z.object({
    value: z.string().optional(),
  }).optional(),
  postTransactionAmounts: z.object({
    sharesOwnedFollowingTransaction: z.object({ value: z.string() }).optional(),
  }).optional(),
  ownershipNature: z.object({
    directOrIndirectOwnership: z.object({ value: z.string() }).optional(),
  }).optional(),
}).optional();

const nonDerivativeTransactionSchema = z.object({
  securityTitle: z.object({
    value: z.string(),
  }).optional(),
  transactionDate: z.object({
    value: z.string(),
  }).optional(),
  transactionCoding: z.object({
    transactionFormType: z.string().optional(),
    transactionCode: z.string().optional(),
    equitySwapInvolved: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  transactionAmounts: z.object({
    transactionShares: z.object({ value: z.string() }).optional(),
    transactionPricePerShare: z.object({ value: z.string() }).optional(),
    transactionAcquiredDisposedCode: z.object({ value: z.string() }).optional(),
  }).optional(),
  postTransactionAmounts: z.object({
    sharesOwnedFollowingTransaction: z.object({ value: z.string() }).optional(),
  }).optional(),
  ownershipNature: z.object({
    directOrIndirectOwnership: z.object({ value: z.string() }).optional(),
  }).optional(),
}).optional();

const form4Schema = z.object({
  ownershipDocument: z.object({
    schemaVersion: z.string().optional(),
    issuer: z.object({
      issuerCik: z.string().optional(),
      issuerName: z.string().optional(),
      issuerTradingSymbol: z.string().optional(),
    }).optional(),
    reportingOwner: z.union([
      ownerDataSchema,
      z.array(ownerDataSchema),
    ]).optional(),
    nonDerivativeTable: z.object({
      nonDerivativeTransaction: z.union([
        nonDerivativeTransactionSchema,
        z.array(nonDerivativeTransactionSchema),
      ]).optional(),
    }).optional(),
    derivativeTable: z.object({
      derivativeTransaction: z.union([
        derivativeTransactionSchema,
        z.array(derivativeTransactionSchema),
      ]).optional(),
    }).optional(),
    footnotes: z.any().optional(),
  }),
});

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeCik(value: string): string {
  return value.replace(/[^\d]/g, '').padStart(10, '0');
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBooleanFlag(value: string | number | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return value === 1;
  return value === '1' || value.toLowerCase() === 'true';
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  // Handle YYYY-MM-DD format
  const iso = dateStr.length === 10 ? dateStr : dateStr.substring(0, 10);
  return iso;
}

function parseNumeric(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function classifyTransactionType(
  transactionCode: string,
  pricePerShare: number | null,
  isDerivative: boolean
): string {
  // Transaction codes:
  // P = Purchase, S = Sale, A = Award/Grant, D = Disposition (exercise to cover)
  // M = Exercise/Conversion, G = Gift, C = Conversion, W = Acquisition/Disposition by Will

  if (transactionCode === 'G') return 'GIFT';
  if (transactionCode === 'M') return 'OPTION_EXERCISE';
  if (transactionCode === 'A' && isDerivative) return 'GRANT';
  if (transactionCode === 'P' && pricePerShare && pricePerShare > 0) return 'OPEN_MARKET';
  if (transactionCode === 'S' && pricePerShare && pricePerShare > 0) return 'OPEN_MARKET';
  if (transactionCode === 'P' || transactionCode === 'S') return 'PRIVATE';
  return 'OTHER';
}

// ============================================================================
// Main Activities
// ============================================================================

/**
 * Fetch Form 4 filings for a date range
 */
export async function fetchForm4Filings(params: {
  startDate: string;
  endDate: string;
  issuerCik?: string;
}): Promise<{ count: number; filings: Array<{ accessionNumber: string; filingDate: string }> }> {
  const supabase = createSupabaseClient();
  const client = createSecClient();

  // Fetch RSS feed or use submissions endpoint
  // For simplicity, we'll use the submissions endpoint filtered by date
  const { startDate, endDate, issuerCik } = params;

  if (!issuerCik) {
    throw new Error('issuerCik is required for Form 4 fetching');
  }

  const normalizedCik = normalizeCik(issuerCik);

  // Self-healing: ensure issuer entity exists
  try {
    const { upsertEntity } = await import('./entity-utils');
    await upsertEntity(normalizedCik, 'issuer');
  } catch (error) {
    console.warn(`[fetchForm4Filings] Failed to ensure entity exists for CIK ${normalizedCik}:`, error);
  }
  const response = await client.get(`/submissions/CIK${normalizedCik}.json`);
  const json = await response.json() as { filings?: { recent?: { accessionNumber: string[]; filingDate: string[]; form: string[] } } };

  const recent = json.filings?.recent;
  if (!recent) {
    return { count: 0, filings: [] };
  }

  const filings: Array<{ accessionNumber: string; filingDate: string }> = [];

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const formType = recent.form[i];
    const filingDate = recent.filingDate[i];
    const accessionNumber = recent.accessionNumber[i];

    // Filter for Form 4 and Form 4/A
    if (!formType.startsWith('4')) continue;

    // Filter by date range
    if (filingDate < startDate || filingDate > endDate) continue;

    filings.push({
      accessionNumber: accessionNumber.replace(/-/g, ''),
      filingDate,
    });
  }

  // Store in form4_filings table
  for (const filing of filings) {
    await supabase
      .from('form4_filings')
      .upsert({
        accession_number: filing.accessionNumber,
        issuer_cik: normalizedCik,
        filing_date: filing.filingDate,
        status: 'PENDING',
        sec_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${normalizedCik}&type=4&dateb=&owner=exclude&count=100`,
      }, {
        onConflict: 'accession_number',
        ignoreDuplicates: true,
      });
  }

  return { count: filings.length, filings };
}

/**
 * Download and parse a single Form 4 filing
 */
export async function downloadForm4Filing(accessionNumber: string): Promise<{
  accessionNumber: string;
  transactions: number;
  status: string;
}> {
  const supabase = createSupabaseClient();
  const client = createSecClient();

  try {
    // Build SEC URL for Form 4 XML
    // Format: https://www.sec.gov/cgi-bin/viewer?action=view&cik=CIK&accession_number=ACC&xbrl_type=v
    // Actually, we need the direct document URL
    // Format: https://www.sec.gov/Archives/edgar/data/CIK/ACCESSION/PRIMARYDOC

    // Get filing metadata first to find the primary document
    const normalizedAcc = accessionNumber.replace(/-/g, '');
    const { data: filingData } = await supabase
      .from('form4_filings')
      .select('issuer_cik')
      .eq('accession_number', normalizedAcc)
      .single();

    if (!filingData) {
      throw new Error(`Filing ${normalizedAcc} not found in database`);
    }

    const cik = filingData.issuer_cik;
    const accWithHyphens = normalizedAcc.slice(0, 10) + '-' + normalizedAcc.slice(10, 12) + '-' + normalizedAcc.slice(12);

    // Fetch the filing index to find primary document
    const indexUrl = `/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${accWithHyphens}&xbrl_type=v`;

    // For Form 4, the primary document is typically "wf-form4_TIMESTAMP.xml"
    // We'll try common patterns
    const possibleDocs = [
      `wf-form4.xml`,
      `form4.xml`,
      `primary_doc.xml`,
      `doc4.xml`,
    ];

    let xmlContent: string | null = null;
    let primaryDoc: string | null = null;

    for (const doc of possibleDocs) {
      try {
        const docUrl = `/Archives/edgar/data/${cik}/${normalizedAcc}/${doc}`;
        const response = await client.get(docUrl);
        xmlContent = await response.text();
        primaryDoc = doc;
        break;
      } catch (err) {
        // Try next document
        continue;
      }
    }

    if (!xmlContent) {
      throw new Error(`Could not find Form 4 XML document for ${normalizedAcc}`);
    }

    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: 'value',
    });

    const parsed = parser.parse(xmlContent);
    const form4Data = form4Schema.parse(parsed);

    // Extract transactions
    const transactions = await parseForm4Transactions(form4Data, normalizedAcc);

    // Update filing status
    await supabase
      .from('form4_filings')
      .update({
        status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        document_count: transactions.length,
      })
      .eq('accession_number', normalizedAcc);

    return {
      accessionNumber: normalizedAcc,
      transactions: transactions.length,
      status: 'PROCESSED',
    };

  } catch (error) {
    // Update filing status to FAILED
    await supabase
      .from('form4_filings')
      .update({
        status: 'FAILED',
        error_message: error instanceof Error ? error.message : String(error),
      })
      .eq('accession_number', accessionNumber);

    throw error;
  }
}

/**
 * Parse Form 4 XML and insert transactions
 */
async function parseForm4Transactions(
  form4Data: z.infer<typeof form4Schema>,
  accessionNumber: string
): Promise<Array<{ id: string }>> {
  const supabase = createSupabaseClient();
  const doc = form4Data.ownershipDocument;

  // Get issuer info
  const issuerCik = doc.issuer?.issuerCik ? normalizeCik(doc.issuer.issuerCik) : null;
  const issuerName = doc.issuer?.issuerName || null;
  const ticker = doc.issuer?.issuerTradingSymbol || null;

  // Get reporting owners
  const owners = toArray(doc.reportingOwner);

  const transactions: any[] = [];

  // Process each reporting owner
  for (const owner of owners) {
    const ownerCik = owner.reportingOwnerId?.rptOwnerCik
      ? normalizeCik(owner.reportingOwnerId.rptOwnerCik)
      : null;
    const ownerName = owner.reportingOwnerId?.rptOwnerName || null;

    const relationship = owner.reportingOwnerRelationship;
    const isDirector = parseBooleanFlag(relationship?.isDirector);
    const isOfficer = parseBooleanFlag(relationship?.isOfficer);
    const isTenPercentOwner = parseBooleanFlag(relationship?.isTenPercentOwner);
    const isOther = parseBooleanFlag(relationship?.isOther);
    const officerTitle = relationship?.officerTitle || null;

    // Process non-derivative transactions (common stock)
    const nonDerivTxns = toArray(doc.nonDerivativeTable?.nonDerivativeTransaction);
    for (const txn of nonDerivTxns) {
      if (!txn) continue;

      const transactionDate = parseDate(txn.transactionDate?.value);
      const transactionCode = txn.transactionCoding?.transactionCode || '';
      const shares = parseNumeric(txn.transactionAmounts?.transactionShares?.value);
      const pricePerShare = parseNumeric(txn.transactionAmounts?.transactionPricePerShare?.value);
      const acquiredDisposed = txn.transactionAmounts?.transactionAcquiredDisposedCode?.value;
      const sharesOwned = parseNumeric(txn.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value);
      const directIndirect = txn.ownershipNature?.directOrIndirectOwnership?.value || 'D';

      const transactionType = classifyTransactionType(transactionCode, pricePerShare, false);

      transactions.push({
        accession_number: accessionNumber,
        filing_date: new Date().toISOString().substring(0, 10), // Will be updated with actual filing date
        ticker,
        issuer_cik: issuerCik,
        issuer_name: issuerName,
        transaction_date: transactionDate,
        transaction_code: transactionCode,
        transaction_shares: shares,
        transaction_price_per_share: pricePerShare,
        transaction_acquired_disposed: acquiredDisposed,
        reporting_owner_cik: ownerCik,
        reporting_owner_name: ownerName,
        is_director: isDirector,
        is_officer: isOfficer,
        is_ten_percent_owner: isTenPercentOwner,
        is_other: isOther,
        officer_title: officerTitle,
        shares_owned_following_transaction: sharesOwned,
        direct_or_indirect_ownership: directIndirect,
        is_derivative: false,
        transaction_type_category: transactionType,
      });
    }

    // Process derivative transactions (options, warrants, etc.)
    const derivTxns = toArray(doc.derivativeTable?.derivativeTransaction);
    for (const txn of derivTxns) {
      if (!txn) continue;

      const transactionDate = parseDate(txn.transactionDate?.value);
      const transactionCode = txn.transactionCoding?.transactionCode || '';
      const shares = parseNumeric(txn.transactionAmounts?.transactionShares?.value);
      const pricePerShare = parseNumeric(txn.transactionAmounts?.transactionPricePerShare?.value);
      const acquiredDisposed = txn.transactionAmounts?.transactionAcquiredDisposedCode?.value;
      const sharesOwned = parseNumeric(txn.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value);
      const directIndirect = txn.ownershipNature?.directOrIndirectOwnership?.value || 'D';
      const conversionPrice = parseNumeric(txn.conversionOrExercisePrice?.value);
      const exerciseDate = parseDate(txn.exerciseDate?.value);
      const expirationDate = parseDate(txn.expirationDate?.value);
      const underlyingTitle = txn.underlyingSecurity?.underlyingSecurityTitle?.value;

      const transactionType = classifyTransactionType(transactionCode, pricePerShare, true);

      transactions.push({
        accession_number: accessionNumber,
        filing_date: new Date().toISOString().substring(0, 10),
        ticker,
        issuer_cik: issuerCik,
        issuer_name: issuerName,
        transaction_date: transactionDate,
        transaction_code: transactionCode,
        transaction_shares: shares,
        transaction_price_per_share: pricePerShare,
        transaction_acquired_disposed: acquiredDisposed,
        reporting_owner_cik: ownerCik,
        reporting_owner_name: ownerName,
        is_director: isDirector,
        is_officer: isOfficer,
        is_ten_percent_owner: isTenPercentOwner,
        is_other: isOther,
        officer_title: officerTitle,
        shares_owned_following_transaction: sharesOwned,
        direct_or_indirect_ownership: directIndirect,
        is_derivative: true,
        underlying_security_title: underlyingTitle,
        conversion_or_exercise_price: conversionPrice,
        exercise_date: exerciseDate,
        expiration_date: expirationDate,
        transaction_type_category: transactionType,
      });
    }
  }

  // Insert transactions
  if (transactions.length > 0) {
    const { data, error } = await supabase
      .from('insider_transactions')
      .upsert(transactions, {
        onConflict: 'accession_number',
        ignoreDuplicates: false,
      })
      .select('id');

    if (error) {
      throw error;
    }

    return data || [];
  }

  return [];
}

/**
 * Compute daily insider summary from transactions
 */
export async function computeInsiderSummary(params: {
  cusip?: string;
  ticker?: string;
  startDate: string;
  endDate: string;
}): Promise<{ processed: number }> {
  const supabase = createSupabaseClient();
  const { cusip, ticker, startDate, endDate } = params;

  // Build query
  let query = supabase
    .from('insider_transactions')
    .select('*')
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate);

  if (cusip) {
    query = query.eq('cusip', cusip);
  } else if (ticker) {
    query = query.eq('ticker', ticker);
  }

  const { data: transactions, error } = await query;

  if (error) {
    throw error;
  }

  if (!transactions || transactions.length === 0) {
    return { processed: 0 };
  }

  // Group by (cusip/ticker, transaction_date)
  const grouped = new Map<string, any[]>();

  for (const txn of transactions) {
    const key = `${txn.cusip || txn.ticker}|${txn.transaction_date}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(txn);
  }

  // Compute summaries
  const summaries: any[] = [];

  for (const [key, txns] of grouped) {
    const [identifier, transactionDate] = key.split('|');
    const firstTxn = txns[0];

    let totalPurchases = 0;
    let totalSales = 0;
    let purchaseCount = 0;
    let saleCount = 0;
    let totalPurchaseValue = 0;
    let totalSaleValue = 0;
    let directorNetFlow = 0;
    let officerNetFlow = 0;
    let tenPercentOwnerNetFlow = 0;
    let hasCeoActivity = false;
    let hasCfoActivity = false;
    let hasLargePurchase = false;
    const insiderSet = new Set<string>();

    for (const txn of txns) {
      const shares = txn.transaction_shares || 0;
      const price = txn.transaction_price_per_share || 0;
      const isPurchase = txn.transaction_code === 'P' || txn.transaction_acquired_disposed === 'A';
      const isSale = txn.transaction_code === 'S' || txn.transaction_acquired_disposed === 'D';

      if (isPurchase) {
        totalPurchases += shares;
        purchaseCount++;
        totalPurchaseValue += shares * price;
        if (shares > 10000) hasLargePurchase = true;
      }

      if (isSale) {
        totalSales += shares;
        saleCount++;
        totalSaleValue += shares * price;
      }

      // Track by role
      const netShares = isPurchase ? shares : -shares;
      if (txn.is_director) directorNetFlow += netShares;
      if (txn.is_officer) officerNetFlow += netShares;
      if (txn.is_ten_percent_owner) tenPercentOwnerNetFlow += netShares;

      // Check for CEO/CFO
      const title = (txn.officer_title || '').toUpperCase();
      if (title.includes('CEO') || title.includes('CHIEF EXECUTIVE')) hasCeoActivity = true;
      if (title.includes('CFO') || title.includes('CHIEF FINANCIAL')) hasCfoActivity = true;

      // Track unique insiders
      if (txn.reporting_owner_cik) insiderSet.add(txn.reporting_owner_cik);
    }

    const hasClusterActivity = insiderSet.size > 1;

    summaries.push({
      cusip: firstTxn.cusip,
      ticker: firstTxn.ticker,
      transaction_date: transactionDate,
      total_insider_purchases: totalPurchases,
      total_insider_sales: totalSales,
      net_insider_flow: totalPurchases - totalSales,
      purchase_count: purchaseCount,
      sale_count: saleCount,
      total_purchase_value: totalPurchaseValue,
      total_sale_value: totalSaleValue,
      director_net_flow: directorNetFlow,
      officer_net_flow: officerNetFlow,
      ten_percent_owner_net_flow: tenPercentOwnerNetFlow,
      has_ceo_activity: hasCeoActivity,
      has_cfo_activity: hasCfoActivity,
      has_large_purchase: hasLargePurchase,
      has_cluster_activity: hasClusterActivity,
    });
  }

  // Upsert summaries
  if (summaries.length > 0) {
    await supabase
      .from('insider_summary_daily')
      .upsert(summaries, {
        onConflict: 'cusip,transaction_date',
      });
  }

  return { processed: summaries.length };
}
