'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  LayoutType,
  NodeType,
  GraphState,
  exportGraphData,
} from '@/lib/graph-utils';
import {
  Layout,
  Circle,
  GitBranch,
  Radio,
  Search,
  Download,
  FileJson,
  FileText,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { useState } from 'react';

interface GraphControlsProps {
  graphState: GraphState;
  onLayoutChange: (layout: LayoutType) => void;
  onNodeTypeFilter: (types: Set<NodeType>) => void;
  onSearchChange: (query: string) => void;
  onExport: (format: 'png' | 'svg' | 'json' | 'csv') => void;
  onReset: () => void;
}

export function GraphControls({
  graphState,
  onLayoutChange,
  onNodeTypeFilter,
  onSearchChange,
  onExport,
  onReset,
}: GraphControlsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<NodeType>>(
    new Set(['institution', 'issuer', 'community', 'concept'])
  );

  const layouts: Array<{ value: LayoutType; label: string; icon: any }> = [
    { value: 'force', label: 'Force-Directed', icon: Layout },
    { value: 'circular', label: 'Circular', icon: Circle },
    { value: 'hierarchical', label: 'Hierarchical', icon: GitBranch },
    { value: 'radial', label: 'Radial', icon: Radio },
  ];

  const nodeTypes: Array<{ value: NodeType; label: string; color: string }> = [
    { value: 'institution', label: 'Institutions', color: 'bg-blue-100 text-blue-800' },
    { value: 'issuer', label: 'Issuers', color: 'bg-green-100 text-green-800' },
    { value: 'community', label: 'Communities', color: 'bg-purple-100 text-purple-800' },
    { value: 'concept', label: 'Concepts', color: 'bg-orange-100 text-orange-800' },
  ];

  const handleNodeTypeToggle = (type: NodeType) => {
    const newTypes = new Set(selectedNodeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setSelectedNodeTypes(newTypes);
    onNodeTypeFilter(newTypes);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    onSearchChange(query);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    onSearchChange('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layout className="h-4 w-4" />
          Graph Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Layout Selection */}
        <div>
          <Label className="mb-2 block text-sm font-semibold">Layout</Label>
          <div className="flex flex-wrap gap-2">
            {layouts.map((layout) => (
              <Button
                key={layout.value}
                variant={graphState.layout === layout.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => onLayoutChange(layout.value)}
                className="flex items-center gap-1"
              >
                <layout.icon className="h-3 w-3" />
                {layout.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Node Type Filters */}
        <div>
          <Label className="mb-2 block text-sm font-semibold">Show Node Types</Label>
          <div className="flex flex-wrap gap-2">
            {nodeTypes.map((type) => (
              <Button
                key={type.value}
                variant={selectedNodeTypes.has(type.value) ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleNodeTypeToggle(type.value)}
                className={selectedNodeTypes.has(type.value) ? '' : 'opacity-50'}
              >
                {type.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {selectedNodeTypes.size} of {nodeTypes.length} types visible
          </p>
        </div>

        {/* Search */}
        <div>
          <Label htmlFor="graph-search" className="mb-2 block text-sm font-semibold">
            Search Nodes
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="graph-search"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-gray-500 mt-1">
              Searching for &quot;{searchQuery}&quot;...
            </p>
          )}
        </div>

        {/* Export */}
        <div>
          <Label className="mb-2 block text-sm font-semibold">Export</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport('png')}
              className="flex items-center gap-1"
            >
              <ImageIcon className="h-3 w-3" />
              PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport('svg')}
              className="flex items-center gap-1"
            >
              <ImageIcon className="h-3 w-3" />
              SVG
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport('json')}
              className="flex items-center gap-1"
            >
              <FileJson className="h-3 w-3" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport('csv')}
              className="flex items-center gap-1"
            >
              <FileText className="h-3 w-3" />
              CSV
            </Button>
          </div>
        </div>

        {/* Reset */}
        <div className="pt-4 border-t">
          <Button variant="outline" size="sm" onClick={onReset} className="w-full">
            Reset View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
