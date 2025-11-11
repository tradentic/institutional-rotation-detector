'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Play, X } from 'lucide-react';

interface CustomQuestionFormProps {
  onSubmit: (questions: string[], ticker?: string) => void;
  isSubmitting?: boolean;
}

export function CustomQuestionForm({ onSubmit, isSubmitting = false }: CustomQuestionFormProps) {
  const [questions, setQuestions] = useState<string[]>(['']);
  const [ticker, setTicker] = useState<string>('');

  const addQuestion = () => {
    setQuestions([...questions, '']);
  };

  const removeQuestion = (index: number) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[index] = value;
    setQuestions(newQuestions);
  };

  const handleSubmit = () => {
    const validQuestions = questions.filter((q) => q.trim().length > 0);
    if (validQuestions.length > 0) {
      onSubmit(validQuestions, ticker || undefined);
    }
  };

  const handleClear = () => {
    setQuestions(['']);
    setTicker('');
  };

  const validQuestionCount = questions.filter((q) => q.trim().length > 0).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Custom Questions</CardTitle>
          <Badge variant="outline">
            {validQuestionCount} question{validQuestionCount !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ticker Context (Optional) */}
        <div>
          <Label htmlFor="ticker">Ticker Context (Optional)</Label>
          <Input
            id="ticker"
            placeholder="e.g., AAPL, MSFT (leave empty for cross-stock queries)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            disabled={isSubmitting}
          />
          <p className="text-xs text-gray-500 mt-1">
            Provide a ticker to focus questions on a specific stock, or leave empty for general queries
          </p>
        </div>

        {/* Questions */}
        <div className="space-y-3">
          <Label>Questions</Label>
          {questions.map((question, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-400">
                    Q{index + 1}
                  </span>
                  <Input
                    placeholder="Enter your question..."
                    value={question}
                    onChange={(e) => updateQuestion(index, e.target.value)}
                    disabled={isSubmitting}
                    className="pl-12"
                  />
                </div>
              </div>
              {questions.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => removeQuestion(index)}
                  disabled={isSubmitting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          {questions.length < 10 && (
            <Button
              variant="outline"
              size="sm"
              onClick={addQuestion}
              disabled={isSubmitting}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Another Question
            </Button>
          )}

          {questions.length >= 10 && (
            <p className="text-xs text-orange-600">
              ⚠️ Maximum of 10 questions per batch
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || validQuestionCount === 0}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run {validQuestionCount} Question{validQuestionCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={isSubmitting}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>

        {/* Help Text */}
        <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-200">
          <p className="font-semibold mb-1">💡 Tips for good questions:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Be specific about what you want to know</li>
            <li>Use institution names or tickers when relevant</li>
            <li>Ask about trends, patterns, or specific data points</li>
            <li>Questions can span multiple stocks or time periods</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
