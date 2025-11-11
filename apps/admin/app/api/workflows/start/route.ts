import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowType, input } = body;

    if (!workflowType) {
      return NextResponse.json(
        { error: 'workflowType is required' },
        { status: 400 }
      );
    }

    if (!input) {
      return NextResponse.json(
        { error: 'input is required' },
        { status: 400 }
      );
    }

    // Get Temporal client
    const client = await getTemporalClient();

    // Generate workflow ID
    const workflowId = `${workflowType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Start workflow
    const handle = await client.start(workflowType, {
      taskQueue: 'rotation-detector',
      workflowId,
      args: [input],
    });

    return NextResponse.json({
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });
  } catch (error) {
    console.error('Failed to start workflow:', error);

    // Check if it's a Temporal error
    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: error.message,
          details: 'name' in error ? (error as any).name : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
