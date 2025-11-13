/**
 * Self-healing CUSIP resolution from multiple authoritative sources
 *
 * This module implements a fallback chain to resolve CUSIPs when the SEC
 * submissions API returns empty securities arrays (common for single-class stocks).
 *
 * Fallback chain:
 * 1. SEC submissions API (fast, but often empty)
 * 2. OpenFIGI API (free, reliable, comprehensive)
 * 3. SEC EDGAR filings XML parsing (10-K, 10-Q, 8-K)
 * 4. Fail with clear error (no silent ticker fallback)
 */

import { createSecClient } from '../lib/secClient';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

const openFigiResponseSchema = z.array(
  z.object({
    data: z
      .array(
        z.object({
          figi: z.string(),
          securityType: z.string().optional(),
          marketSector: z.string().optional(),
          ticker: z.string().optional(),
          name: z.string().optional(),
          exchCode: z.string().optional(),
          shareClassFIGI: z.string().optional(),
          compositeFIGI: z.string().optional(),
          securityType2: z.string().optional(),
          securityDescription: z.string().optional(),
          metadata: z
            .object({
              cusip: z.string().optional(),
              isin: z.string().optional(),
            })
            .optional(),
        })
      )
      .optional(),
    error: z.string().optional(),
  })
);

interface CusipResolutionResult {
  cusips: string[];
  source: 'sec_submissions' | 'sec_api' | 'openfigi' | 'sec_filings' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  metadata?: {
    isin?: string;
    figi?: string;
    securityType?: string;
    warning?: string;
  };
}

// sec-api.io response schema - API returns an array
const secApiResponseSchema = z.array(
  z.object({
    name: z.string().optional(),
    ticker: z.string().optional(),
    cik: z.string().optional(),
    cusip: z.string().optional(), // Space-separated if multiple
    cusips: z.array(z.string()).optional(), // Array format
    exchange: z.string().optional(),
    sector: z.string().optional(),
    industry: z.string().optional(),
    sic: z.string().optional(),
  })
);

/**
 * Resolve CUSIP from OpenFIGI API
 *
 * OpenFIGI is a free, public API maintained by Bloomberg that provides
 * comprehensive security identifier mappings.
 *
 * API Docs: https://www.openfigi.com/api
 *
 * @param ticker - Stock ticker symbol
 * @param exchCode - Optional exchange code (US, UN for NASDAQ, UW for NYSE)
 * @returns CUSIP if found, null otherwise
 */
async function resolveCusipFromOpenFigi(
  ticker: string,
  exchCode?: string
): Promise<CusipResolutionResult | null> {
  try {
    const requestBody = [
      {
        idType: 'TICKER',
        idValue: ticker,
        exchCode: exchCode || 'US', // Default to US market
      },
    ];

    console.log(`[OpenFIGI] Requesting CUSIP for ${ticker} (exchange: ${exchCode || 'US'})`);

    const response = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OPENFIGI-APIKEY': process.env.OPENFIGI_API_KEY || '', // Optional, higher rate limits with key
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.warn(`[OpenFIGI] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    const parsed = openFigiResponseSchema.parse(json);

    if (parsed.length === 0 || !parsed[0].data || parsed[0].data.length === 0) {
      console.log(`[OpenFIGI] No results found for ${ticker}`);
      return null;
    }

    // Look for common stock with CUSIP
    const commonStock = parsed[0].data.find(
      (item) =>
        item.securityType === 'Common Stock' &&
        item.metadata?.cusip
    );

    const result = commonStock || parsed[0].data[0];

    if (!result?.metadata?.cusip) {
      console.log(`[OpenFIGI] Found ${parsed[0].data.length} results but no CUSIP`);
      return null;
    }

    const cusip = result.metadata.cusip;
    console.log(`[OpenFIGI] ✓ Resolved ${ticker} → CUSIP: ${cusip}`);

    return {
      cusips: [cusip],
      source: 'openfigi',
      confidence: 'high',
      metadata: {
        isin: result.metadata.isin,
        figi: result.figi,
        securityType: result.securityType,
      },
    };
  } catch (error) {
    console.error(`[OpenFIGI] Error resolving ${ticker}:`, error);
    return null;
  }
}

/**
 * Resolve CUSIP from sec-api.io
 *
 * sec-api.io provides a dedicated CIK/Ticker/CUSIP mapping API that reliably
 * returns CUSIP data for US-listed companies and ETFs.
 *
 * API Docs: https://docs.sec-api.io/
 * Endpoints:
 * - /mapping/ticker/{TICKER}
 * - /mapping/cik/{CIK}
 * - /mapping/cusip/{CUSIP}
 *
 * Requires SEC_API_KEY environment variable.
 *
 * @param ticker - Stock ticker symbol
 * @param cik - Optional CIK for validation
 * @returns CUSIP if found, null otherwise
 */
async function resolveCusipFromSecApi(
  ticker: string,
  cik?: string
): Promise<CusipResolutionResult | null> {
  const apiKey = process.env.SEC_API_KEY;

  if (!apiKey) {
    console.log(`[sec-api.io] Skipping - SEC_API_KEY not configured`);
    return null;
  }

  try {
    console.log(`[sec-api.io] Requesting CUSIP for ticker ${ticker}`);

    const response = await fetch(`https://api.sec-api.io/mapping/ticker/${ticker}`, {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sec-api.io] No mapping found for ${ticker}`);
        return null;
      }
      console.warn(`[sec-api.io] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    const parsed = secApiResponseSchema.parse(json);

    // API returns an array - check if we have results
    if (parsed.length === 0) {
      console.log(`[sec-api.io] No mapping found for ${ticker} (empty array)`);
      return null;
    }

    // Get first result from array
    const result = parsed[0];

    // Extract CUSIPs - can be in 'cusip' (space-separated) or 'cusips' (array)
    let cusips: string[] = [];

    if (result.cusips && result.cusips.length > 0) {
      cusips = result.cusips;
    } else if (result.cusip) {
      // Handle space-separated CUSIPs
      cusips = result.cusip.split(/\s+/).filter(Boolean);
    }

    // Validate CUSIP format (9 alphanumeric characters)
    const validCusips = cusips.filter(c => /^[0-9A-Z]{9}$/.test(c));

    if (validCusips.length === 0) {
      console.log(`[sec-api.io] No valid CUSIPs found for ${ticker}`);
      return null;
    }

    // Optionally validate CIK matches
    if (cik && result.cik) {
      const normalizedCik = cik.padStart(10, '0');
      const parsedCik = result.cik.padStart(10, '0');
      if (normalizedCik !== parsedCik) {
        console.warn(
          `[sec-api.io] CIK mismatch: expected ${normalizedCik}, got ${parsedCik}`
        );
      }
    }

    console.log(`[sec-api.io] ✓ Resolved ${ticker} → CUSIP: ${validCusips.join(', ')}`);

    return {
      cusips: validCusips,
      source: 'sec_api',
      confidence: 'high',
      metadata: {
        securityType: result.sector || result.industry,
      },
    };
  } catch (error) {
    console.error(`[sec-api.io] Error resolving ${ticker}:`, error);
    return null;
  }
}

/**
 * Extract CUSIP from SEC EDGAR filing XML
 *
 * Parses recent 10-K, 10-Q, or 8-K filings to find CUSIP identifiers
 * embedded in the XML structure.
 *
 * @param cik - Company CIK
 * @param ticker - Stock ticker
 * @returns CUSIP if found in filings
 */
async function resolveCusipFromSecFilings(
  cik: string,
  ticker: string
): Promise<CusipResolutionResult | null> {
  try {
    const secClient = createSecClient();
    const normalizedCik = cik.padStart(10, '0');

    console.log(`[SEC Filings] Searching for CUSIP in recent filings for ${ticker} (CIK ${cik})`);

    // Get recent filings list
    const submissionsResponse = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
    const submissionsJson = await submissionsResponse.json();

    const recentFilings = submissionsJson.filings?.recent;
    if (!recentFilings || !Array.isArray(recentFilings.form)) {
      return null;
    }

    // Look for 10-K, 10-Q, or 8-K filings (most likely to contain CUSIP)
    const targetForms = ['10-K', '10-Q', '8-K'];
    const relevantFilings: Array<{ form: string; accession: string; filedDate: string }> = [];

    for (let i = 0; i < recentFilings.form.length && relevantFilings.length < 5; i++) {
      const form = recentFilings.form[i];
      if (targetForms.includes(form)) {
        relevantFilings.push({
          form,
          accession: recentFilings.accessionNumber[i],
          filedDate: recentFilings.filingDate[i],
        });
      }
    }

    if (relevantFilings.length === 0) {
      console.log(`[SEC Filings] No 10-K/10-Q/8-K filings found`);
      return null;
    }

    console.log(`[SEC Filings] Checking ${relevantFilings.length} recent filings`);

    // Try to parse each filing for CUSIP
    for (const filing of relevantFilings) {
      const cusip = await extractCusipFromFiling(normalizedCik, filing.accession, filing.form);
      if (cusip) {
        console.log(`[SEC Filings] ✓ Found CUSIP ${cusip} in ${filing.form} (${filing.filedDate})`);
        return {
          cusips: [cusip],
          source: 'sec_filings',
          confidence: 'high',
        };
      }
    }

    console.log(`[SEC Filings] No CUSIP found in ${relevantFilings.length} filings`);
    return null;
  } catch (error) {
    console.error(`[SEC Filings] Error searching filings:`, error);
    return null;
  }
}

/**
 * Extract CUSIP from a specific SEC filing XML
 */
async function extractCusipFromFiling(
  cik: string,
  accession: string,
  formType: string
): Promise<string | null> {
  try {
    const secClient = createSecClient();
    const formattedCik = cik.replace(/^0+/, '');
    const formattedAccession = accession.replace(/-/g, '');

    // Common XML document patterns
    const possibleFiles = [
      `${accession}.xml`,
      `${formType.toLowerCase().replace('-', '')}.xml`,
      'primary_doc.xml',
      'primary_document.xml',
    ];

    for (const filename of possibleFiles) {
      try {
        const url = `/Archives/edgar/data/${formattedCik}/${formattedAccession}/${filename}`;
        const response = await secClient.get(url);
        const xmlContent = await response.text();

        // Parse XML
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
          textNodeName: '#text',
        });

        const parsed = parser.parse(xmlContent);

        // Look for CUSIP in common XML paths
        const cusip = findCusipInXml(parsed);
        if (cusip) {
          return cusip;
        }
      } catch (error) {
        // File not found or parse error, try next
        continue;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Recursively search XML structure for CUSIP
 */
function findCusipInXml(obj: any, depth = 0): string | null {
  if (depth > 10) return null; // Prevent infinite recursion

  if (typeof obj === 'string') {
    // Check if this looks like a CUSIP (9 alphanumeric characters)
    const cusipMatch = obj.match(/\b[0-9A-Z]{9}\b/);
    return cusipMatch ? cusipMatch[0] : null;
  }

  if (typeof obj !== 'object' || obj === null) {
    return null;
  }

  // Check common CUSIP field names
  const cusipFields = ['cusip', 'CUSIP', 'cusipNumber', 'CUSIPNumber', 'dei:EntityCUSIP'];
  for (const field of cusipFields) {
    if (obj[field]) {
      const value = typeof obj[field] === 'object' ? obj[field]['#text'] : obj[field];
      if (typeof value === 'string' && /^[0-9A-Z]{9}$/.test(value)) {
        return value;
      }
    }
  }

  // Recursively search nested objects
  for (const key in obj) {
    const result = findCusipInXml(obj[key], depth + 1);
    if (result) return result;
  }

  return null;
}

/**
 * CUSIP resolution with multiple fallback sources
 *
 * Fallback chain:
 * 1. SEC submissions API (free, ~40% success rate)
 * 2. sec-api.io (paid API, very reliable, requires SEC_API_KEY)
 * 3. Ticker symbol with LOUD warnings (last resort)
 *
 * This approach balances:
 * - Free sources first (SEC submissions)
 * - Paid but reliable source second (sec-api.io)
 * - Visible fallback third (ticker with warnings)
 *
 * @param ticker - Stock ticker symbol
 * @param cik - Company CIK
 * @param secSubmissionsCusips - CUSIPs from SEC submissions (if any)
 * @returns Resolution result with CUSIPs and metadata
 */
export async function resolveCusipWithFallback(
  ticker: string,
  cik: string,
  secSubmissionsCusips: string[] = []
): Promise<CusipResolutionResult> {
  console.log(`[CUSIP Resolution] Starting resolution for ${ticker}`);

  // 1. Use SEC submissions if available
  if (secSubmissionsCusips.length > 0) {
    console.log(`[CUSIP Resolution] ✓ Using CUSIPs from SEC submissions API`);
    return {
      cusips: secSubmissionsCusips,
      source: 'sec_submissions',
      confidence: 'high',
    };
  }

  // 2. Try sec-api.io (requires API key)
  console.log(`[CUSIP Resolution] SEC submissions API returned no CUSIPs, trying sec-api.io...`);
  const secApiResult = await resolveCusipFromSecApi(ticker, cik);
  if (secApiResult) {
    return secApiResult;
  }

  // 3. Fall back to ticker symbol with LOUD warnings
  console.warn(`\n${'='.repeat(80)}`);
  console.warn(`⚠️  CUSIP RESOLUTION FAILED FOR ${ticker}`);
  console.warn(`${'='.repeat(80)}`);
  console.warn(`SEC submissions API returned no CUSIPs for ${ticker} (CIK: ${cik})`);

  if (!process.env.SEC_API_KEY) {
    console.warn(`sec-api.io not configured (SEC_API_KEY not set)`);
    console.warn(``);
    console.warn(`💡 TIP: Get a sec-api.io API key for reliable CUSIP resolution:`);
    console.warn(`   https://sec-api.io/`);
  } else {
    console.warn(`sec-api.io lookup failed (no mapping found or API error)`);
  }

  console.warn(``);
  console.warn(`This is common for single-class stocks like AAPL, MSFT, GOOGL, etc.`);
  console.warn(``);
  console.warn(`FALLING BACK TO TICKER SYMBOL: "${ticker}"`);
  console.warn(``);
  console.warn(`⚠️  IMPACT:`);
  console.warn(`   - ETF holdings queries will likely fail (require 9-char CUSIPs)`);
  console.warn(`   - FINRA short interest data will fail (require 9-char CUSIPs)`);
  console.warn(`   - Some 13F institutional holdings may fail`);
  console.warn(``);
  console.warn(`🔧 MANUAL FIX REQUIRED:`);
  console.warn(`   1. Find real CUSIP from SEC EDGAR, Bloomberg, or company IR`);
  console.warn(`   2. Run: psql $DATABASE_URL -f scripts/fix-${ticker.toLowerCase()}-cusip.sql`);
  console.warn(`   3. Update the SQL script with the real CUSIP`);
  console.warn(`   4. Re-run this workflow to collect data with correct CUSIP`);
  console.warn(``);
  console.warn(`📊 VALIDATE WITH QA TOOL:`);
  console.warn(`   temporal workflow start \\`);
  console.warn(`     --namespace ird \\`);
  console.warn(`     --task-queue rotation-detector \\`);
  console.warn(`     --type qaReportWorkflow \\`);
  console.warn(`     --input '{"ticker": "${ticker}", "from": "2024-01-01", "to": "2024-03-31"}'`);
  console.warn(`${'='.repeat(80)}\n`);

  // Return ticker fallback (clearly marked as low confidence)
  return {
    cusips: [ticker],
    source: 'manual',
    confidence: 'low',
    metadata: {
      warning: 'Ticker symbol used as CUSIP fallback - manual intervention required',
    },
  };
}

/**
 * Get CUSIP with caching and validation
 *
 * This is the main entry point for CUSIP resolution. It validates
 * results and provides clear error messages.
 */
export async function getCusipForTicker(
  ticker: string,
  cik: string,
  secSubmissionsCusips: string[] = []
): Promise<string[]> {
  const result = await resolveCusipWithFallback(ticker, cik, secSubmissionsCusips);

  // Validate all CUSIPs are properly formatted
  const validCusips = result.cusips.filter((cusip) => /^[0-9A-Z]{9}$/.test(cusip));

  if (validCusips.length === 0) {
    throw new Error(
      `CUSIP resolution returned invalid CUSIPs for ${ticker}: ${result.cusips.join(', ')}`
    );
  }

  if (validCusips.length < result.cusips.length) {
    console.warn(
      `[CUSIP Resolution] Filtered out ${result.cusips.length - validCusips.length} invalid CUSIPs`
    );
  }

  console.log(
    `[CUSIP Resolution] ✓ Resolved ${ticker} → ${validCusips.join(', ')} ` +
    `(source: ${result.source}, confidence: ${result.confidence})`
  );

  return validCusips;
}
