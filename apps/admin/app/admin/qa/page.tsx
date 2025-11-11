'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CustomQuestionForm } from '@/components/qa/custom-question-form';
import { QAResults, QAResultData, QAAnswer } from '@/components/qa/qa-results';
import { QA_PRESETS, getCategoryInfo, QA_CATEGORIES } from '@/lib/qa-presets';
import { Play, Clock, ChevronRight } from 'lucide-react';

export default function QAPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState<QAResultData | null>(null);

  const handleRunPreset = async (presetId: string) => {
    const preset = QA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    await runQuestions(preset.questions, preset.ticker);
  };

  const handleRunCustom = async (questions: string[], ticker?: string) => {
    await runQuestions(questions, ticker);
  };

  const runQuestions = async (questions: string[], ticker?: string) => {
    setIsRunning(true);

    // Generate workflow ID
    const workflowId = `qa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Initialize result
    const result: QAResultData = {
      workflowId,
      status: 'running',
      answers: questions.map((q) => ({
        question: q,
        answer: '',
        status: 'pending',
      })),
      startedAt: new Date(),
    };

    setCurrentResult(result);

    try {
      // Call API to start workflow
      const response = await fetch('/api/qa/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          questions,
          ticker,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start Q&A workflow');
      }

      const data = await response.json();

      // Update workflow ID from server
      result.workflowId = data.workflowId;
      setCurrentResult({ ...result });

      // Simulate streaming results (in real implementation, use SSE)
      // For now, we'll just mark all as completed after a delay
      setTimeout(() => {
        const completedResult: QAResultData = {
          ...result,
          status: 'completed',
          answers: questions.map((q, i) => ({
            question: q,
            answer: `This is a placeholder answer for: "${q}".\n\nIn the actual implementation, this would be the real answer from the graphExplore workflow powered by GPT-5 analyzing the institutional ownership graph.\n\nThe answer would include:\n- Relevant institutions and their positions\n- Statistical analysis and trends\n- Specific data points from the graph\n- AI-generated insights and narratives`,
            status: 'completed',
          })),
          tokenUsage: {
            inputTokens: Math.floor(Math.random() * 5000) + 2000,
            outputTokens: Math.floor(Math.random() * 3000) + 1000,
            totalTokens: 0,
            estimatedCost: (Math.random() * 0.5) + 0.1,
          },
          executionTime: Math.random() * 30 + 15,
          completedAt: new Date(),
        };
        completedResult.tokenUsage!.totalTokens =
          completedResult.tokenUsage!.inputTokens + completedResult.tokenUsage!.outputTokens;

        setCurrentResult(completedResult);
        setIsRunning(false);
      }, 3000);

    } catch (error) {
      console.error('Error running Q&A:', error);
      const failedResult: QAResultData = {
        ...result,
        status: 'failed',
        answers: result.answers.map((a) => ({
          ...a,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
      };
      setCurrentResult(failedResult);
      setIsRunning(false);
    }
  };

  const handleClearResults = () => {
    setCurrentResult(null);
  };

  const filteredPresets = selectedCategory
    ? QA_PRESETS.filter((p) => p.category === selectedCategory)
    : QA_PRESETS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Q&A Console</h2>
        <p className="text-muted-foreground">
          Interactive graph exploration and analysis with pre-baked questions
        </p>
      </div>

      {/* Results (if any) */}
      {currentResult && (
        <QAResults result={currentResult} onClear={handleClearResults} />
      )}

      {/* Custom Question Form */}
      {!currentResult && (
        <CustomQuestionForm
          onSubmit={handleRunCustom}
          isSubmitting={isRunning}
        />
      )}

      {/* Pre-baked Questions */}
      {!currentResult && (
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-semibold mb-2">Pre-baked Questions</h3>
            <p className="text-sm text-gray-600">
              Select from curated question sets designed to explore different aspects of the institutional ownership graph
            </p>
          </div>

          {/* Category Filters */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              All Categories ({QA_PRESETS.length})
            </Button>
            {QA_CATEGORIES.map((category) => {
              const count = QA_PRESETS.filter((p) => p.category === category.id).length;
              return (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.label} ({count})
                </Button>
              );
            })}
          </div>

          {/* Preset Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPresets.map((preset) => {
              const categoryInfo = getCategoryInfo(preset.category);
              return (
                <Card
                  key={preset.id}
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{preset.icon}</span>
                        <div>
                          <CardTitle className="text-base">{preset.name}</CardTitle>
                          {preset.ticker && (
                            <Badge variant="outline" className="mt-1">
                              {preset.ticker}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-2">{preset.description}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Category Badge */}
                      <Badge
                        className={`${categoryInfo.bgColor} ${categoryInfo.color} ${categoryInfo.borderColor} border`}
                      >
                        {categoryInfo.label}
                      </Badge>

                      {/* Questions Preview */}
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-gray-500">
                          {preset.questions.length} Questions:
                        </p>
                        {preset.questions.slice(0, 2).map((q, i) => (
                          <p key={i} className="text-xs text-gray-600 truncate">
                            <ChevronRight className="inline h-3 w-3" />
                            {q}
                          </p>
                        ))}
                        {preset.questions.length > 2 && (
                          <p className="text-xs text-gray-500">
                            +{preset.questions.length - 2} more
                          </p>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" />
                          {preset.estimatedDuration}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleRunPreset(preset.id)}
                          disabled={isRunning}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          Run
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filteredPresets.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <p>No presets found for this category</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
