'use client';

import { useState } from 'react';
import { useForm, FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { WorkflowMetadata } from '@/lib/workflow-schemas';
import type { WorkflowInput } from '@/lib/workflow-schemas';

interface WorkflowFormProps {
  workflow: WorkflowMetadata;
  defaultValues?: Record<string, any>;
  onSubmit: (data: WorkflowInput) => Promise<{ workflowId: string }>;
  onCancel: () => void;
}

export function WorkflowForm({ workflow, defaultValues, onSubmit, onCancel }: WorkflowFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<Record<string, any>>({
    resolver: zodResolver(workflow.schema as any) as any,
    defaultValues: defaultValues || {},
  });

  const onFormSubmit = async (data: any) => {
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await onSubmit(data);
      setResult({
        success: true,
        message: `Workflow started successfully! ID: ${response.workflowId}`,
      });
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start workflow',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to safely get error message
  const getError = (fieldName: string): string | undefined => {
    const error = (errors as Record<string, any>)[fieldName];
    return error?.message as string | undefined;
  };

  // Helper to safely get default value
  const getDefaultValue = (fieldName: string): any => {
    return defaultValues?.[fieldName];
  };

  // Get form field definitions based on workflow ID
  const getFormFields = () => {
    switch (workflow.id) {
      case 'ingest-issuer':
        return (
          <>
            <FormField
              label="Ticker"
              error={getError('ticker')}
            >
              <Input
                {...register('ticker')}
                placeholder="AAPL"
                disabled={isSubmitting}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="From"
                error={getError('from')}
              >
                <Input
                  {...register('from')}
                  placeholder="2024Q1"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                label="To"
                error={getError('to')}
              >
                <Input
                  {...register('to')}
                  placeholder="2024Q4"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Run Kind"
                error={getError('runKind')}
              >
                <Select
                  onValueChange={(value) => setValue('runKind', value)}
                  defaultValue={getDefaultValue('runKind') || 'daily'}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select run kind" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">daily</SelectItem>
                    <SelectItem value="backfill">backfill</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField
                label="Min %"
                error={getError('minPct')}
              >
                <Input
                  {...register('minPct')}
                  type="number"
                  placeholder="5"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>
          </>
        );

      case 'graph-build':
      case 'graph-summarize':
        return (
          <>
            <FormField
              label="CIK"
              error={getError('cik')}
            >
              <Input
                {...register('cik')}
                placeholder="0000320193"
                disabled={isSubmitting}
              />
            </FormField>

            <FormField
              label="Quarter"
              error={getError('quarter')}
            >
              <Input
                {...register('quarter')}
                placeholder="2024Q1"
                disabled={isSubmitting}
              />
            </FormField>

            <FormField
              label="Ticker (optional)"
              error={getError('ticker')}
            >
              <Input
                {...register('ticker')}
                placeholder="AAPL"
                disabled={isSubmitting}
              />
            </FormField>

            <FormField
              label="Run Kind"
              error={getError('runKind')}
            >
              <Select
                onValueChange={(value) => setValue('runKind', value)}
                defaultValue={getDefaultValue('runKind') || 'daily'}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select run kind" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">daily</SelectItem>
                  <SelectItem value="backfill">backfill</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </>
        );

      case 'graph-explore':
        return (
          <>
            <FormField
              label="Ticker (optional)"
              error={getError('ticker')}
            >
              <Input
                {...register('ticker')}
                placeholder="AAPL"
                disabled={isSubmitting}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Period Start"
                error={getError('periodStart')}
              >
                <Input
                  {...register('periodStart')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                label="Period End"
                error={getError('periodEnd')}
              >
                <Input
                  {...register('periodEnd')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <FormField
              label="Hops"
              error={getError('hops')}
            >
              <Input
                {...register('hops')}
                type="number"
                min="1"
                max="3"
                placeholder="2"
                disabled={isSubmitting}
              />
            </FormField>

            <div className="space-y-2">
              <Label>Questions (one per line)</Label>
              <textarea
                {...register('questions')}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="What institutions are rotating in and out?&#10;Are these the same institutions from last quarter?&#10;What are the key insights?"
                disabled={isSubmitting}
                onChange={(e) => {
                  const questions = e.target.value.split('\n').filter(q => q.trim());
                  setValue('questions', questions);
                }}
                defaultValue={getDefaultValue('questions')?.join('\n') || ''}
              />
              {getError('questions') && (
                <p className="text-sm text-destructive">{getError('questions')}</p>
              )}
            </div>
          </>
        );

      case 'statistical-analysis':
        return (
          <>
            <FormField
              label="Analysis Type"
              error={getError('analysisType')}
            >
              <Select
                onValueChange={(value) => setValue('analysisType', value)}
                defaultValue={getDefaultValue('analysisType')}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select analysis type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="correlation">Correlation</SelectItem>
                  <SelectItem value="regression">Regression</SelectItem>
                  <SelectItem value="anomaly">Anomaly Detection</SelectItem>
                  <SelectItem value="custom">Custom Code</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Period Start"
                error={getError('periodStart')}
              >
                <Input
                  {...register('periodStart')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                label="Period End"
                error={getError('periodEnd')}
              >
                <Input
                  {...register('periodEnd')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            {(watch as any)('analysisType') === 'correlation' && (
              <FormField
                label="Variables (comma-separated)"
                error={getError('variables')}
              >
                <Input
                  {...register('variables')}
                  placeholder="dumpz, car_m5_p20"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const vars = e.target.value.split(',').map(v => v.trim()).filter(v => v);
                    setValue('variables', vars);
                  }}
                />
              </FormField>
            )}
          </>
        );

      case 'cross-community':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Period Start"
                error={getError('periodStart')}
              >
                <Input
                  {...register('periodStart')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                label="Period End"
                error={getError('periodEnd')}
              >
                <Input
                  {...register('periodEnd')}
                  type="date"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <FormField
              label="Min Communities (optional)"
              error={getError('minCommunities')}
            >
              <Input
                {...register('minCommunities')}
                type="number"
                min="1"
                placeholder="3"
                disabled={isSubmitting}
              />
            </FormField>
          </>
        );

      default:
        return (
          <div className="text-center text-muted-foreground py-8">
            Form fields for this workflow will be added in the next iteration
          </div>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-2xl">{workflow.icon}</span>
          {workflow.name}
        </CardTitle>
        <CardDescription>{workflow.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
          {getFormFields()}

          {result && (
            <Alert variant={result.success ? 'default' : 'destructive'}>
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertDescription>{result.message}</AlertDescription>
              </div>
            </Alert>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Launch Workflow
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
