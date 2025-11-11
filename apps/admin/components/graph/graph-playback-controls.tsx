'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Play,
  Pause,
  RotateCcw,
  Camera,
  Download,
  Gauge,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export type AnimationSpeed = 'slow' | 'medium' | 'fast' | 'instant';

export interface GraphSnapshot {
  id: string;
  timestamp: Date;
  nodeCount: number;
  edgeCount: number;
  description: string;
  graphState: any; // Complete graph state at this point
}

interface GraphPlaybackControlsProps {
  // Playback state
  isStreaming: boolean;
  isPaused: boolean;
  onPauseResume: () => void;
  onRestart: () => void;

  // Speed control
  animationSpeed: AnimationSpeed;
  onSpeedChange: (speed: AnimationSpeed) => void;

  // Timeline navigation
  totalEvents: number;
  currentEventIndex: number;
  onSeek: (index: number) => void;
  canSeek: boolean;

  // Snapshots
  snapshots: GraphSnapshot[];
  onCaptureSnapshot: () => void;
  onLoadSnapshot: (snapshotId: string) => void;
  onExportSnapshot: (snapshotId: string) => void;
}

export function GraphPlaybackControls({
  isStreaming,
  isPaused,
  onPauseResume,
  onRestart,
  animationSpeed,
  onSpeedChange,
  totalEvents,
  currentEventIndex,
  onSeek,
  canSeek,
  snapshots,
  onCaptureSnapshot,
  onLoadSnapshot,
  onExportSnapshot,
}: GraphPlaybackControlsProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);

  const speedOptions: { value: AnimationSpeed; label: string; icon: string }[] = [
    { value: 'slow', label: 'Slow', icon: '🐢' },
    { value: 'medium', label: 'Medium', icon: '🚶' },
    { value: 'fast', label: 'Fast', icon: '🏃' },
    { value: 'instant', label: 'Instant', icon: '⚡' },
  ];

  const progress = totalEvents > 0 ? (currentEventIndex / totalEvents) * 100 : 0;

  return (
    <div className="border rounded-lg bg-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Playback Controls
        </h3>
        <Badge variant={isStreaming ? 'default' : 'secondary'}>
          {isStreaming ? (isPaused ? 'Paused' : 'Streaming') : 'Stopped'}
        </Badge>
      </div>

      {/* Main Controls */}
      <div className="flex items-center gap-2">
        {/* Play/Pause */}
        <Button
          variant="outline"
          size="sm"
          onClick={onPauseResume}
          disabled={!isStreaming}
          className="flex items-center gap-2"
        >
          {isPaused ? (
            <>
              <Play className="h-4 w-4" />
              Resume
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" />
              Pause
            </>
          )}
        </Button>

        {/* Restart */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRestart}
          disabled={currentEventIndex === 0}
          className="flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Restart
        </Button>

        {/* Divider */}
        <div className="h-6 w-px bg-gray-300" />

        {/* Speed Control */}
        <div className="flex items-center gap-1">
          <Gauge className="h-4 w-4 text-gray-600" />
          {speedOptions.map((option) => (
            <Button
              key={option.value}
              variant={animationSpeed === option.value ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onSpeedChange(option.value)}
              className="min-w-[70px]"
              title={`${option.label} speed`}
            >
              <span className="mr-1">{option.icon}</span>
              {option.label}
            </Button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-gray-300" />

        {/* Snapshot */}
        <Button
          variant="outline"
          size="sm"
          onClick={onCaptureSnapshot}
          disabled={currentEventIndex === 0}
          className="flex items-center gap-2"
        >
          <Camera className="h-4 w-4" />
          Snapshot
        </Button>

        {/* Toggle Timeline */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTimeline(!showTimeline)}
          disabled={!canSeek || totalEvents === 0}
        >
          {showTimeline ? '△' : '▽'}
        </Button>
      </div>

      {/* Progress Indicator */}
      {totalEvents > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>
              Event {currentEventIndex} of {totalEvents}
            </span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Timeline Scrubber */}
      {showTimeline && canSeek && totalEvents > 0 && (
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSeek(Math.max(0, currentEventIndex - 1))}
              disabled={currentEventIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <Slider
                value={[currentEventIndex]}
                min={0}
                max={totalEvents}
                step={1}
                onValueChange={([value]) => onSeek(value)}
                className="w-full"
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSeek(Math.min(totalEvents, currentEventIndex + 1))}
              disabled={currentEventIndex === totalEvents}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            Drag slider to navigate through graph construction history
          </div>
        </div>
      )}

      {/* Snapshots Panel */}
      {snapshots.length > 0 && (
        <div className="border-t pt-4 space-y-2">
          <button
            onClick={() => setShowSnapshots(!showSnapshots)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <span className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Snapshots ({snapshots.length})
            </span>
            <span>{showSnapshots ? '△' : '▽'}</span>
          </button>

          {showSnapshots && (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded border hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {snapshot.description}
                    </div>
                    <div className="text-xs text-gray-500">
                      {snapshot.nodeCount} nodes, {snapshot.edgeCount} edges •{' '}
                      {snapshot.timestamp.toLocaleTimeString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLoadSnapshot(snapshot.id)}
                      title="Load snapshot"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onExportSnapshot(snapshot.id)}
                      title="Export snapshot"
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tips */}
      {!isStreaming && currentEventIndex === 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
          <strong>Tip:</strong> Playback controls become active during graph streaming. Use
          pause/resume to control the flow, adjust speed, or capture snapshots at interesting
          moments.
        </div>
      )}
    </div>
  );
}
