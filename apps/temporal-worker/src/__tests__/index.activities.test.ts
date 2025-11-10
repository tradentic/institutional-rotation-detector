import { describe, test, expect, beforeEach, vi } from 'vitest';
import { indexPenalty, batchIndexPenalty, persistIndexPenalty } from '../activities/index.activities.ts';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
};

vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => mockSupabase,
}));

describe('indexPenalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns zero penalty when filing is outside all index windows', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    });

    const result = await indexPenalty({
      filingDate: '2024-01-15',
      cik: '0000000001',
    });

    expect(result.penalty).toBe(0);
    expect(result.matchedWindows).toHaveLength(0);
  });

  test('returns 0.5 penalty when filing overlaps with one index window', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({
            data: [
              {
                index_name: 'Russell 2000',
                phase: 'announcement',
                window_start: '2024-05-01',
                window_end: '2024-05-31',
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const result = await indexPenalty({
      filingDate: '2024-05-15',
      cik: '0000000001',
    });

    expect(result.penalty).toBe(0.5);
    expect(result.matchedWindows).toHaveLength(1);
    expect(result.matchedWindows[0].indexName).toBe('Russell 2000');
  });

  test('returns 1.0 penalty when filing overlaps with multiple windows', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({
            data: [
              {
                index_name: 'Russell 2000',
                phase: 'effective',
                window_start: '2024-06-21',
                window_end: '2024-06-30',
              },
              {
                index_name: 'S&P 500',
                phase: 'q2_rebal',
                window_start: '2024-06-21',
                window_end: '2024-06-30',
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const result = await indexPenalty({
      filingDate: '2024-06-28',
      cik: '0000000001',
    });

    expect(result.penalty).toBe(1.0);
    expect(result.matchedWindows).toHaveLength(2);
  });

  test('handles database errors gracefully', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('Database connection failed'),
          }),
        }),
      }),
    });

    await expect(
      indexPenalty({
        filingDate: '2024-05-15',
        cik: '0000000001',
      })
    ).rejects.toThrow('Database connection failed');
  });
});

describe('batchIndexPenalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('processes multiple filings and returns map of results', async () => {
    // Mock different responses for different dates
    let callCount = 0;
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          gte: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // First call - no overlap
              return Promise.resolve({ data: [], error: null });
            } else {
              // Second call - one window overlap
              return Promise.resolve({
                data: [
                  {
                    index_name: 'Russell 2000',
                    phase: 'announcement',
                    window_start: '2024-05-01',
                    window_end: '2024-05-31',
                  },
                ],
                error: null,
              });
            }
          }),
        }),
      }),
    });

    const results = await batchIndexPenalty([
      { filingDate: '2024-01-15', cik: '0000000001' },
      { filingDate: '2024-05-15', cik: '0000000002' },
    ]);

    expect(results.size).toBe(2);
    expect(results.get('0000000001:2024-01-15')?.penalty).toBe(0);
    expect(results.get('0000000002:2024-05-15')?.penalty).toBe(0.5);
  });
});

describe('persistIndexPenalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('updates rotation_events and adds provenance entries', async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null });
    const upsertMock = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'rotation_events') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(updateMock()),
          }),
        };
      } else if (table === 'rotation_event_provenance') {
        return {
          upsert: vi.fn().mockImplementation((entries, opts) => {
            upsertMock(entries, opts);
            return Promise.resolve({ error: null });
          }),
        };
      }
    });

    await persistIndexPenalty('cluster-123', 0.5, [
      {
        indexName: 'Russell 2000',
        phase: 'announcement',
        windowStart: '2024-05-01',
        windowEnd: '2024-05-31',
      },
    ]);

    expect(mockSupabase.from).toHaveBeenCalledWith('rotation_events');
    expect(mockSupabase.from).toHaveBeenCalledWith('rotation_event_provenance');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          cluster_id: 'cluster-123',
          role: 'context',
          contribution_weight: -0.5,
        }),
      ]),
      expect.objectContaining({ onConflict: 'cluster_id,accession,role' })
    );
  });

  test('does not create provenance entries when no windows matched', async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue(updateMock()),
      }),
    });

    await persistIndexPenalty('cluster-123', 0, []);

    expect(mockSupabase.from).toHaveBeenCalledWith('rotation_events');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('rotation_event_provenance');
  });
});
