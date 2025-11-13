import { createSupabaseClient } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSecClient } from '../lib/secClient';

interface QAReportInput {
  ticker: string;
  from: string;
  to: string;
  minPct?: number;
}

interface QAReportOutput {
  ticker: string;
  cik: string | null;
  dateRange: { from: string; to: string };

  // Entity & Reference Data
  entity: {
    exists: boolean;
    entityId?: string;
    name?: string;
    kind?: string;
  };

  cusips: {
    fromDatabase: string[];
    fromSecApi: string[];
    missing: string[];
    usingTickerFallback: boolean;
  };

  // Holdings Data
  holdings13F: {
    totalFilings: number;
    totalPositions: number;
    dateRange: { earliest: string | null; latest: string | null };
    topHolders: Array<{ holder: string; shares: number; date: string }>;
  };

  etfHoldings: {
    totalPositions: number;
    dateRange: { earliest: string | null; latest: string | null };
    byFund: Array<{ fund: string; positions: number; latestDate: string | null }>;
  };

  shortInterest: {
    totalRecords: number;
    dateRange: { earliest: string | null; latest: string | null };
    latestData: Array<{ date: string; shortVolume: number; totalVolume: number }>;
  };

  // Filings
  filings: {
    total: number;
    byForm: Record<string, number>;
    dateRange: { earliest: string | null; latest: string | null };
  };

  // Issues & Recommendations
  issues: string[];
  recommendations: string[];
}

/**
 * QA Activity: Comprehensive diagnostic report for ticker ingestion
 *
 * This activity generates a detailed report showing what data was actually
 * ingested vs what should have been ingested, identifying gaps and issues.
 */
export async function generateQAReport(input: QAReportInput): Promise<QAReportOutput> {
  const supabase = createSupabaseClient();
  const { ticker, from, to, minPct } = input;
  const normalizedTicker = ticker.toUpperCase();

  const issues: string[] = [];
  const recommendations: string[] = [];

  console.log(`[QA] Generating report for ${normalizedTicker} from ${from} to ${to}`);

  // 1. Entity & CIK Resolution
  const entityData = await checkEntity(supabase, normalizedTicker);
  const cik = entityData.entity.cik;

  if (!entityData.entity.exists) {
    issues.push(`Entity record not found for ${normalizedTicker}`);
    recommendations.push(`Run resolveCIK activity to create entity`);
  }

  // 2. CUSIP Verification
  const cusipData = await checkCusips(supabase, cik, normalizedTicker);

  if (cusipData.usingTickerFallback) {
    issues.push(`No real CUSIP found - using ticker symbol as fallback`);
    recommendations.push(`Verify SEC submissions API response contains 'tickers' field with CUSIP data`);
  }

  if (cusipData.missing.length > 0) {
    issues.push(`${cusipData.missing.length} CUSIPs from SEC API not in database: ${cusipData.missing.join(', ')}`);
    recommendations.push(`Run upsertCusipMapping to sync missing CUSIPs`);
  }

  // 3. 13F Holdings
  const holdings13F = await check13FHoldings(supabase, cusipData.fromDatabase, from, to);

  if (holdings13F.totalPositions === 0) {
    issues.push(`No 13F holdings found for date range ${from} to ${to}`);
    recommendations.push(`Verify 13F filings were ingested for this period`);
  }

  // 4. ETF Holdings
  const etfHoldings = await checkEtfHoldings(supabase, cusipData.fromDatabase, from, to);

  if (etfHoldings.totalPositions === 0 && cusipData.fromDatabase.length > 0) {
    issues.push(`No ETF holdings found despite having ${cusipData.fromDatabase.length} CUSIPs`);
    recommendations.push(`Run fetchDailyHoldings activity to ingest ETF data`);
  } else if (etfHoldings.totalPositions === 0 && cusipData.fromDatabase.length === 0) {
    issues.push(`No ETF holdings found (no CUSIPs to search)`);
    recommendations.push(`Fix CUSIP resolution first, then run fetchDailyHoldings`);
  }

  // 5. Short Interest
  const shortInterest = await checkShortInterest(supabase, cusipData.fromDatabase, from, to);

  if (shortInterest.totalRecords === 0) {
    issues.push(`No FINRA short interest data found for date range`);
    recommendations.push(`Verify FINRA data availability for this ticker and date range`);
  }

  // 6. Filings
  const filings = await checkFilings(supabase, cik, from, to);

  if (filings.total === 0 && cik) {
    issues.push(`No SEC filings found for CIK ${cik}`);
    recommendations.push(`Run filing ingestion activities to populate filings table`);
  }

  return {
    ticker: normalizedTicker,
    cik,
    dateRange: { from, to },
    entity: entityData.entity,
    cusips: cusipData,
    holdings13F,
    etfHoldings,
    shortInterest,
    filings,
    issues,
    recommendations,
  };
}

async function checkEntity(supabase: SupabaseClient, ticker: string) {
  const { data, error } = await supabase
    .from('entities')
    .select('entity_id, cik, name, kind')
    .eq('ticker', ticker)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return {
    entity: data ? {
      exists: true,
      entityId: data.entity_id,
      cik: data.cik,
      name: data.name,
      kind: data.kind,
    } : {
      exists: false,
      cik: null,
    },
  };
}

async function checkCusips(supabase: SupabaseClient, cik: string | null, ticker: string) {
  // Get CUSIPs from database
  const dbCusips: string[] = [];
  if (cik) {
    const { data } = await supabase
      .from('cusip_issuer_map')
      .select('cusip')
      .eq('issuer_cik', cik);

    if (data) {
      dbCusips.push(...data.map(row => row.cusip).filter(Boolean));
    }
  }

  // Get CUSIPs from SEC API
  const secCusips: string[] = [];
  if (cik) {
    try {
      const secClient = createSecClient();
      const normalizedCik = cik.padStart(10, '0');
      const response = await secClient.get(`/submissions/CIK${normalizedCik}.json`);
      const json = await response.json();

      // Extract CUSIPs from tickers field
      if (json.tickers && Array.isArray(json.tickers)) {
        for (const tickerEntry of json.tickers) {
          if (tickerEntry.cusip && tickerEntry.cusip.length === 9) {
            secCusips.push(tickerEntry.cusip);
          }
        }
      }
    } catch (error) {
      console.warn(`[QA] Failed to fetch SEC submissions for CIK ${cik}:`, error);
    }
  }

  const dbSet = new Set(dbCusips);
  const secSet = new Set(secCusips);
  const missing = secCusips.filter(cusip => !dbSet.has(cusip));

  // Check if using ticker fallback (ticker symbol stored as CUSIP)
  const usingTickerFallback = dbCusips.includes(ticker) && secCusips.length > 0;

  return {
    fromDatabase: dbCusips,
    fromSecApi: secCusips,
    missing,
    usingTickerFallback,
  };
}

async function check13FHoldings(
  supabase: SupabaseClient,
  cusips: string[],
  from: string,
  to: string
) {
  if (cusips.length === 0) {
    return {
      totalFilings: 0,
      totalPositions: 0,
      dateRange: { earliest: null, latest: null },
      topHolders: [],
    };
  }

  // Get total positions
  const { data: positions, count } = await supabase
    .from('uhf_positions')
    .select('holder_id, cusip, asof, shares, source', { count: 'exact' })
    .in('cusip', cusips)
    .eq('source', '13F')
    .gte('asof', from)
    .lte('asof', to)
    .order('shares', { ascending: false })
    .limit(100);

  if (!positions || positions.length === 0) {
    return {
      totalFilings: 0,
      totalPositions: 0,
      dateRange: { earliest: null, latest: null },
      topHolders: [],
    };
  }

  // Get date range
  const dates = positions.map(p => p.asof).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  // Get top holders with names
  const holderIds = Array.from(new Set(positions.slice(0, 10).map(p => p.holder_id)));
  const { data: holders } = await supabase
    .from('entities')
    .select('entity_id, name')
    .in('entity_id', holderIds);

  const holderMap = new Map(holders?.map(h => [h.entity_id, h.name]) || []);

  const topHolders = positions.slice(0, 10).map(p => ({
    holder: holderMap.get(p.holder_id) || p.holder_id,
    shares: p.shares,
    date: p.asof,
  }));

  // Count unique filings (holder + date combinations)
  const filingSet = new Set(positions.map(p => `${p.holder_id}:${p.asof}`));

  return {
    totalFilings: filingSet.size,
    totalPositions: count || 0,
    dateRange: { earliest, latest },
    topHolders,
  };
}

async function checkEtfHoldings(
  supabase: SupabaseClient,
  cusips: string[],
  from: string,
  to: string
) {
  if (cusips.length === 0) {
    return {
      totalPositions: 0,
      dateRange: { earliest: null, latest: null },
      byFund: [],
    };
  }

  const { data: positions, count } = await supabase
    .from('uhf_positions')
    .select('holder_id, cusip, asof, shares, source', { count: 'exact' })
    .in('cusip', cusips)
    .eq('source', 'ETF')
    .gte('asof', from)
    .lte('asof', to);

  if (!positions || positions.length === 0) {
    return {
      totalPositions: 0,
      dateRange: { earliest: null, latest: null },
      byFund: [],
    };
  }

  // Get date range
  const dates = positions.map(p => p.asof).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  // Group by fund
  const fundMap = new Map<string, { positions: number; latestDate: string }>();
  for (const pos of positions) {
    const existing = fundMap.get(pos.holder_id);
    if (!existing || pos.asof > existing.latestDate) {
      fundMap.set(pos.holder_id, {
        positions: (existing?.positions || 0) + 1,
        latestDate: pos.asof,
      });
    }
  }

  // Get fund names
  const holderIds = Array.from(fundMap.keys());
  const { data: holders } = await supabase
    .from('entities')
    .select('entity_id, ticker')
    .in('entity_id', holderIds);

  const holderTickerMap = new Map(holders?.map(h => [h.entity_id, h.ticker]) || []);

  const byFund = Array.from(fundMap.entries()).map(([holderId, stats]) => ({
    fund: holderTickerMap.get(holderId) || holderId,
    positions: stats.positions,
    latestDate: stats.latestDate,
  })).sort((a, b) => b.positions - a.positions);

  return {
    totalPositions: count || 0,
    dateRange: { earliest, latest },
    byFund,
  };
}

async function checkShortInterest(
  supabase: SupabaseClient,
  cusips: string[],
  from: string,
  to: string
) {
  if (cusips.length === 0) {
    return {
      totalRecords: 0,
      dateRange: { earliest: null, latest: null },
      latestData: [],
    };
  }

  const { data: records, count } = await supabase
    .from('finra_short_interest')
    .select('cusip, date, short_volume, total_volume', { count: 'exact' })
    .in('cusip', cusips)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .limit(10);

  if (!records || records.length === 0) {
    return {
      totalRecords: 0,
      dateRange: { earliest: null, latest: null },
      latestData: [],
    };
  }

  const dates = records.map(r => r.date).sort();

  return {
    totalRecords: count || 0,
    dateRange: { earliest: dates[0], latest: dates[dates.length - 1] },
    latestData: records.map(r => ({
      date: r.date,
      shortVolume: r.short_volume || 0,
      totalVolume: r.total_volume || 0,
    })),
  };
}

async function checkFilings(
  supabase: SupabaseClient,
  cik: string | null,
  from: string,
  to: string
) {
  if (!cik) {
    return {
      total: 0,
      byForm: {},
      dateRange: { earliest: null, latest: null },
    };
  }

  const { data: filings, count } = await supabase
    .from('filings')
    .select('form, filed_date', { count: 'exact' })
    .eq('cik', cik)
    .gte('filed_date', from)
    .lte('filed_date', to);

  if (!filings || filings.length === 0) {
    return {
      total: 0,
      byForm: {},
      dateRange: { earliest: null, latest: null },
    };
  }

  const byForm: Record<string, number> = {};
  for (const filing of filings) {
    byForm[filing.form] = (byForm[filing.form] || 0) + 1;
  }

  const dates = filings.map(f => f.filed_date).sort();

  return {
    total: count || 0,
    byForm,
    dateRange: { earliest: dates[0], latest: dates[dates.length - 1] },
  };
}

/**
 * Export QA report as formatted JSON for analysis
 */
export async function exportQAReport(input: QAReportInput): Promise<string> {
  const report = await generateQAReport(input);
  return JSON.stringify(report, null, 2);
}
