'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GraphStatistics } from '@/lib/graph-utils';
import { BarChart3, Network, GitBranch, Activity } from 'lucide-react';

interface GraphStatsProps {
  statistics: GraphStatistics;
  isAnimating: boolean;
}

export function GraphStats({ statistics, isAnimating }: GraphStatsProps) {
  const stats = [
    {
      label: 'Nodes',
      value: statistics.nodeCount,
      icon: Network,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Edges',
      value: statistics.edgeCount,
      icon: GitBranch,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Avg Degree',
      value: statistics.averageDegree.toFixed(1),
      icon: Activity,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      label: 'Density',
      value: (statistics.networkDensity * 100).toFixed(1) + '%',
      icon: BarChart3,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Graph Statistics</CardTitle>
          {isAnimating && (
            <div className="flex items-center gap-1 text-xs text-blue-600">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
              Building...
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={`${stat.bgColor} rounded-lg p-3 flex items-center gap-2`}
            >
              <div className={`${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-gray-600">{stat.label}</div>
                <div className="text-lg font-bold">{stat.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Additional stats */}
        {statistics.maxDegree > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Max Degree:</span>
              <span className="font-semibold">{statistics.maxDegree}</span>
            </div>
            {statistics.communityCount && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Communities:</span>
                <span className="font-semibold">{statistics.communityCount}</span>
              </div>
            )}
          </div>
        )}

        {/* Interpretation */}
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-gray-600">
            {getStatisticsInterpretation(statistics)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function getStatisticsInterpretation(stats: GraphStatistics): string {
  if (stats.networkDensity > 0.5) {
    return 'Dense network: Most institutions have many connections, suggesting widespread co-holding patterns.';
  } else if (stats.networkDensity > 0.2) {
    return 'Moderate density: Some clustering visible with distinct institutional groups.';
  } else if (stats.networkDensity > 0) {
    return 'Sparse network: Few connections between institutions, indicating distinct investment strategies.';
  }
  return 'Graph structure being analyzed...';
}
