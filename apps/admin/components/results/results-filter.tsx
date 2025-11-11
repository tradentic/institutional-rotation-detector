'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResultsFilter } from '@/lib/results-utils';
import { Filter, X, RotateCcw } from 'lucide-react';

interface ResultsFilterPanelProps {
  filter: ResultsFilter;
  onFilterChange: (filter: ResultsFilter) => void;
  availableTickers?: string[];
  availableInstitutions?: string[];
  availableQuarters?: string[];
}

export function ResultsFilterPanel({
  filter,
  onFilterChange,
  availableTickers = [],
  availableInstitutions = [],
  availableQuarters = [],
}: ResultsFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const rotationTypes: Array<{ value: ResultsFilter['rotationType']; label: string; icon: string }> = [
    { value: 'all', label: 'All Types', icon: '📋' },
    { value: 'entry', label: 'Entry', icon: '📥' },
    { value: 'exit', label: 'Exit', icon: '📤' },
    { value: 'increase', label: 'Increase', icon: '📈' },
    { value: 'decrease', label: 'Decrease', icon: '📉' },
  ];

  const handleReset = () => {
    onFilterChange({
      ticker: undefined,
      institution: undefined,
      quarter: undefined,
      rotationType: 'all',
      minAnomalyScore: undefined,
      minPercentChange: undefined,
    });
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filter.ticker) count++;
    if (filter.institution) count++;
    if (filter.quarter) count++;
    if (filter.rotationType && filter.rotationType !== 'all') count++;
    if (filter.minAnomalyScore !== undefined) count++;
    if (filter.minPercentChange !== undefined) count++;
    return count;
  };

  const activeCount = getActiveFilterCount();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <CardTitle className="text-base">Filters</CardTitle>
            {activeCount > 0 && (
              <Badge variant="default" className="bg-blue-600">
                {activeCount} active
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs"
          >
            {isExpanded ? 'Hide' : 'Show'} Filters
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          <div className="space-y-4">
            {/* Quick Reset */}
            {activeCount > 0 && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset All Filters
                </Button>
              </div>
            )}

            {/* Rotation Type Filter */}
            <div>
              <Label className="mb-2 block">Rotation Type</Label>
              <div className="flex flex-wrap gap-2">
                {rotationTypes.map((type) => (
                  <Button
                    key={type.value}
                    variant={filter.rotationType === type.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onFilterChange({ ...filter, rotationType: type.value })}
                  >
                    <span className="mr-1">{type.icon}</span>
                    {type.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Text Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Ticker Filter */}
              <div>
                <Label htmlFor="ticker-filter">Ticker</Label>
                <div className="relative">
                  <Input
                    id="ticker-filter"
                    placeholder="e.g., AAPL"
                    value={filter.ticker || ''}
                    onChange={(e) =>
                      onFilterChange({ ...filter, ticker: e.target.value || undefined })
                    }
                    list="tickers-list"
                  />
                  {filter.ticker && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      onClick={() => onFilterChange({ ...filter, ticker: undefined })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {availableTickers.length > 0 && (
                  <datalist id="tickers-list">
                    {availableTickers.map((ticker) => (
                      <option key={ticker} value={ticker} />
                    ))}
                  </datalist>
                )}
              </div>

              {/* Institution Filter */}
              <div>
                <Label htmlFor="institution-filter">Institution</Label>
                <div className="relative">
                  <Input
                    id="institution-filter"
                    placeholder="e.g., BlackRock"
                    value={filter.institution || ''}
                    onChange={(e) =>
                      onFilterChange({ ...filter, institution: e.target.value || undefined })
                    }
                    list="institutions-list"
                  />
                  {filter.institution && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      onClick={() => onFilterChange({ ...filter, institution: undefined })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {availableInstitutions.length > 0 && (
                  <datalist id="institutions-list">
                    {availableInstitutions.map((institution) => (
                      <option key={institution} value={institution} />
                    ))}
                  </datalist>
                )}
              </div>

              {/* Quarter Filter */}
              <div>
                <Label htmlFor="quarter-filter">Quarter</Label>
                <div className="relative">
                  <Input
                    id="quarter-filter"
                    placeholder="e.g., 2024Q1"
                    value={filter.quarter || ''}
                    onChange={(e) =>
                      onFilterChange({ ...filter, quarter: e.target.value || undefined })
                    }
                    list="quarters-list"
                  />
                  {filter.quarter && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      onClick={() => onFilterChange({ ...filter, quarter: undefined })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {availableQuarters.length > 0 && (
                  <datalist id="quarters-list">
                    {availableQuarters.map((quarter) => (
                      <option key={quarter} value={quarter} />
                    ))}
                  </datalist>
                )}
              </div>
            </div>

            {/* Numeric Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Min Anomaly Score */}
              <div>
                <Label htmlFor="anomaly-filter">Min Anomaly Score (0-100)</Label>
                <Input
                  id="anomaly-filter"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g., 60"
                  value={filter.minAnomalyScore ?? ''}
                  onChange={(e) =>
                    onFilterChange({
                      ...filter,
                      minAnomalyScore: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">
                  Show only events with anomaly score above this threshold
                </p>
              </div>

              {/* Min Percent Change */}
              <div>
                <Label htmlFor="percent-filter">Min % Change</Label>
                <Input
                  id="percent-filter"
                  type="number"
                  placeholder="e.g., 25"
                  value={filter.minPercentChange ?? ''}
                  onChange={(e) =>
                    onFilterChange({
                      ...filter,
                      minPercentChange: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">
                  Show only events with percent change above this threshold (absolute value)
                </p>
              </div>
            </div>

            {/* Active Filters Summary */}
            {activeCount > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium text-gray-700 mb-2">Active Filters:</p>
                <div className="flex flex-wrap gap-2">
                  {filter.ticker && (
                    <Badge variant="secondary">
                      Ticker: {filter.ticker}
                      <button
                        className="ml-1"
                        onClick={() => onFilterChange({ ...filter, ticker: undefined })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {filter.institution && (
                    <Badge variant="secondary">
                      Institution: {filter.institution}
                      <button
                        className="ml-1"
                        onClick={() => onFilterChange({ ...filter, institution: undefined })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {filter.quarter && (
                    <Badge variant="secondary">
                      Quarter: {filter.quarter}
                      <button
                        className="ml-1"
                        onClick={() => onFilterChange({ ...filter, quarter: undefined })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {filter.rotationType && filter.rotationType !== 'all' && (
                    <Badge variant="secondary">
                      Type: {filter.rotationType}
                      <button
                        className="ml-1"
                        onClick={() => onFilterChange({ ...filter, rotationType: 'all' })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {filter.minAnomalyScore !== undefined && (
                    <Badge variant="secondary">
                      Anomaly ≥ {filter.minAnomalyScore}
                      <button
                        className="ml-1"
                        onClick={() =>
                          onFilterChange({ ...filter, minAnomalyScore: undefined })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {filter.minPercentChange !== undefined && (
                    <Badge variant="secondary">
                      % Change ≥ {filter.minPercentChange}%
                      <button
                        className="ml-1"
                        onClick={() =>
                          onFilterChange({ ...filter, minPercentChange: undefined })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
