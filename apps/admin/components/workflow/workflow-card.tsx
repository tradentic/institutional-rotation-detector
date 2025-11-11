'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import type { WorkflowMetadata } from '@/lib/workflow-schemas';

interface WorkflowCardProps {
  workflow: WorkflowMetadata;
  onSelect: () => void;
}

const categoryColors = {
  ingestion: 'bg-blue-100 text-blue-700 border-blue-200',
  graph: 'bg-purple-100 text-purple-700 border-purple-200',
  analytics: 'bg-green-100 text-green-700 border-green-200',
};

export function WorkflowCard({ workflow, onSelect }: WorkflowCardProps) {
  return (
    <Card className="hover:shadow-lg transition-all cursor-pointer group" onClick={onSelect}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{workflow.icon}</div>
            <div>
              <CardTitle className="text-lg group-hover:text-primary transition-colors">
                {workflow.name}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={categoryColors[workflow.category]}
                >
                  {workflow.category}
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {workflow.estimatedDuration}
                </div>
              </div>
            </div>
          </div>
        </div>
        <CardDescription className="mt-2">{workflow.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          Configure & Launch
        </Button>
      </CardContent>
    </Card>
  );
}
