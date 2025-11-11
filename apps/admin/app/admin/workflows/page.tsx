'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WorkflowCard } from '@/components/workflow/workflow-card';
import { WorkflowForm } from '@/components/workflow/workflow-form';
import { workflows, getWorkflowsByCategory, type WorkflowMetadata } from '@/lib/workflow-schemas';
import { getPresetsByWorkflowId, type WorkflowPreset } from '@/lib/workflow-presets';
import type { WorkflowInput } from '@/lib/workflow-schemas';
import { ArrowLeft } from 'lucide-react';

export default function WorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowMetadata | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<WorkflowPreset | null>(null);

  const ingestionWorkflows = getWorkflowsByCategory('ingestion');
  const graphWorkflows = getWorkflowsByCategory('graph');
  const analyticsWorkflows = getWorkflowsByCategory('analytics');

  const handleWorkflowSelect = (workflow: WorkflowMetadata) => {
    setSelectedWorkflow(workflow);
    setSelectedPreset(null);
  };

  const handlePresetSelect = (preset: WorkflowPreset) => {
    setSelectedPreset(preset);
  };

  const handleSubmit = async (data: WorkflowInput) => {
    if (!selectedWorkflow) throw new Error('No workflow selected');

    const response = await fetch('/api/workflows/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflowType: selectedWorkflow.workflowType,
        input: data,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start workflow');
    }

    return response.json();
  };

  const handleCancel = () => {
    setSelectedWorkflow(null);
    setSelectedPreset(null);
  };

  // Show form if workflow is selected
  if (selectedWorkflow) {
    const presets = getPresetsByWorkflowId(selectedWorkflow.id);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleCancel}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Workflows
          </Button>
        </div>

        {/* Presets */}
        {presets.length > 0 && (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium mb-2">Quick Examples</h3>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    variant={selectedPreset?.id === preset.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetSelect(preset)}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <WorkflowForm
          workflow={selectedWorkflow}
          defaultValues={selectedPreset?.input}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  // Show workflow grid
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Workflow Launcher</h2>
        <p className="text-muted-foreground">
          Launch and configure workflows for data ingestion, graph analysis, and advanced analytics
        </p>
      </div>

      {/* Data Ingestion */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold">Data Ingestion</h3>
          <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200">
            {ingestionWorkflows.length} workflows
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ingestionWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onSelect={() => handleWorkflowSelect(workflow)}
            />
          ))}
        </div>
      </section>

      {/* Graph Analysis */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold">Graph Analysis</h3>
          <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200">
            {graphWorkflows.length} workflows
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {graphWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onSelect={() => handleWorkflowSelect(workflow)}
            />
          ))}
        </div>
      </section>

      {/* Advanced Analytics */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold">Advanced Analytics</h3>
          <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
            {analyticsWorkflows.length} workflows
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {analyticsWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onSelect={() => handleWorkflowSelect(workflow)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
