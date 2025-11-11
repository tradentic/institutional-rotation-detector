'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Trash2, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LogEntry {
  id: string;
  workflowId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface ConsoleOutputProps {
  logs: LogEntry[];
  onClear?: () => void;
  onExport?: () => void;
  autoScroll?: boolean;
}

export function ConsoleOutput({ logs, onClear, onExport, autoScroll = true }: ConsoleOutputProps) {
  const [isPaused, setIsPaused] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !isPaused && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isPaused]);

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'info':
        return 'text-blue-400';
      case 'warn':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      case 'success':
        return 'text-green-400';
      default:
        return 'text-slate-400';
    }
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      // Default export as text
      const text = logs
        .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.workflowId}] ${log.message}`)
        .join('\n');

      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow-logs-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Console Output</CardTitle>
            <Badge variant="outline">{logs.length} entries</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            {onClear && (
              <Button variant="ghost" size="sm" onClick={onClear}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={consoleRef}
          className="bg-slate-950 text-green-400 p-4 rounded-md font-mono text-xs h-[500px] overflow-auto"
        >
          {logs.length === 0 ? (
            <div className="text-slate-500 text-center py-8">
              No logs yet. Workflows will appear here when started.
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="mb-1 hover:bg-slate-900 px-2 py-1 rounded">
                <span className="text-slate-500">[{log.timestamp}]</span>
                {' '}
                <span className={cn('font-semibold', getLevelColor(log.level))}>
                  [{log.level.toUpperCase()}]
                </span>
                {' '}
                <span className="text-slate-400">[{log.workflowId.substring(0, 20)}...]</span>
                {' '}
                <span className="text-green-400">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
