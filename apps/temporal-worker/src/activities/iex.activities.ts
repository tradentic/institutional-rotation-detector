import { createSupabaseClient } from '../lib/supabase.js';
import { createIexClient, IexClient } from '../lib/iexClient.js';
import type { MicroIexVolumeDailyRecord } from '../lib/schema.js';

let cachedClient: IexClient | null = null;

function getIexClient(): IexClient {
  if (!cachedClient) {
    cachedClient = createIexClient();
  }
  return cachedClient;
}

export interface IexDailyIngestInput {
  symbols?: string[];
  tradeDate: string;
}

export interface IexDailyIngestResult {
  upsertCount: number;
  fileId: string;
  sha256: string;
}

/**
 * Download and parse IEX HIST daily matched volume for a specific date
 *
 * @param input - Trade date and optional symbol filter
 * @returns Number of upserted records
 */
export async function downloadIexDaily(input: IexDailyIngestInput): Promise<IexDailyIngestResult> {
  const iex = getIexClient();
  const supabase = createSupabaseClient();

  // Download IEX HIST file for the trade date
  const { buffer, fileId, sha256 } = await iex.downloadDailyHIST(input.tradeDate);

  // Note: IEX HIST files may be in PCAP format or CSV format
  // This implementation assumes CSV. If PCAP, you'll need a parser library.
  // For now, we'll assume the file can be converted to CSV or is already CSV
  const csvContent = buffer.toString('utf-8');
  const volumeRecords = iex.parseDailyVolume(csvContent);

  // Filter by symbols if provided
  const filteredRecords = input.symbols
    ? volumeRecords.filter((r) => input.symbols!.includes(r.symbol))
    : volumeRecords;

  if (filteredRecords.length === 0) {
    return { upsertCount: 0, fileId, sha256 };
  }

  // Prepare records for upsert
  const records: MicroIexVolumeDailyRecord[] = filteredRecords.map((r) => ({
    symbol: r.symbol,
    trade_date: input.tradeDate,
    matched_shares: r.matched_shares,
    iex_file_id: fileId,
    iex_sha256: sha256,
  }));

  // Batch upsert to avoid hitting payload limits
  const batchSize = 500;
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error, count } = await supabase
      .from('micro_iex_volume_daily')
      .upsert(batch, { onConflict: 'symbol,trade_date' })
      .select('symbol', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Failed to upsert IEX volume: ${error.message}`);
    }

    totalUpserted += count ?? batch.length;
  }

  return { upsertCount: totalUpserted, fileId, sha256 };
}

/**
 * List available IEX HIST dates (placeholder for actual implementation)
 *
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @returns Array of available trade dates
 */
export async function listIexHistDates(fromDate: string, toDate: string): Promise<string[]> {
  // This would typically query IEX's directory or catalog
  // For now, we'll generate business days between the dates
  // In production, you'd want to check actual availability
  const dates: string[] = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);

  let current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(current.toISOString().slice(0, 10));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Get existing IEX volume data for a date range and symbols
 *
 * @param symbols - Array of symbols
 * @param fromDate - Start date
 * @param toDate - End date
 * @returns Array of IEX volume records
 */
export async function getIexVolumeRange(
  symbols: string[],
  fromDate: string,
  toDate: string
): Promise<MicroIexVolumeDailyRecord[]> {
  const supabase = createSupabaseClient();

  const { data, error } = await supabase
    .from('micro_iex_volume_daily')
    .select('*')
    .in('symbol', symbols)
    .gte('trade_date', fromDate)
    .lte('trade_date', toDate)
    .order('symbol')
    .order('trade_date');

  if (error) {
    throw new Error(`Failed to query IEX volume: ${error.message}`);
  }

  return (data ?? []) as MicroIexVolumeDailyRecord[];
}
