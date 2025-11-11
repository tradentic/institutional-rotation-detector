'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface WorkflowProgressProps {
  workflowId: string;
  workflowType?: string;
}

interface ProgressEvent {
  type: 'connected' | 'progress' | 'log' | 'complete' | 'error';
  workflowId: string;
  status?: string;
  percent?: number;
  message: string;
  timestamp: string;
  level?: 'info' | 'warn' | 'error';
}

export function WorkflowProgress({ workflowId, workflowType }: WorkflowProgressProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('CONNECTING');
  const [message, setMessage] = useState('Connecting to workflow...');
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(`/api/workflows/stream?id=${workflowId}`);

    eventSource.onmessage = (event) => {
      try {
        const data: ProgressEvent = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgress(data.percent || 0);
          setStatus(data.status || 'UNKNOWN');
          setMessage(data.message);
        } else if (data.type === 'complete') {
          setProgress(100);
          setStatus(data.status || 'COMPLETED');
          setMessage(data.message);
          setIsComplete(true);
          eventSource.close();
        } else if (data.type === 'error') {
          setStatus('ERROR');
          setMessage(data.message);
          setHasError(true);
          eventSource.close();
        } else if (data.type === 'connected') {
          setMessage('Connected');
        }
      } catch (error) {
        console.error('Failed to parse SSE message:', error);
      }
    };

    eventSource.onerror = () => {
      setStatus('ERROR');
      setMessage('Connection lost');
      setHasError(true);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [workflowId]);

  const getStatusIcon = () => {
    if (hasError || status === 'FAILED') {
      return <XCircle className="h-5 w-5 text-red-600" />;
    }
    if (isComplete || status === 'COMPLETED') {
      return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    }
    return <Activity className="h-5 w-5 text-blue-600 animate-pulse" />;
  };

  const getStatusBadge = () => {
    if (hasError || status === 'FAILED') {
      return (
        <Badge variant="outline" className="text-red-600 border-red-600">
          {status}
        </Badge>
      );
    }
    if (isComplete || status === 'COMPLETED') {
      return (
        <Badge variant="outline" className="text-green-600 border-green-600">
          {status}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-blue-600 border-blue-600">
        {status}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <CardTitle className="text-base">
                {workflowType || workflowId}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {workflowId}
              </p>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{message}</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      </CardContent>
    </Card>
  );
}
