'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Download,
  Copy,
  Loader2
} from 'lucide-react';

export interface QAAnswer {
  question: string;
  answer: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
  error?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number; // in USD
}

export interface QAResultData {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  answers: QAAnswer[];
  tokenUsage?: TokenUsage;
  executionTime?: number; // in seconds
  startedAt: Date;
  completedAt?: Date;
}

interface QAResultsProps {
  result: QAResultData;
  onClear?: () => void;
}

export function QAResults({ result, onClear }: QAResultsProps) {
  const [expandedAnswers, setExpandedAnswers] = useState<Set<number>>(new Set());

  const toggleAnswer = (index: number) => {
    const newExpanded = new Set(expandedAnswers);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedAnswers(newExpanded);
  };

  const copyAnswer = (answer: string) => {
    navigator.clipboard.writeText(answer);
  };

  const exportResults = () => {
    const text = result.answers
      .map((qa) => `Q: ${qa.question}\n\nA: ${qa.answer}\n\n---\n\n`)
      .join('');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-results-${result.workflowId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = () => {
    switch (result.status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (result.status) {
      case 'running':
        return <Badge className="bg-blue-100 text-blue-800">Running</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
    }
  };

  const formatCost = (cost: number) => {
    return cost < 0.01 ? `<$0.01` : `$${cost.toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon()}
              <div>
                <CardTitle className="text-lg">Q&A Results</CardTitle>
                <p className="text-sm text-gray-500">Workflow ID: {result.workflowId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              {result.status === 'completed' && (
                <>
                  <Button variant="outline" size="sm" onClick={exportResults}>
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                  {onClear && (
                    <Button variant="outline" size="sm" onClick={onClear}>
                      Clear
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Metrics */}
        {result.tokenUsage && (
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-gray-500">Input Tokens</p>
                  <p className="text-lg font-semibold">{result.tokenUsage.inputTokens.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-xs text-gray-500">Output Tokens</p>
                  <p className="text-lg font-semibold">{result.tokenUsage.outputTokens.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-orange-500" />
                <div>
                  <p className="text-xs text-gray-500">Est. Cost</p>
                  <p className="text-lg font-semibold">{formatCost(result.tokenUsage.estimatedCost)}</p>
                </div>
              </div>
              {result.executionTime && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="text-xs text-gray-500">Duration</p>
                    <p className="text-lg font-semibold">{result.executionTime.toFixed(1)}s</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Answers */}
      <div className="space-y-3">
        {result.answers.map((qa, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500">Q{index + 1}</span>
                    {qa.status === 'streaming' && (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    )}
                    {qa.status === 'completed' && (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    )}
                    {qa.status === 'failed' && (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                  </div>
                  <h3 className="font-medium text-gray-900">{qa.question}</h3>
                </div>
                {qa.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyAnswer(qa.answer)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>

            {qa.answer && (
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  {expandedAnswers.has(index) || qa.answer.length < 300 ? (
                    <div className="whitespace-pre-wrap text-gray-700">{qa.answer}</div>
                  ) : (
                    <div className="whitespace-pre-wrap text-gray-700">
                      {qa.answer.slice(0, 300)}...
                    </div>
                  )}

                  {qa.answer.length > 300 && (
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-2 p-0"
                      onClick={() => toggleAnswer(index)}
                    >
                      {expandedAnswers.has(index) ? 'Show less' : 'Show more'}
                    </Button>
                  )}
                </div>

                {qa.status === 'failed' && qa.error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">
                      <strong>Error:</strong> {qa.error}
                    </p>
                  </div>
                )}
              </CardContent>
            )}

            {qa.status === 'pending' && (
              <CardContent>
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Waiting to process...</span>
                </div>
              </CardContent>
            )}

            {qa.status === 'streaming' && !qa.answer && (
              <CardContent>
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Generating answer...</span>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {result.answers.length === 0 && result.status === 'running' && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p>Processing questions...</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
