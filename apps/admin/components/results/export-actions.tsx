'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RotationEvent, AIAnalysis, exportResults, ExportFormat } from '@/lib/results-utils';
import { Download, FileText, FileJson, FileCode } from 'lucide-react';

interface ExportActionsProps {
  events: RotationEvent[];
  analyses: Map<string, AIAnalysis>;
  disabled?: boolean;
}

export function ExportActions({ events, analyses, disabled = false }: ExportActionsProps) {
  const handleExport = (format: ExportFormat) => {
    exportResults(events, analyses, format);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Export Results</h3>
            <p className="text-sm text-gray-600 mt-1">
              Download results in various formats ({events.length} events)
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('csv')}
              disabled={disabled || events.length === 0}
            >
              <FileText className="h-4 w-4 mr-1" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json')}
              disabled={disabled || events.length === 0}
            >
              <FileJson className="h-4 w-4 mr-1" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('markdown')}
              disabled={disabled || events.length === 0}
            >
              <FileCode className="h-4 w-4 mr-1" />
              Markdown
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
