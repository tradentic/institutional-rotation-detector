'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface WorkflowInfo {
  workflowId: string;
  workflowType: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TERMINATED';
  progress?: number;
  startedAt: Date;
}

interface WorkflowListProps {
  workflows: WorkflowInfo[];
  onSelect?: (workflowId: string) => void;
}

export function WorkflowList({ workflows, onSelect }: WorkflowListProps) {
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());

  const toggleExpanded = (workflowId: string) => {
    const newExpanded = new Set(expandedWorkflows);
    if (newExpanded.has(workflowId)) {
      newExpanded.delete(workflowId);
    } else {
      newExpanded.add(workflowId);
    }
    setExpandedWorkflows(newExpanded);
  };

  const getStatusIcon = (status: WorkflowInfo['status']) => {
    switch (status) {
      case 'RUNNING':
        return <Activity className="h-4 w-4 text-blue-600 animate-pulse" />;
      case 'COMPLETED':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'TERMINATED':
        return <XCircle className="h-4 w-4 text-orange-600" />;
      default:
        return <Activity className="h-4 w-4 text-slate-600" />;
    }
  };

  const getStatusBadge = (status: WorkflowInfo['status']) => {
    switch (status) {
      case 'RUNNING':
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-600">
            Running
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge variant="outline" className="text-green-600 border-green-600">
            Completed
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="outline" className="text-red-600 border-red-600">
            Failed
          </Badge>
        );
      case 'TERMINATED':
        return (
          <Badge variant="outline" className="text-orange-600 border-orange-600">
            Terminated
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (workflows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No active workflows. Launch a workflow from the Workflows page.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active Workflows</CardTitle>
          <Badge variant="outline">{workflows.length} workflows</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {workflows.map((workflow) => {
            const isExpanded = expandedWorkflows.has(workflow.workflowId);

            return (
              <div
                key={workflow.workflowId}
                className={cn(
                  'border rounded-lg p-3 hover:bg-slate-50 transition-colors',
                  onSelect && 'cursor-pointer'
                )}
                onClick={() => onSelect?.(workflow.workflowId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    {getStatusIcon(workflow.status)}
                    <div className="flex-1">
                      <p className="text-sm font-medium">{workflow.workflowType}</p>
                      <p className="text-xs text-muted-foreground">
                        Started {formatTimestamp(workflow.startedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(workflow.status)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(workflow.workflowId);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Workflow ID:</span>
                        <span className="font-mono">{workflow.workflowId}</span>
                      </div>
                      {workflow.progress !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Progress:</span>
                          <span>{workflow.progress}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
