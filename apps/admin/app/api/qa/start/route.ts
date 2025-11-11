import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { questions, ticker } = body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: 'Questions array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Validate questions
    const validQuestions = questions.filter((q) => typeof q === 'string' && q.trim().length > 0);

    if (validQuestions.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid question is required' },
        { status: 400 }
      );
    }

    // Get Temporal client
    const client = await getTemporalClient();

    // Generate workflow ID
    const workflowId = `graph-explore-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Prepare workflow input for graphExplore workflow
    const workflowInput = {
      questions: validQuestions,
      ticker: ticker || undefined,
    };

    // Start the graphExplore workflow
    const handle = await client.start('graphExplore', {
      taskQueue: 'rotation-detector',
      workflowId,
      args: [workflowInput],
    });

    return NextResponse.json({
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      questionCount: validQuestions.length,
    });
  } catch (error) {
    console.error('Error starting Q&A workflow:', error);
    return NextResponse.json(
      {
        error: 'Failed to start Q&A workflow',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
