/**
 * Temporal Event Parser
 *
 * Parses Temporal workflow history events into human-readable log entries.
 * Supports filtering by event categories and types.
 */

import { WorkflowExecutionInfo } from '@temporalio/client';

// Event categories for filtering
export type EventCategory =
  | 'workflow'
  | 'activity'
  | 'timer'
  | 'signal'
  | 'query'
  | 'child-workflow'
  | 'marker'
  | 'other';

// Event types we care about (subset of 40+ Temporal event types)
export const EVENT_TYPE_CATEGORIES: Record<string, EventCategory> = {
  // Workflow events
  'WorkflowExecutionStarted': 'workflow',
  'WorkflowExecutionCompleted': 'workflow',
  'WorkflowExecutionFailed': 'workflow',
  'WorkflowExecutionTimedOut': 'workflow',
  'WorkflowExecutionCanceled': 'workflow',
  'WorkflowExecutionTerminated': 'workflow',
  'WorkflowExecutionContinuedAsNew': 'workflow',

  // Activity events
  'ActivityTaskScheduled': 'activity',
  'ActivityTaskStarted': 'activity',
  'ActivityTaskCompleted': 'activity',
  'ActivityTaskFailed': 'activity',
  'ActivityTaskTimedOut': 'activity',
  'ActivityTaskCancelRequested': 'activity',
  'ActivityTaskCanceled': 'activity',

  // Timer events
  'TimerStarted': 'timer',
  'TimerFired': 'timer',
  'TimerCanceled': 'timer',

  // Signal events
  'WorkflowExecutionSignaled': 'signal',
  'SignalExternalWorkflowExecutionInitiated': 'signal',
  'SignalExternalWorkflowExecutionFailed': 'signal',

  // Query events (queries don't appear in history, but included for completeness)

  // Child workflow events
  'StartChildWorkflowExecutionInitiated': 'child-workflow',
  'StartChildWorkflowExecutionFailed': 'child-workflow',
  'ChildWorkflowExecutionStarted': 'child-workflow',
  'ChildWorkflowExecutionCompleted': 'child-workflow',
  'ChildWorkflowExecutionFailed': 'child-workflow',
  'ChildWorkflowExecutionCanceled': 'child-workflow',
  'ChildWorkflowExecutionTimedOut': 'child-workflow',
  'ChildWorkflowExecutionTerminated': 'child-workflow',

  // Marker events (used for local activities, side effects, etc.)
  'MarkerRecorded': 'marker',

  // Other
  'WorkflowTaskScheduled': 'other',
  'WorkflowTaskStarted': 'other',
  'WorkflowTaskCompleted': 'other',
  'WorkflowTaskTimedOut': 'other',
  'WorkflowTaskFailed': 'other',
};

// Log level based on event type
export type LogLevel = 'info' | 'success' | 'error' | 'warn' | 'debug';

export interface ParsedEvent {
  eventId: number;
  eventType: string;
  category: EventCategory;
  timestamp: Date;
  level: LogLevel;
  message: string;
  details?: Record<string, any>;
}

// Get log level for an event type
function getLogLevel(eventType: string): LogLevel {
  if (eventType.includes('Completed') || eventType.includes('Fired')) {
    return 'success';
  }
  if (eventType.includes('Failed') || eventType.includes('TimedOut') || eventType.includes('Terminated')) {
    return 'error';
  }
  if (eventType.includes('Canceled') || eventType.includes('CancelRequested')) {
    return 'warn';
  }
  if (eventType.includes('Scheduled') || eventType.includes('Started') || eventType.includes('Initiated')) {
    return 'info';
  }
  return 'debug';
}

// Extract activity name from attributes
function getActivityName(attributes: any): string {
  return attributes?.activityType?.name || attributes?.activityId || 'unknown';
}

// Extract child workflow name from attributes
function getChildWorkflowName(attributes: any): string {
  return attributes?.workflowType?.name || 'unknown';
}

// Extract timer ID from attributes
function getTimerId(attributes: any): string {
  return attributes?.timerId || 'unknown';
}

// Get duration in seconds between two timestamps
function getDurationSeconds(start?: Date, end?: Date): number | undefined {
  if (!start || !end) return undefined;
  return (end.getTime() - start.getTime()) / 1000;
}

// Parse a single Temporal history event
export function parseEvent(event: any, previousEvents: Map<string, any>): ParsedEvent | null {
  const eventType = event.eventType;
  const eventId = event.eventId;
  const timestamp = event.eventTime ? new Date(event.eventTime) : new Date();
  const category = EVENT_TYPE_CATEGORIES[eventType] || 'other';
  const level = getLogLevel(eventType);
  const attributes = event[eventType.charAt(0).toLowerCase() + eventType.slice(1) + 'EventAttributes'] || {};

  let message = '';
  let details: Record<string, any> = {};

  // Parse different event types
  switch (eventType) {
    case 'WorkflowExecutionStarted':
      message = `Workflow started: ${attributes.workflowType?.name || 'unknown'}`;
      details = {
        taskQueue: attributes.taskQueue?.name,
        input: attributes.input,
      };
      break;

    case 'WorkflowExecutionCompleted':
      message = 'Workflow completed successfully';
      details = {
        result: attributes.result,
      };
      break;

    case 'WorkflowExecutionFailed':
      message = `Workflow failed: ${attributes.failure?.message || 'unknown error'}`;
      details = {
        failure: attributes.failure,
      };
      break;

    case 'ActivityTaskScheduled':
      const activityName = getActivityName(attributes);
      message = `Activity scheduled: ${activityName}`;
      details = {
        activityId: attributes.activityId,
        taskQueue: attributes.taskQueue?.name,
      };
      // Store for later reference
      previousEvents.set(`activity-${attributes.activityId}`, {
        name: activityName,
        scheduledTime: timestamp,
      });
      break;

    case 'ActivityTaskStarted':
      const activityInfo = previousEvents.get(`activity-${attributes.activityId}`);
      message = `Activity started: ${activityInfo?.name || 'unknown'} (attempt ${attributes.attempt || 1})`;
      details = {
        activityId: attributes.activityId,
        attempt: attributes.attempt,
      };
      if (activityInfo) {
        previousEvents.set(`activity-${attributes.activityId}`, {
          ...activityInfo,
          startedTime: timestamp,
        });
      }
      break;

    case 'ActivityTaskCompleted':
      const completedActivity = previousEvents.get(`activity-${attributes.activityId}`);
      const duration = getDurationSeconds(completedActivity?.startedTime, timestamp);
      message = `Activity completed: ${completedActivity?.name || 'unknown'}`;
      if (duration !== undefined) {
        message += ` (${duration.toFixed(2)}s)`;
      }
      details = {
        activityId: attributes.activityId,
        duration,
        result: attributes.result,
      };
      break;

    case 'ActivityTaskFailed':
      const failedActivity = previousEvents.get(`activity-${attributes.activityId}`);
      message = `Activity failed: ${failedActivity?.name || 'unknown'} - ${attributes.failure?.message || 'unknown error'}`;
      details = {
        activityId: attributes.activityId,
        failure: attributes.failure,
        retryState: attributes.retryState,
      };
      break;

    case 'ActivityTaskTimedOut':
      const timedOutActivity = previousEvents.get(`activity-${attributes.activityId}`);
      message = `Activity timed out: ${timedOutActivity?.name || 'unknown'}`;
      details = {
        activityId: attributes.activityId,
        retryState: attributes.retryState,
      };
      break;

    case 'TimerStarted':
      const timerId = getTimerId(attributes);
      const durationMs = attributes.startToFireTimeout ? parseInt(attributes.startToFireTimeout.seconds || '0') * 1000 : 0;
      message = `Timer started: ${timerId} (${(durationMs / 1000).toFixed(1)}s)`;
      details = {
        timerId,
        duration: durationMs / 1000,
      };
      previousEvents.set(`timer-${timerId}`, {
        startTime: timestamp,
        duration: durationMs,
      });
      break;

    case 'TimerFired':
      const firedTimerId = getTimerId(attributes);
      const timerInfo = previousEvents.get(`timer-${firedTimerId}`);
      message = `Timer fired: ${firedTimerId}`;
      details = {
        timerId: firedTimerId,
        elapsed: getDurationSeconds(timerInfo?.startTime, timestamp),
      };
      break;

    case 'WorkflowExecutionSignaled':
      message = `Signal received: ${attributes.signalName}`;
      details = {
        signalName: attributes.signalName,
        input: attributes.input,
      };
      break;

    case 'StartChildWorkflowExecutionInitiated':
      const childWorkflowName = getChildWorkflowName(attributes);
      message = `Child workflow initiated: ${childWorkflowName}`;
      details = {
        workflowId: attributes.workflowId,
        workflowType: childWorkflowName,
      };
      break;

    case 'ChildWorkflowExecutionStarted':
      message = `Child workflow started: ${attributes.workflowType?.name || 'unknown'}`;
      details = {
        workflowId: attributes.workflowExecution?.workflowId,
      };
      break;

    case 'ChildWorkflowExecutionCompleted':
      message = `Child workflow completed: ${attributes.workflowType?.name || 'unknown'}`;
      details = {
        workflowId: attributes.workflowExecution?.workflowId,
        result: attributes.result,
      };
      break;

    case 'ChildWorkflowExecutionFailed':
      message = `Child workflow failed: ${attributes.workflowType?.name || 'unknown'}`;
      details = {
        workflowId: attributes.workflowExecution?.workflowId,
        failure: attributes.failure,
      };
      break;

    case 'MarkerRecorded':
      message = `Marker: ${attributes.markerName}`;
      details = {
        markerName: attributes.markerName,
        details: attributes.details,
      };
      break;

    // Skip low-level workflow task events by default
    case 'WorkflowTaskScheduled':
    case 'WorkflowTaskStarted':
    case 'WorkflowTaskCompleted':
      return null; // Filter out unless explicitly requested

    default:
      // Generic fallback for unhandled event types
      message = `${eventType}`;
      details = attributes;
      break;
  }

  return {
    eventId,
    eventType,
    category,
    timestamp,
    level,
    message,
    details,
  };
}

// Parse all history events
export function parseHistoryEvents(
  historyEvents: any[],
  enabledCategories?: EventCategory[]
): ParsedEvent[] {
  const parsedEvents: ParsedEvent[] = [];
  const previousEvents = new Map<string, any>();

  for (const event of historyEvents) {
    const parsed = parseEvent(event, previousEvents);

    if (parsed) {
      // Filter by category if specified
      if (!enabledCategories || enabledCategories.includes(parsed.category)) {
        parsedEvents.push(parsed);
      }
    }
  }

  return parsedEvents;
}

// Get all available event categories
export function getAllCategories(): EventCategory[] {
  return ['workflow', 'activity', 'timer', 'signal', 'child-workflow', 'marker', 'other'];
}

// Default enabled categories (most useful ones)
export function getDefaultCategories(): EventCategory[] {
  return ['workflow', 'activity', 'timer', 'child-workflow'];
}
