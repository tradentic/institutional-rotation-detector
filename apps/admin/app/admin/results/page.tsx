'use client';

import { useState, useEffect } from 'react';
import {
  RotationEvent,
  AIAnalysis,
  ResultsSummary,
  ResultsFilter,
} from '@/lib/results-utils';
import { ResultsSummaryComponent } from '@/components/results/results-summary';
import { ResultsFilterPanel } from '@/components/results/results-filter';
import { RotationEventsTable } from '@/components/results/rotation-events-table';
import { ExportActions } from '@/components/results/export-actions';
import { Pagination } from '@/components/results/pagination';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function ResultsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState<RotationEvent[]>([]);
  const [analyses, setAnalyses] = useState<Map<string, AIAnalysis>>(new Map());
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [filter, setFilter] = useState<ResultsFilter>({
    rotationType: 'all',
    sortBy: 'date',
    sortOrder: 'desc',
    page: 1,
    pageSize: 20,
  });
  const [totalEvents, setTotalEvents] = useState(0);
  const [availableFilters, setAvailableFilters] = useState<{
    tickers: string[];
    institutions: string[];
    quarters: string[];
  }>({
    tickers: [],
    institutions: [],
    quarters: [],
  });

  // Fetch results data
  useEffect(() => {
    fetchResults();
  }, [filter]);

  const fetchResults = async () => {
    setIsLoading(true);

    try {
      // In real implementation, this would call the API
      // For now, we'll use mock data
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Generate mock data
      const mockEvents = generateMockEvents(100);
      const mockAnalyses = generateMockAnalyses(mockEvents);
      const mockSummary = generateMockSummary(mockEvents);
      const mockFilters = {
        tickers: [...new Set(mockEvents.map((e) => e.ticker))].sort(),
        institutions: [...new Set(mockEvents.map((e) => e.institution))].sort(),
        quarters: [...new Set(mockEvents.map((e) => e.quarter))].sort(),
      };

      // Apply filters
      let filteredEvents = [...mockEvents];

      if (filter.ticker) {
        filteredEvents = filteredEvents.filter((e) =>
          e.ticker.toLowerCase().includes(filter.ticker!.toLowerCase())
        );
      }

      if (filter.institution) {
        filteredEvents = filteredEvents.filter((e) =>
          e.institution.toLowerCase().includes(filter.institution!.toLowerCase())
        );
      }

      if (filter.quarter) {
        filteredEvents = filteredEvents.filter((e) => e.quarter === filter.quarter);
      }

      if (filter.rotationType && filter.rotationType !== 'all') {
        filteredEvents = filteredEvents.filter((e) => e.rotationType === filter.rotationType);
      }

      if (filter.minAnomalyScore !== undefined) {
        filteredEvents = filteredEvents.filter((e) => {
          const analysis = mockAnalyses.get(e.id);
          return analysis && analysis.anomalyScore >= filter.minAnomalyScore!;
        });
      }

      if (filter.minPercentChange !== undefined) {
        filteredEvents = filteredEvents.filter(
          (e) => Math.abs(e.percentChange) >= filter.minPercentChange!
        );
      }

      // Apply sorting
      filteredEvents.sort((a, b) => {
        let comparison = 0;
        switch (filter.sortBy) {
          case 'percentChange':
            comparison = Math.abs(a.percentChange) - Math.abs(b.percentChange);
            break;
          case 'valueChange':
            comparison = Math.abs(a.valueChange) - Math.abs(b.valueChange);
            break;
          case 'anomalyScore':
            const aScore = mockAnalyses.get(a.id)?.anomalyScore || 0;
            const bScore = mockAnalyses.get(b.id)?.anomalyScore || 0;
            comparison = aScore - bScore;
            break;
          case 'date':
          default:
            comparison = a.detectedAt.getTime() - b.detectedAt.getTime();
            break;
        }

        return filter.sortOrder === 'desc' ? -comparison : comparison;
      });

      setTotalEvents(filteredEvents.length);

      // Apply pagination
      const startIndex = ((filter.page || 1) - 1) * (filter.pageSize || 20);
      const endIndex = startIndex + (filter.pageSize || 20);
      const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

      setEvents(paginatedEvents);
      setAnalyses(mockAnalyses);
      setSummary(mockSummary);
      setAvailableFilters(mockFilters);
    } catch (error) {
      console.error('Error fetching results:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSortChange = (sortBy: string, sortOrder: 'asc' | 'desc') => {
    setFilter((prev) => ({ ...prev, sortBy: sortBy as any, sortOrder, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilter((prev) => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPages = Math.ceil(totalEvents / (filter.pageSize || 20));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Results Viewer</h2>
        <p className="text-muted-foreground">
          Browse rotation events, graphs, and analysis results
        </p>
      </div>

      {isLoading && !summary ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-gray-600">Loading results...</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          {summary && <ResultsSummaryComponent summary={summary} />}

          {/* Export Actions */}
          <ExportActions events={events} analyses={analyses} />

          {/* Filters */}
          <ResultsFilterPanel
            filter={filter}
            onFilterChange={(newFilter) => setFilter({ ...filter, ...newFilter, page: 1 })}
            availableTickers={availableFilters.tickers}
            availableInstitutions={availableFilters.institutions}
            availableQuarters={availableFilters.quarters}
          />

          {/* Results Table */}
          {isLoading ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
                <p className="text-gray-600">Applying filters...</p>
              </CardContent>
            </Card>
          ) : (
            <RotationEventsTable
              events={events}
              analyses={analyses}
              sortBy={filter.sortBy}
              sortOrder={filter.sortOrder}
              onSortChange={handleSortChange}
            />
          )}

          {/* Pagination */}
          {totalEvents > (filter.pageSize || 20) && (
            <Pagination
              currentPage={filter.page || 1}
              totalPages={totalPages}
              totalItems={totalEvents}
              pageSize={filter.pageSize || 20}
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}
    </div>
  );
}

// Mock data generators
function generateMockEvents(count: number): RotationEvent[] {
  const tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA'];
  const institutions = [
    'BlackRock Inc',
    'Vanguard Group Inc',
    'State Street Corp',
    'Fidelity Investments',
    'JPMorgan Chase & Co',
    'Morgan Stanley',
    'Goldman Sachs',
    'Bank of America',
  ];
  const quarters = ['2024Q1', '2024Q2', '2024Q3', '2024Q4'];
  const types: Array<RotationEvent['rotationType']> = ['entry', 'exit', 'increase', 'decrease'];

  return Array.from({ length: count }, (_, i) => {
    const ticker = tickers[Math.floor(Math.random() * tickers.length)];
    const institution = institutions[Math.floor(Math.random() * institutions.length)];
    const quarter = quarters[Math.floor(Math.random() * quarters.length)];
    const type = types[Math.floor(Math.random() * types.length)];

    const previousShares = Math.floor(Math.random() * 10_000_000) + 1_000_000;
    const percentChange = (Math.random() * 100 - 50) * (type === 'exit' ? -1 : 1);
    const currentShares = Math.floor(previousShares * (1 + percentChange / 100));
    const shareChange = currentShares - previousShares;

    const avgPrice = Math.random() * 200 + 50;
    const previousValue = previousShares * avgPrice;
    const currentValue = currentShares * avgPrice;
    const valueChange = currentValue - previousValue;

    return {
      id: `event-${i}`,
      ticker,
      institution,
      quarter,
      rotationType: type,
      previousShares,
      currentShares,
      shareChange,
      percentChange,
      previousValue,
      currentValue,
      valueChange,
      detectedAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
    };
  });
}

function generateMockAnalyses(events: RotationEvent[]): Map<string, AIAnalysis> {
  const analyses = new Map<string, AIAnalysis>();

  events.forEach((event, i) => {
    if (Math.random() > 0.2) {
      // 80% of events have analysis
      const anomalyScore = Math.floor(Math.random() * 100);

      analyses.set(event.id, {
        id: `analysis-${i}`,
        eventId: event.id,
        anomalyScore,
        narrative: `This ${event.rotationType} by ${event.institution} in ${event.ticker} represents a ${Math.abs(event.percentChange).toFixed(1)}% position change. The magnitude and timing suggest ${anomalyScore > 60 ? 'significant strategic repositioning' : 'routine portfolio rebalancing'}.`,
        tradingImplications: [
          `Position change of ${Math.abs(event.percentChange).toFixed(1)}% may indicate ${anomalyScore > 60 ? 'strong conviction' : 'moderate interest'}`,
          `${event.valueChange > 0 ? 'Increased' : 'Decreased'} exposure worth ${Math.abs(event.valueChange / 1_000_000).toFixed(2)}M`,
          anomalyScore > 80 ? 'Warrants further investigation and monitoring' : 'Within normal market activity',
        ],
        confidenceScore: Math.random() * 0.3 + 0.7,
        reasoningTokens: Math.floor(Math.random() * 2000) + 500,
        generatedAt: new Date(event.detectedAt.getTime() + 60000),
      });
    }
  });

  return analyses;
}

function generateMockSummary(events: RotationEvent[]): ResultsSummary {
  const uniqueInstitutions = new Set(events.map((e) => e.institution));
  const uniqueIssuers = new Set(events.map((e) => e.ticker));
  const uniqueQuarters = new Set(events.map((e) => e.quarter));

  return {
    totalEvents: events.length,
    totalInstitutions: uniqueInstitutions.size,
    totalIssuers: uniqueIssuers.size,
    entryCount: events.filter((e) => e.rotationType === 'entry').length,
    exitCount: events.filter((e) => e.rotationType === 'exit').length,
    increaseCount: events.filter((e) => e.rotationType === 'increase').length,
    decreaseCount: events.filter((e) => e.rotationType === 'decrease').length,
    averageAnomalyScore: Math.floor(Math.random() * 30) + 40,
    quarters: Array.from(uniqueQuarters).sort(),
  };
}
