'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Filter, RotateCcw } from 'lucide-react';
import { EventCategory, getDefaultCategories, getAllCategories } from '@/lib/temporal-events';

interface EventFilterPanelProps {
  selectedCategories: EventCategory[];
  onCategoriesChange: (categories: EventCategory[]) => void;
}

// Category metadata for better UX
const CATEGORY_INFO: Record<
  EventCategory,
  { label: string; description: string; icon: string; color: string }
> = {
  workflow: {
    label: 'Workflow',
    description: 'Workflow start, complete, fail events',
    icon: '🔄',
    color: 'text-blue-600',
  },
  activity: {
    label: 'Activities',
    description: 'Activity execution (scheduled, started, completed)',
    icon: '⚡',
    color: 'text-green-600',
  },
  timer: {
    label: 'Timers',
    description: 'Sleep and delay events',
    icon: '⏱️',
    color: 'text-yellow-600',
  },
  signal: {
    label: 'Signals',
    description: 'External signals received by workflow',
    icon: '📡',
    color: 'text-purple-600',
  },
  'child-workflow': {
    label: 'Child Workflows',
    description: 'Sub-workflow executions',
    icon: '🔗',
    color: 'text-indigo-600',
  },
  marker: {
    label: 'Markers',
    description: 'Local activities and side effects',
    icon: '🏷️',
    color: 'text-orange-600',
  },
  other: {
    label: 'Other',
    description: 'Low-level workflow task events',
    icon: '📝',
    color: 'text-gray-600',
  },
  query: {
    label: 'Queries',
    description: 'Workflow query events',
    icon: '❓',
    color: 'text-pink-600',
  },
};

export function EventFilterPanel({ selectedCategories, onCategoriesChange }: EventFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleCategory = (category: EventCategory) => {
    if (selectedCategories.includes(category)) {
      onCategoriesChange(selectedCategories.filter((c) => c !== category));
    } else {
      onCategoriesChange([...selectedCategories, category]);
    }
  };

  const handleSelectAll = () => {
    onCategoriesChange(getAllCategories());
  };

  const handleSelectNone = () => {
    onCategoriesChange([]);
  };

  const handleReset = () => {
    onCategoriesChange(getDefaultCategories());
  };

  const allCategories = getAllCategories();

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <CardTitle className="text-base">Event Filters</CardTitle>
            <span className="text-xs text-gray-500">
              ({selectedCategories.length} of {allCategories.length} enabled)
            </span>
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
            {/* Quick actions */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={handleSelectNone}>
                Select None
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset to Default
              </Button>
            </div>

            {/* Category checkboxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCategories.map((category) => {
                const info = CATEGORY_INFO[category];
                const isChecked = selectedCategories.includes(category);

                return (
                  <div
                    key={category}
                    className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                      isChecked
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Checkbox
                      id={`category-${category}`}
                      checked={isChecked}
                      onCheckedChange={() => handleToggleCategory(category)}
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`category-${category}`}
                        className="cursor-pointer font-medium flex items-center gap-2"
                      >
                        <span className="text-lg">{info.icon}</span>
                        <span className={info.color}>{info.label}</span>
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">{info.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Warning if no categories selected */}
            {selectedCategories.length === 0 && (
              <div className="text-sm text-orange-600 bg-orange-50 p-3 rounded-lg border border-orange-200">
                ⚠️ No event categories selected. You won&apos;t see any events in the console.
              </div>
            )}

            {/* Info about default selection */}
            {selectedCategories.length === getDefaultCategories().length &&
              JSON.stringify(selectedCategories.sort()) ===
                JSON.stringify(getDefaultCategories().sort()) && (
                <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-200">
                  💡 Using default filters. Most useful events are shown. Enable &quot;Other&quot; to see
                  low-level workflow task events.
                </div>
              )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
