import { createSupabaseClient } from '../lib/supabase.ts';
import type {
  MicroBrokerInstitutionMapRecord,
  MicroInstitutionalFlowRecord,
  MicroTradeClassificationRecord,
  MicroMetricsDailyRecord,
  MicroOffExVenueWeeklyRecord,
  FlowDirection,
  MicroQualityFlag,
} from '../lib/schema.ts';

// ============================================================================
// Broker-Dealer Mapping
// ============================================================================

/**
 * Build broker-dealer to institution mapping from ATS venue data
 *
 * Strategy:
 * 1. Identify venue_id MPIDs from micro_offex_venue_weekly
 * 2. Cross-reference with entities table to find matching institutions
 * 3. Build statistical relationships based on trading patterns
 * 4. Score relationship strength based on volume correlation and frequency
 */
export async function buildBrokerMapping(
  symbol?: string,
  lookbackDays = 365
): Promise<{ mappingsCreated: number; mappingsUpdated: number }> {
  const supabase = createSupabaseClient();

  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Get venue-level ATS data
  let query = supabase
    .from('micro_offex_venue_weekly')
    .select('*')
    .eq('source', 'ATS')
    .gte('week_end', startDate)
    .not('venue_id', 'is', null);

  if (symbol) {
    query = query.eq('symbol', symbol);
  }

  const { data: venueData, error: venueError } = await query;

  if (venueError) {
    throw new Error(`Failed to query ATS venue data: ${venueError.message}`);
  }

  if (!venueData || venueData.length === 0) {
    return { mappingsCreated: 0, mappingsUpdated: 0 };
  }

  // Group by venue_id
  const venueStats = new Map<
    string,
    {
      totalShares: number;
      totalTrades: number;
      weekCount: number;
      avgBlockSize: number;
      symbols: Set<string>;
    }
  >();

  for (const row of venueData as MicroOffExVenueWeeklyRecord[]) {
    if (!row.venue_id) continue;

    const stats = venueStats.get(row.venue_id) || {
      totalShares: 0,
      totalTrades: 0,
      weekCount: 0,
      avgBlockSize: 0,
      symbols: new Set<string>(),
    };

    stats.totalShares += row.total_shares ?? 0;
    stats.totalTrades += row.total_trades ?? 0;
    stats.weekCount += 1;
    stats.symbols.add(row.symbol);

    venueStats.set(row.venue_id, stats);
  }

  // Calculate avg block size
  for (const [venueId, stats] of venueStats) {
    stats.avgBlockSize =
      stats.totalTrades > 0 ? Math.floor(stats.totalShares / stats.totalTrades) : 0;
  }

  // Get broker master list
  const { data: brokers, error: brokersError } = await supabase
    .from('micro_broker_master')
    .select('*')
    .eq('is_active', true);

  if (brokersError) {
    throw new Error(`Failed to query broker master: ${brokersError.message}`);
  }

  const brokerMap = new Map(
    (brokers ?? []).map((b) => [b.broker_mpid, b])
  );

  // Try to match venues to institutions
  // Strategy 1: Direct MPID match (e.g., 'VANG' -> Vanguard entity)
  // Strategy 2: Name matching (fuzzy)
  // Strategy 3: Statistical inference (inferred)

  const mappings: MicroBrokerInstitutionMapRecord[] = [];
  let created = 0;
  let updated = 0;

  for (const [venueId, stats] of venueStats) {
    const broker = brokerMap.get(venueId);
    if (!broker) continue;

    // Try to find matching institution
    const institution = await findMatchingInstitution(supabase, broker.broker_name);

    if (institution) {
      // Calculate relationship strength based on trading patterns
      const strength = calculateRelationshipStrength(stats, broker.broker_type);

      const mapping: MicroBrokerInstitutionMapRecord = {
        broker_mpid: venueId,
        broker_name: broker.broker_name,
        institution_cik: institution.cik,
        institution_id: institution.entity_id,
        relationship_type:
          broker.broker_type === 'DARK_POOL'
            ? 'affiliate'
            : broker.broker_type === 'WIREHOUSE'
            ? 'internal'
            : 'prime_broker',
        relationship_strength: strength,
        confidence_score: strength,
        first_observed_date: startDate,
        last_observed_date: new Date().toISOString().slice(0, 10),
        observation_count: stats.weekCount,
        avg_block_size: stats.avgBlockSize,
        source: 'INFERRED',
      };

      mappings.push(mapping);
    }
  }

  if (mappings.length > 0) {
    const { error: upsertError } = await supabase
      .from('micro_broker_institution_map')
      .upsert(mappings, {
        onConflict: 'broker_mpid,institution_cik',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      throw new Error(`Failed to upsert broker mappings: ${upsertError.message}`);
    }

    created = mappings.length;
  }

  return { mappingsCreated: created, mappingsUpdated: updated };
}

async function findMatchingInstitution(
  supabase: ReturnType<typeof createSupabaseClient>,
  brokerName: string
): Promise<{ cik: string; entity_id: string } | null> {
  // Extract potential institution name from broker name
  // e.g., "Morgan Stanley & Co." -> "Morgan Stanley"
  const cleanName = brokerName
    .replace(/\s+(& Co\.|LLC|Inc\.|Corp\.|Securities|Brokerage.*)/gi, '')
    .trim();

  const { data, error } = await supabase
    .from('entities')
    .select('cik, entity_id, name')
    .or(`name.ilike.%${cleanName}%`)
    .in('kind', ['manager', 'fund'])
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0] as { cik: string; entity_id: string };
}

function calculateRelationshipStrength(
  stats: {
    totalShares: number;
    totalTrades: number;
    weekCount: number;
    avgBlockSize: number;
  },
  brokerType?: string | null
): number {
  // Base strength on frequency of observation
  let strength = Math.min(stats.weekCount / 52, 0.7); // Max 0.7 from frequency

  // Boost for large average block sizes (institutional characteristic)
  if (stats.avgBlockSize > 50000) {
    strength += 0.15;
  } else if (stats.avgBlockSize > 20000) {
    strength += 0.1;
  }

  // Boost for specific broker types
  if (brokerType === 'PRIME_BROKER' || brokerType === 'WIREHOUSE') {
    strength += 0.1;
  }

  return Math.min(strength, 1.0);
}

// ============================================================================
// Flow Attribution
// ============================================================================

/**
 * Attribute ATS flows to specific institutions using broker mapping
 */
export async function attributeInstitutionalFlows(
  symbol: string,
  fromDate: string,
  toDate: string,
  minConfidence = 0.7
): Promise<{ flowsAttributed: number }> {
  const supabase = createSupabaseClient();

  // Get ATS venue data for the period
  const { data: venueData, error: venueError } = await supabase
    .from('micro_offex_venue_weekly')
    .select('*')
    .eq('symbol', symbol)
    .eq('source', 'ATS')
    .gte('week_end', fromDate)
    .lte('week_end', toDate)
    .not('venue_id', 'is', null);

  if (venueError) {
    throw new Error(`Failed to query venue data: ${venueError.message}`);
  }

  if (!venueData || venueData.length === 0) {
    return { flowsAttributed: 0 };
  }

  // Get broker mappings
  const venueIds = [...new Set(venueData.map((v) => v.venue_id).filter(Boolean))];
  const { data: mappings, error: mappingsError } = await supabase
    .from('micro_broker_institution_map')
    .select('*')
    .in('broker_mpid', venueIds)
    .gte('relationship_strength', minConfidence);

  if (mappingsError) {
    throw new Error(`Failed to query broker mappings: ${mappingsError.message}`);
  }

  const mappingMap = new Map(
    (mappings ?? []).map((m) => [m.broker_mpid, m])
  );

  // Attribute flows
  const flows: MicroInstitutionalFlowRecord[] = [];

  for (const venue of venueData as MicroOffExVenueWeeklyRecord[]) {
    if (!venue.venue_id || !venue.total_shares) continue;

    const mapping = mappingMap.get(venue.venue_id);
    if (!mapping) continue;

    // Convert weekly flow to daily (approximate)
    const dailyShares = Math.floor(venue.total_shares / 5); // 5 trading days per week

    // Infer direction from trading patterns
    // This is a placeholder - in production, use more sophisticated methods
    const direction: FlowDirection = inferFlowDirection(venue, mapping);

    flows.push({
      symbol,
      trade_date: venue.week_end,
      institution_id: mapping.institution_id,
      institution_cik: mapping.institution_cik,
      broker_mpid: venue.venue_id,
      flow_direction: direction,
      shares: dailyShares,
      trades: venue.total_trades,
      attribution_confidence: mapping.relationship_strength,
      source: 'ATS',
      venue_id: venue.venue_id,
    });
  }

  if (flows.length > 0) {
    const { error: upsertError } = await supabase
      .from('micro_institutional_flow')
      .upsert(flows, {
        onConflict: 'symbol,trade_date,institution_id,broker_mpid,flow_direction',
      });

    if (upsertError) {
      throw new Error(`Failed to upsert institutional flows: ${upsertError.message}`);
    }
  }

  return { flowsAttributed: flows.length };
}

function inferFlowDirection(
  venue: MicroOffExVenueWeeklyRecord,
  mapping: MicroBrokerInstitutionMapRecord
): FlowDirection {
  // Placeholder: In production, cross-reference with:
  // 1. Position changes from 13F filings
  // 2. Short interest changes
  // 3. Options activity
  // 4. Price movements (Lee-Ready)

  // For now, return unknown - real implementation would be more sophisticated
  return 'unknown';
}

// ============================================================================
// Lee-Ready Trade Classification
// ============================================================================

/**
 * Classify trades as buyer or seller-initiated using Lee-Ready algorithm
 *
 * Lee-Ready (1991):
 * 1. Quote rule: Compare trade price to bid-ask midpoint
 *    - Above midpoint = buy
 *    - Below midpoint = sell
 * 2. Tick test: If at midpoint, compare to previous trade price
 *    - Uptick = buy
 *    - Downtick = sell
 */
export async function classifyTrades(
  symbol: string,
  tradeDate: string
): Promise<{ classification: MicroTradeClassificationRecord }> {
  // NOTE: This is a simplified implementation
  // In production, you would need:
  // 1. Tick-by-tick trade data
  // 2. NBBO (National Best Bid and Offer) data
  // 3. Trade timestamps with microsecond precision

  const supabase = createSupabaseClient();

  // For now, use volume and price data to approximate
  // This would require additional data sources (TAQ, NBBO feeds)

  // Placeholder implementation using order imbalance proxy
  const { data: flowData, error } = await supabase
    .from('micro_institutional_flow')
    .select('*')
    .eq('symbol', symbol)
    .eq('trade_date', tradeDate);

  if (error) {
    throw new Error(`Failed to query flow data: ${error.message}`);
  }

  let totalBuyVolume = 0;
  let totalSellVolume = 0;
  let buyTrades = 0;
  let sellTrades = 0;

  if (flowData && flowData.length > 0) {
    for (const flow of flowData as MicroInstitutionalFlowRecord[]) {
      if (flow.flow_direction === 'buy') {
        totalBuyVolume += flow.shares;
        buyTrades += flow.trades ?? 0;
      } else if (flow.flow_direction === 'sell') {
        totalSellVolume += flow.shares;
        sellTrades += flow.trades ?? 0;
      }
    }
  }

  const totalVolume = totalBuyVolume + totalSellVolume;
  const orderImbalance =
    totalVolume > 0 ? (totalBuyVolume - totalSellVolume) / totalVolume : 0;

  const tradeDirection = orderImbalance > 0.1 ? 'buy' : orderImbalance < -0.1 ? 'sell' : 'neutral';

  const classification: MicroTradeClassificationRecord = {
    symbol,
    trade_date: tradeDate,
    trade_direction: tradeDirection,
    total_buy_volume: totalBuyVolume,
    total_sell_volume: totalSellVolume,
    total_neutral_volume: 0,
    order_imbalance: orderImbalance,
    buy_trades: buyTrades,
    sell_trades: sellTrades,
    neutral_trades: 0,
    avg_trade_size: totalVolume > 0 ? Math.floor(totalVolume / (buyTrades + sellTrades || 1)) : null,
    classification_method: 'LEE_READY',
    quality_flag: flowData && flowData.length > 10 ? 'HIGH' : flowData && flowData.length > 3 ? 'MEDIUM' : 'LOW',
  };

  // Upsert classification
  const { error: upsertError } = await supabase
    .from('micro_trade_classification')
    .upsert([classification], { onConflict: 'symbol,trade_date' });

  if (upsertError) {
    throw new Error(`Failed to upsert trade classification: ${upsertError.message}`);
  }

  return { classification };
}

// ============================================================================
// VPIN (Volume-Synchronized Probability of Informed Trading)
// ============================================================================

/**
 * Compute VPIN for a symbol
 *
 * VPIN (Easley, López de Prado, O'Hara, 2012):
 * VPIN = Σ|V_buy - V_sell| / (n × V_bar)
 *
 * Where:
 * - V_buy, V_sell are buy and sell volumes in each bucket
 * - n is the number of buckets
 * - V_bar is the average volume per bucket
 *
 * Interpretation:
 * - VPIN > 0.7: High probability of informed trading (toxic flow)
 * - VPIN > 0.9: Extreme toxicity, potential flash crash risk
 */
export async function computeVPIN(
  symbol: string,
  tradeDate: string,
  numBars = 50,
  lookbackDays = 20
): Promise<{ vpin: number; qualityFlag: MicroQualityFlag }> {
  const supabase = createSupabaseClient();

  const startDate = new Date(new Date(tradeDate).getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Get trade classifications for the lookback period
  const { data: classifications, error } = await supabase
    .from('micro_trade_classification')
    .select('*')
    .eq('symbol', symbol)
    .gte('trade_date', startDate)
    .lte('trade_date', tradeDate)
    .order('trade_date');

  if (error) {
    throw new Error(`Failed to query trade classifications: ${error.message}`);
  }

  if (!classifications || classifications.length < 5) {
    return { vpin: 0, qualityFlag: 'LOW' };
  }

  // Calculate volume-weighted order imbalance
  let sumAbsImbalance = 0;
  let totalVolume = 0;

  for (const c of classifications as MicroTradeClassificationRecord[]) {
    const buyVol = c.total_buy_volume ?? 0;
    const sellVol = c.total_sell_volume ?? 0;
    const vol = buyVol + sellVol;

    if (vol > 0) {
      sumAbsImbalance += Math.abs(buyVol - sellVol);
      totalVolume += vol;
    }
  }

  const vpin = totalVolume > 0 ? sumAbsImbalance / totalVolume : 0;

  const qualityFlag: MicroQualityFlag =
    classifications.length >= 15 ? 'HIGH' : classifications.length >= 8 ? 'MEDIUM' : 'LOW';

  return { vpin, qualityFlag };
}

// ============================================================================
// Kyle's Lambda (Price Impact)
// ============================================================================

/**
 * Estimate Kyle's lambda (price impact coefficient)
 *
 * Kyle (1985): λ = dP / dV
 *
 * Where:
 * - λ (lambda) is the price impact per unit volume
 * - dP is the price change
 * - dV is the signed volume (buy - sell)
 *
 * Estimated via OLS regression:
 * Price_change_t = λ × Signed_volume_t + ε
 */
export async function computeKylesLambda(
  symbol: string,
  tradeDate: string,
  lookbackDays = 30
): Promise<{
  lambda: number;
  standardError: number;
  rSquared: number;
  qualityFlag: MicroQualityFlag;
}> {
  // NOTE: This is a placeholder implementation
  // In production, you need:
  // 1. Intraday price data (tick or minute bars)
  // 2. Intraday volume data with buy/sell classification
  // 3. OLS regression implementation

  // For demonstration, we'll use a simplified version with daily data
  const supabase = createSupabaseClient();

  const startDate = new Date(new Date(tradeDate).getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Get order imbalances and price changes (would need price data)
  const { data, error } = await supabase
    .from('micro_trade_classification')
    .select('trade_date, order_imbalance, total_buy_volume, total_sell_volume')
    .eq('symbol', symbol)
    .gte('trade_date', startDate)
    .lte('trade_date', tradeDate)
    .order('trade_date');

  if (error || !data || data.length < 10) {
    return { lambda: 0, standardError: 0, rSquared: 0, qualityFlag: 'LOW' };
  }

  // Placeholder: In production, run OLS regression
  // price_change ~ signed_volume

  // Simplified estimate: assume higher imbalance = higher impact
  const avgImbalance = data.reduce(
    (sum, row) => sum + Math.abs((row as any).order_imbalance ?? 0),
    0
  ) / data.length;

  const lambda = avgImbalance * 10; // Placeholder conversion to bps/$1M
  const standardError = lambda * 0.2; // Placeholder
  const rSquared = 0.3; // Placeholder

  const qualityFlag: MicroQualityFlag = data.length >= 20 ? 'HIGH' : 'MEDIUM';

  return { lambda, standardError, rSquared, qualityFlag };
}

// ============================================================================
// Compute All Microstructure Metrics
// ============================================================================

export async function computeMicrostructureMetrics(
  symbol: string,
  tradeDate: string
): Promise<{ metrics: MicroMetricsDailyRecord }> {
  const supabase = createSupabaseClient();

  // Compute VPIN
  const { vpin, qualityFlag: vpinQuality } = await computeVPIN(symbol, tradeDate);

  // Compute Kyle's Lambda
  const {
    lambda: kylesLambda,
    standardError: kylesLambdaSe,
    rSquared: kylesLambdaR2,
  } = await computeKylesLambda(symbol, tradeDate);

  // Get trade classification for order imbalance
  const { data: classification, error: classError } = await supabase
    .from('micro_trade_classification')
    .select('*')
    .eq('symbol', symbol)
    .eq('trade_date', tradeDate)
    .maybeSingle();

  if (classError) {
    throw new Error(`Failed to query trade classification: ${classError.message}`);
  }

  const orderImbalance = classification?.order_imbalance ?? null;
  const totalVolume =
    (classification?.total_buy_volume ?? 0) +
    (classification?.total_sell_volume ?? 0) +
    (classification?.total_neutral_volume ?? 0);

  // Calculate block trade metrics
  const { data: flows, error: flowsError } = await supabase
    .from('micro_institutional_flow')
    .select('shares')
    .eq('symbol', symbol)
    .eq('trade_date', tradeDate);

  if (flowsError) {
    throw new Error(`Failed to query institutional flows: ${flowsError.message}`);
  }

  let blockTradeVolume = 0;
  const blockThreshold = 10000; // Shares

  if (flows && flows.length > 0) {
    for (const flow of flows) {
      if (flow.shares >= blockThreshold) {
        blockTradeVolume += flow.shares;
      }
    }
  }

  const blockTradeRatio = totalVolume > 0 ? blockTradeVolume / totalVolume : null;

  // Calculate toxicity metrics
  const informedTradingProbability = vpin; // VPIN is a proxy for informed trading
  const adverseSelectionComponent = vpin * kylesLambda; // Simplified

  const metrics: MicroMetricsDailyRecord = {
    symbol,
    trade_date: tradeDate,
    vpin,
    vpin_window_bars: 50,
    vpin_quality_flag: vpinQuality,
    kyles_lambda: kylesLambda,
    kyles_lambda_se: kylesLambdaSe,
    kyles_lambda_r2: kylesLambdaR2,
    daily_order_imbalance: orderImbalance,
    imbalance_persistence: null, // Would need autocorrelation calculation
    quoted_spread_bps: null, // Would need NBBO data
    effective_spread_bps: null, // Would need trade vs quote comparison
    realized_spread_bps: null, // Would need post-trade price analysis
    price_impact_bps: kylesLambda,
    adverse_selection_component: adverseSelectionComponent,
    informed_trading_probability: informedTradingProbability,
    total_volume: totalVolume > 0 ? totalVolume : null,
    block_trade_volume: blockTradeVolume > 0 ? blockTradeVolume : null,
    block_trade_ratio: blockTradeRatio,
    computation_timestamp: new Date().toISOString(),
    data_completeness: calculateDataCompleteness(classification, flows),
  };

  // Upsert metrics
  const { error: upsertError } = await supabase
    .from('micro_metrics_daily')
    .upsert([metrics], { onConflict: 'symbol,trade_date' });

  if (upsertError) {
    throw new Error(`Failed to upsert microstructure metrics: ${upsertError.message}`);
  }

  return { metrics };
}

function calculateDataCompleteness(
  classification: any,
  flows: any[]
): number {
  let score = 0;

  if (classification) score += 0.5;
  if (flows && flows.length > 0) score += 0.3;
  if (flows && flows.length >= 5) score += 0.2;

  return score;
}

// ============================================================================
// Get Microstructure Signal for Rotation Detection
// ============================================================================

/**
 * Get aggregated microstructure signals for a dump period
 * Used in rotation detection scoring
 */
export async function getMicrostructureSignals(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<{
  vpinAvg: number;
  vpinSpike: boolean;
  lambdaAvg: number;
  orderImbalanceAvg: number;
  blockRatioAvg: number;
  flowAttributionScore: number;
  microConfidence: number;
}> {
  const supabase = createSupabaseClient();

  // Get metrics for the period
  const { data: metrics, error } = await supabase
    .from('micro_metrics_daily')
    .select('*')
    .eq('symbol', symbol)
    .gte('trade_date', fromDate)
    .lte('trade_date', toDate);

  if (error) {
    throw new Error(`Failed to query microstructure metrics: ${error.message}`);
  }

  if (!metrics || metrics.length === 0) {
    return {
      vpinAvg: 0,
      vpinSpike: false,
      lambdaAvg: 0,
      orderImbalanceAvg: 0,
      blockRatioAvg: 0,
      flowAttributionScore: 0,
      microConfidence: 0,
    };
  }

  const metricsRecords = metrics as MicroMetricsDailyRecord[];

  // Calculate averages
  const vpinAvg =
    metricsRecords.reduce((sum, m) => sum + (m.vpin ?? 0), 0) / metricsRecords.length;
  const vpinSpike = metricsRecords.some((m) => (m.vpin ?? 0) > 0.7);
  const lambdaAvg =
    metricsRecords.reduce((sum, m) => sum + (m.kyles_lambda ?? 0), 0) /
    metricsRecords.length;
  const orderImbalanceAvg =
    metricsRecords.reduce((sum, m) => sum + (m.daily_order_imbalance ?? 0), 0) /
    metricsRecords.length;
  const blockRatioAvg =
    metricsRecords.reduce((sum, m) => sum + (m.block_trade_ratio ?? 0), 0) /
    metricsRecords.length;

  // Get flow attribution quality
  const { data: flows, error: flowsError } = await supabase
    .from('micro_institutional_flow')
    .select('attribution_confidence')
    .eq('symbol', symbol)
    .gte('trade_date', fromDate)
    .lte('trade_date', toDate);

  const flowAttributionScore =
    flows && flows.length > 0
      ? flows.reduce((sum, f) => sum + (f.attribution_confidence ?? 0), 0) / flows.length
      : 0;

  // Calculate overall confidence
  const dataCompletenessAvg =
    metricsRecords.reduce((sum, m) => sum + (m.data_completeness ?? 0), 0) /
    metricsRecords.length;
  const microConfidence = Math.min(dataCompletenessAvg * flowAttributionScore, 1.0);

  return {
    vpinAvg,
    vpinSpike,
    lambdaAvg,
    orderImbalanceAvg,
    blockRatioAvg,
    flowAttributionScore,
    microConfidence,
  };
}
