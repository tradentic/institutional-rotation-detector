'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultsSummary } from '@/lib/results-utils';
import { TrendingUp, TrendingDown, Users, Building2, Calendar, Activity } from 'lucide-react';

interface ResultsSummaryProps {
  summary: ResultsSummary;
}

export function ResultsSummaryComponent({ summary }: ResultsSummaryProps) {
  const stats = [
    {
      label: 'Total Events',
      value: summary.totalEvents.toLocaleString(),
      icon: Activity,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Institutions',
      value: summary.totalInstitutions.toLocaleString(),
      icon: Building2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      label: 'Issuers',
      value: summary.totalIssuers.toLocaleString(),
      icon: Users,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Avg Anomaly',
      value: summary.averageAnomalyScore.toFixed(1),
      icon: TrendingUp,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
  ];

  const rotationBreakdown = [
    { label: 'Entries', count: summary.entryCount, icon: '📥', color: 'text-green-600' },
    { label: 'Exits', count: summary.exitCount, icon: '📤', color: 'text-red-600' },
    { label: 'Increases', count: summary.increaseCount, icon: '📈', color: 'text-blue-600' },
    { label: 'Decreases', count: summary.decreaseCount, icon: '📉', color: 'text-orange-600' },
  ];

  return (
    <div className="space-y-4">
      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`${stat.bgColor} p-3 rounded-lg`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rotation Type Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rotation Type Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {rotationBreakdown.map((item) => {
              const percentage = summary.totalEvents > 0
                ? ((item.count / summary.totalEvents) * 100).toFixed(1)
                : '0.0';

              return (
                <div key={item.label} className="text-center">
                  <div className="text-3xl mb-2">{item.icon}</div>
                  <p className={`text-2xl font-bold ${item.color}`}>{item.count}</p>
                  <p className="text-sm text-gray-600">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{percentage}%</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quarters Coverage */}
      {summary.quarters.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <CardTitle className="text-base">Quarters Covered</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summary.quarters.map((quarter) => (
                <div
                  key={quarter}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium"
                >
                  {quarter}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
