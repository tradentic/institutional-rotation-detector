import { NextRequest } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workflowId } = await params;

  try {
    const client = await getTemporalClient();
    const handle = client.getHandle(workflowId);

    // Get workflow description
    const description = await handle.describe();

    return Response.json({
      workflowId: description.workflowId,
      runId: description.runId,
      type: description.type,
      status: description.status.name,
      startTime: description.startTime,
      closeTime: description.closeTime,
      historyLength: description.historyLength,
    });
  } catch (error) {
    console.error(`Failed to get workflow ${workflowId}:`, error);

    if (error instanceof Error) {
      return Response.json(
        { error: error.message },
        { status: 404 }
      );
    }

    return Response.json(
      { error: 'Workflow not found' },
      { status: 404 }
    );
  }
}
