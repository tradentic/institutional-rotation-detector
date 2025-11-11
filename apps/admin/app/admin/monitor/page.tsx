'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkflowProgress } from '@/components/monitor/workflow-progress';
import { ConsoleOutput, type LogEntry } from '@/components/monitor/console-output';
import { WorkflowList, type WorkflowInfo } from '@/components/monitor/workflow-list';
import { EventFilterPanel } from '@/components/monitor/event-filter-panel';
import { EventCategory, getDefaultCategories } from '@/lib/temporal-events';
import { Plus } from 'lucide-react';

export default function MonitorPage() {
  const [monitoredWorkflows, setMonitoredWorkflows] = useState<string[]>([]);
  const [workflowInput, setWorkflowInput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>(getDefaultCategories());

  // Simulate workflow discovery (in real implementation, query Temporal)
  useEffect(() => {
    // This would be replaced with actual Temporal queries
    const mockWorkflows: WorkflowInfo[] = monitoredWorkflows.map((id) => ({
      workflowId: id,
      workflowType: id.split('-')[0] + 'Workflow',
      status: 'RUNNING',
      startedAt: new Date(),
    }));
    setWorkflows(mockWorkflows);
  }, [monitoredWorkflows]);

  // Subscribe to SSE events and add to logs
  useEffect(() => {
    const eventSources: EventSource[] = [];

    // Build category filter query param
    const categoriesParam = selectedCategories.join(',');

    monitoredWorkflows.forEach((workflowId) => {
      const eventSource = new EventSource(
        `/api/workflows/stream?id=${workflowId}&categories=${categoriesParam}`
      );

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Only create log entries for actual log events (not progress updates)
          if (data.type === 'log' || data.type === 'error' || data.type === 'connected' || data.type === 'complete') {
            const logEntry: LogEntry = {
              id: `${workflowId}-${Date.now()}-${Math.random()}`,
              workflowId,
              timestamp: data.timestamp || new Date().toTimeString().split(' ')[0],
              level: data.level || (data.type === 'error' ? 'error' : data.type === 'complete' ? 'success' : 'info'),
              message: data.message,
            };

            setLogs((prev) => [...prev, logEntry]);
          }

          // Update workflow status
          if (data.type === 'complete' || data.type === 'error') {
            setWorkflows((prev) =>
              prev.map((w) =>
                w.workflowId === workflowId
                  ? { ...w, status: data.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED' }
                  : w
              )
            );
          }
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      eventSources.push(eventSource);
    });

    return () => {
      eventSources.forEach((es) => es.close());
    };
  }, [monitoredWorkflows, selectedCategories]); // Re-subscribe when categories change

  const handleAddWorkflow = () => {
    if (workflowInput && !monitoredWorkflows.includes(workflowInput)) {
      setMonitoredWorkflows([...monitoredWorkflows, workflowInput]);
      setWorkflowInput('');

      // Add initial log
      setLogs((prev) => [
        ...prev,
        {
          id: `${workflowInput}-${Date.now()}`,
          workflowId: workflowInput,
          timestamp: new Date().toTimeString().split(' ')[0],
          level: 'info',
          message: 'Monitoring started',
        },
      ]);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Live Monitor</h2>
        <p className="text-muted-foreground">
          Real-time workflow execution monitoring and console output
        </p>
      </div>

      {/* Event Filters */}
      <EventFilterPanel
        selectedCategories={selectedCategories}
        onCategoriesChange={setSelectedCategories}
      />

      {/* Add Workflow */}
      <div className="flex gap-2">
        <Input
          placeholder="Enter workflow ID to monitor..."
          value={workflowInput}
          onChange={(e) => setWorkflowInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAddWorkflow();
            }
          }}
        />
        <Button onClick={handleAddWorkflow}>
          <Plus className="mr-2 h-4 w-4" />
          Monitor
        </Button>
      </div>

      {/* Workflow List */}
      {workflows.length > 0 && <WorkflowList workflows={workflows} />}

      {/* Progress Cards */}
      {monitoredWorkflows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {monitoredWorkflows.map((workflowId) => (
            <WorkflowProgress key={workflowId} workflowId={workflowId} />
          ))}
        </div>
      )}

      {/* Console Output */}
      <ConsoleOutput logs={logs} onClear={handleClearLogs} autoScroll={true} />
    </div>
  );
}
