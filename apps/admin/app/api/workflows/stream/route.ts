import { NextRequest } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper to format timestamp
function formatTime(date: Date) {
  return date.toTimeString().split(' ')[0];
}

// Helper to calculate progress percentage based on status
function calculateProgress(status: string, historyLength: number): number {
  switch (status) {
    case 'RUNNING':
      // Estimate progress based on history length (rough approximation)
      return Math.min(historyLength * 2, 95);
    case 'COMPLETED':
      return 100;
    case 'FAILED':
    case 'TERMINATED':
    case 'CANCELED':
      return 100;
    default:
      return 0;
  }
}

export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('id');

  if (!workflowId) {
    return new Response('Missing workflow ID', { status: 400 });
  }

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Helper to send SSE message
      const sendEvent = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        const client = await getTemporalClient();
        const handle = client.getHandle(workflowId);

        // Send initial event
        sendEvent({
          type: 'connected',
          workflowId,
          message: 'Connected to workflow stream',
          timestamp: formatTime(new Date()),
        });

        // Poll workflow status
        const pollInterval = setInterval(async () => {
          try {
            const description = await handle.describe();
            const progress = calculateProgress(description.status.name, description.historyLength);

            sendEvent({
              type: 'progress',
              workflowId,
              status: description.status.name,
              percent: progress,
              message: `Workflow ${description.status.name.toLowerCase()}`,
              timestamp: formatTime(new Date()),
              historyLength: description.historyLength,
            });

            // Send activity updates (simulated for now - in real implementation,
            // you'd need to query workflow history for actual activity info)
            if (description.status.name === 'RUNNING') {
              sendEvent({
                type: 'log',
                workflowId,
                level: 'info',
                message: `Processing... (history events: ${description.historyLength})`,
                timestamp: formatTime(new Date()),
              });
            }

            // If workflow is complete, close the stream
            if (
              description.status.name === 'COMPLETED' ||
              description.status.name === 'FAILED' ||
              description.status.name === 'TERMINATED' ||
              description.status.name === 'CANCELED'
            ) {
              sendEvent({
                type: 'complete',
                workflowId,
                status: description.status.name,
                message: `Workflow ${description.status.name.toLowerCase()}`,
                timestamp: formatTime(new Date()),
              });

              clearInterval(pollInterval);
              controller.close();
            }
          } catch (error) {
            sendEvent({
              type: 'error',
              workflowId,
              message: error instanceof Error ? error.message : 'Unknown error',
              timestamp: formatTime(new Date()),
            });
            clearInterval(pollInterval);
            controller.close();
          }
        }, 1000); // Poll every second

        // Clean up on client disconnect
        request.signal.addEventListener('abort', () => {
          clearInterval(pollInterval);
          controller.close();
        });
      } catch (error) {
        sendEvent({
          type: 'error',
          workflowId,
          message: error instanceof Error ? error.message : 'Failed to connect to workflow',
          timestamp: formatTime(new Date()),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
