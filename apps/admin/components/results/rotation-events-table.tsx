'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RotationEvent,
  AIAnalysis,
  getRotationTypeColor,
  getRotationTypeIcon,
  getRotationTypeLabel,
  formatShares,
  formatCurrency,
  formatPercentChange,
  getAnomalyScoreColor,
  getAnomalyScoreLabel,
} from '@/lib/results-utils';
import {
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ExternalLink,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

interface RotationEventsTableProps {
  events: RotationEvent[];
  analyses: Map<string, AIAnalysis>;
  onEventSelect?: (event: RotationEvent) => void;
  sortBy?: 'date' | 'percentChange' | 'valueChange' | 'anomalyScore';
  sortOrder?: 'asc' | 'desc';
  onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
}

export function RotationEventsTable({
  events,
  analyses,
  onEventSelect,
  sortBy = 'date',
  sortOrder = 'desc',
  onSortChange,
}: RotationEventsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (eventId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId);
    } else {
      newExpanded.add(eventId);
    }
    setExpandedRows(newExpanded);
  };

  const handleSort = (column: string) => {
    if (onSortChange) {
      const newOrder = sortBy === column && sortOrder === 'desc' ? 'asc' : 'desc';
      onSortChange(column, newOrder);
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
    }
    return sortOrder === 'desc' ? (
      <ChevronDown className="h-4 w-4" />
    ) : (
      <ChevronUp className="h-4 w-4" />
    );
  };

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          <p>No rotation events found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotation Events ({events.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="pb-3 font-semibold">#</th>
                <th className="pb-3 font-semibold">Type</th>
                <th className="pb-3 font-semibold">Ticker</th>
                <th className="pb-3 font-semibold">Institution</th>
                <th className="pb-3 font-semibold">Quarter</th>
                <th className="pb-3 font-semibold">
                  <button
                    className="flex items-center gap-1 hover:text-blue-600"
                    onClick={() => handleSort('percentChange')}
                  >
                    % Change {getSortIcon('percentChange')}
                  </button>
                </th>
                <th className="pb-3 font-semibold">
                  <button
                    className="flex items-center gap-1 hover:text-blue-600"
                    onClick={() => handleSort('valueChange')}
                  >
                    Value Change {getSortIcon('valueChange')}
                  </button>
                </th>
                <th className="pb-3 font-semibold">
                  <button
                    className="flex items-center gap-1 hover:text-blue-600"
                    onClick={() => handleSort('anomalyScore')}
                  >
                    Anomaly {getSortIcon('anomalyScore')}
                  </button>
                </th>
                <th className="pb-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => {
                const analysis = analyses.get(event.id);
                const isExpanded = expandedRows.has(event.id);
                const isPositiveChange = event.shareChange > 0;

                return (
                  <>
                    <tr
                      key={event.id}
                      className="border-b hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => toggleRow(event.id)}
                    >
                      <td className="py-3 text-gray-500">{index + 1}</td>
                      <td className="py-3">
                        <Badge className={`${getRotationTypeColor(event.rotationType)} border`}>
                          <span className="mr-1">{getRotationTypeIcon(event.rotationType)}</span>
                          {getRotationTypeLabel(event.rotationType)}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <span className="font-semibold">{event.ticker}</span>
                      </td>
                      <td className="py-3 text-gray-700 max-w-[200px] truncate">
                        {event.institution}
                      </td>
                      <td className="py-3 text-gray-600">{event.quarter}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          {isPositiveChange ? (
                            <TrendingUp className="h-4 w-4 text-green-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-600" />
                          )}
                          <span
                            className={`font-semibold ${isPositiveChange ? 'text-green-600' : 'text-red-600'}`}
                          >
                            {formatPercentChange(event.percentChange)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`font-semibold ${isPositiveChange ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {formatCurrency(event.valueChange)}
                        </span>
                      </td>
                      <td className="py-3">
                        {analysis ? (
                          <Badge
                            className={`${getAnomalyScoreColor(analysis.anomalyScore)} border`}
                          >
                            {analysis.anomalyScore}/100
                          </Badge>
                        ) : (
                          <span className="text-gray-400 text-xs">N/A</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Button variant="ghost" size="sm">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr key={`${event.id}-details`} className="bg-gray-50">
                        <td colSpan={9} className="py-4 px-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Position Details */}
                            <div>
                              <h4 className="font-semibold mb-3 text-gray-900">
                                Position Details
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Previous Shares:</span>
                                  <span className="font-medium">
                                    {formatShares(event.previousShares)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Current Shares:</span>
                                  <span className="font-medium">
                                    {formatShares(event.currentShares)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Share Change:</span>
                                  <span
                                    className={`font-semibold ${isPositiveChange ? 'text-green-600' : 'text-red-600'}`}
                                  >
                                    {formatShares(Math.abs(event.shareChange))}
                                  </span>
                                </div>
                                <div className="flex justify-between border-t pt-2 mt-2">
                                  <span className="text-gray-600">Previous Value:</span>
                                  <span className="font-medium">
                                    {formatCurrency(event.previousValue)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Current Value:</span>
                                  <span className="font-medium">
                                    {formatCurrency(event.currentValue)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Value Change:</span>
                                  <span
                                    className={`font-semibold ${isPositiveChange ? 'text-green-600' : 'text-red-600'}`}
                                  >
                                    {formatCurrency(Math.abs(event.valueChange))}
                                  </span>
                                </div>
                                <div className="flex justify-between border-t pt-2 mt-2">
                                  <span className="text-gray-600">Detected:</span>
                                  <span className="text-gray-500">
                                    {event.detectedAt.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* AI Analysis */}
                            {analysis && (
                              <div>
                                <h4 className="font-semibold mb-3 text-gray-900">AI Analysis</h4>
                                <div className="space-y-3 text-sm">
                                  <div>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-gray-600">Anomaly Score:</span>
                                      <Badge
                                        className={`${getAnomalyScoreColor(analysis.anomalyScore)} border`}
                                      >
                                        {analysis.anomalyScore}/100 -{' '}
                                        {getAnomalyScoreLabel(analysis.anomalyScore)}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-600">Confidence:</span>
                                      <span className="font-medium">
                                        {(analysis.confidenceScore * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                  </div>

                                  <div className="border-t pt-3">
                                    <p className="text-gray-600 mb-1 font-medium">Narrative:</p>
                                    <p className="text-gray-700 leading-relaxed">
                                      {analysis.narrative}
                                    </p>
                                  </div>

                                  {analysis.tradingImplications.length > 0 && (
                                    <div className="border-t pt-3">
                                      <p className="text-gray-600 mb-2 font-medium">
                                        Trading Implications:
                                      </p>
                                      <ul className="list-disc list-inside space-y-1 text-gray-700">
                                        {analysis.tradingImplications.map((implication, i) => (
                                          <li key={i}>{implication}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  <div className="border-t pt-2 text-xs text-gray-500">
                                    Generated: {analysis.generatedAt.toLocaleString()} •{' '}
                                    {analysis.reasoningTokens.toLocaleString()} reasoning tokens
                                  </div>
                                </div>
                              </div>
                            )}

                            {!analysis && (
                              <div className="flex items-center justify-center text-gray-400">
                                <p>No AI analysis available for this event</p>
                              </div>
                            )}
                          </div>

                          {onEventSelect && (
                            <div className="mt-4 flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEventSelect(event);
                                }}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                View Full Details
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
