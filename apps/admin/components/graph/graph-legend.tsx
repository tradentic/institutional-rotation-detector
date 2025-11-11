'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GraphType } from '@/lib/graph-utils';
import { Info } from 'lucide-react';

interface GraphLegendProps {
  graphType: GraphType;
}

export function GraphLegend({ graphType }: GraphLegendProps) {
  // Node type legend
  const nodeTypes = [
    { color: '#3b82f6', label: 'Institution', shape: 'circle' },
    { color: '#10b981', label: 'Issuer/Stock', shape: 'circle' },
    { color: '#8b5cf6', label: 'Community', shape: 'circle' },
    { color: '#f59e0b', label: 'Concept', shape: 'circle' },
  ];

  // Edge type legend
  const edgeTypes = [
    { color: '#94a3b8', label: 'Holds', style: 'solid' },
    { color: '#10b981', label: 'Increased', style: 'solid' },
    { color: '#ef4444', label: 'Decreased', style: 'solid' },
    { color: '#3b82f6', label: 'Correlated', style: 'solid' },
    { color: '#8b5cf6', label: 'Same Community', style: 'dashed' },
  ];

  // Get relevant edge types based on graph type
  const relevantEdgeTypes = edgeTypes.filter((edge) => {
    switch (graphType) {
      case 'community':
        return ['Same Community', 'Correlated'].includes(edge.label);
      case 'cross-community':
        return ['Holds', 'Increased', 'Decreased'].includes(edge.label);
      case 'correlation':
        return ['Correlated'].includes(edge.label);
      case 'smart-money':
      case 'single-ticker':
        return ['Holds', 'Increased'].includes(edge.label);
      default:
        return true;
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4" />
          Legend
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Node Types */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Node Types</h4>
          <div className="space-y-2">
            {nodeTypes.map((type) => (
              <div key={type.label} className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: type.color }}
                />
                <span className="text-sm text-gray-600">{type.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Edge Types */}
        {relevantEdgeTypes.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Edge Types</h4>
            <div className="space-y-2">
              {relevantEdgeTypes.map((edge) => (
                <div key={edge.label} className="flex items-center gap-2">
                  <svg width="24" height="12" className="flex-shrink-0">
                    <line
                      x1="0"
                      y1="6"
                      x2="24"
                      y2="6"
                      stroke={edge.color}
                      strokeWidth="2"
                      strokeDasharray={edge.style === 'dashed' ? '3,3' : '0'}
                    />
                  </svg>
                  <span className="text-sm text-gray-600">{edge.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visual Encoding */}
        <div className="pt-3 border-t">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Visual Encoding</h4>
          <div className="space-y-1 text-xs text-gray-600">
            <div>• <strong>Node size</strong>: Importance/centrality</div>
            <div>• <strong>Edge thickness</strong>: Strength of relationship</div>
            <div>• <strong>Edge arrows</strong>: Direction of change</div>
          </div>
        </div>

        {/* Graph Type Info */}
        <div className="pt-3 border-t">
          <h4 className="text-sm font-semibold text-gray-700 mb-1">Graph Type</h4>
          <p className="text-xs text-gray-600">{getGraphTypeDescription(graphType)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getGraphTypeDescription(graphType: GraphType): string {
  switch (graphType) {
    case 'community':
      return 'Shows institutional clusters based on co-holding patterns. Nodes in the same color belong to the same community.';
    case 'cross-community':
      return 'Displays relationships across multiple stocks. Institutions connected to multiple tickers show rotation patterns.';
    case 'correlation':
      return 'Visualizes correlated position changes. Thicker edges indicate stronger correlations between institutions.';
    case 'smart-money':
      return 'Highlights top-performing institutions and their current positions. Larger nodes = better historical performance.';
    case 'single-ticker':
      return 'Shows all institutions holding a specific stock. Ticker is in the center with holders around it.';
    case 'overview':
      return 'Complete network view showing all institutional ownership relationships and connections.';
    default:
      return 'Interactive graph visualization of institutional ownership network.';
  }
}
