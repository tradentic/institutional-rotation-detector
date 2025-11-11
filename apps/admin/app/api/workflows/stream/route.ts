import { NextRequest } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';
import {
  parseHistoryEvents,
  EventCategory,
  getDefaultCategories,
  ParsedEvent,
} from '@/lib/temporal-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper to format timestamp
function formatTime(date: Date) {
  return date.toTimeString().split(' ')[0];
}

// Helper to calculate progress percentage based on status
function calculateProgress(status: string, historyLength: number, totalEstimatedEvents: number = 100): number {
  switch (status) {
    case 'RUNNING':
      // Calculate percentage based on history length vs estimated total
      return Math.min(Math.round((historyLength / totalEstimatedEvents) * 100), 95);
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

  // Parse event category filters from query params
  // Format: ?categories=workflow,activity,timer
  const categoriesParam = request.nextUrl.searchParams.get('categories');
  const enabledCategories: EventCategory[] = categoriesParam
    ? (categoriesParam.split(',') as EventCategory[])
    : getDefaultCategories();

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
          message: `Connected to workflow stream (filters: ${enabledCategories.join(', ')})`,
          timestamp: formatTime(new Date()),
        });

        // Track last seen event ID to avoid sending duplicates
        let lastEventId = 0;

        // Poll workflow history for new events
        const pollInterval = setInterval(async () => {
          try {
            const description = await handle.describe();

            // Fetch workflow history
            // Note: For very large workflows, you might want to paginate or only fetch recent events
            const history = await handle.fetchHistory();
            const historyEvents: any[] = [];

            for await (const event of history as any) {
              historyEvents.push(event);
            }

            // Parse new events (only those we haven't seen yet)
            const newEvents = historyEvents.filter((e) => e.eventId > lastEventId);

            if (newEvents.length > 0) {
              const parsedEvents = parseHistoryEvents(newEvents, enabledCategories);

              // Send each parsed event as a log entry
              for (const event of parsedEvents) {
                sendEvent({
                  type: 'log',
                  workflowId,
                  level: event.level,
                  message: event.message,
                  timestamp: formatTime(event.timestamp),
                  eventId: event.eventId,
                  eventType: event.eventType,
                  category: event.category,
                  details: event.details,
                });
              }

              // Update last seen event ID
              lastEventId = Math.max(...newEvents.map((e) => e.eventId));
            }

            // Send progress update
            const progress = calculateProgress(
              description.status.name,
              description.historyLength,
              description.historyLength + 20 // Rough estimate of remaining events
            );

            sendEvent({
              type: 'progress',
              workflowId,
              status: description.status.name,
              percent: progress,
              message: `Workflow ${description.status.name.toLowerCase()}`,
              timestamp: formatTime(new Date()),
              historyLength: description.historyLength,
            });

            // If workflow is complete, send final event and close
            if (
              description.status.name === 'COMPLETED' ||
              description.status.name === 'FAILED' ||
              description.status.name === 'TERMINATED' ||
              description.status.name === 'CANCELLED'
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
              level: 'error',
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
          level: 'error',
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
