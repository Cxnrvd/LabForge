"use client";

import * as React from "react";
import { Pause, Play, RewindIcon, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { Slider } from "@/components/ui/slider";

export interface ScrubberSample<T> {
  capturedAt: string; // ISO
  data: T;
}

interface TimeScrubberProps<T> {
  samples: ScrubberSample<T>[];
  onSelect: (sample: ScrubberSample<T>) => void;
  /** Optional speed override — defaults to 1x. */
  playbackRateMs?: number;
}

/**
 * Replay control for monitor data. Maintains an index into the
 * heartbeat history; the parent can render whichever heartbeat the
 * scrubber points to. Live mode (rightmost position) follows the
 * stream; dragging back puts the parent into "playback" mode.
 *
 * The replay engine doesn't speed up wall-clock — it advances one
 * sample per ``playbackRateMs`` (default 1 s) so the user can pause,
 * step through, or scrub.
 */
export function TimeScrubber<T>({
  samples,
  onSelect,
  playbackRateMs = 1000,
}: TimeScrubberProps<T>) {
  const [index, setIndex] = React.useState(samples.length - 1);
  const [playing, setPlaying] = React.useState(false);
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Whenever new samples arrive and we're at the tail (live), advance.
  const wasAtTail = React.useRef(true);
  React.useEffect(() => {
    if (samples.length === 0) return;
    if (wasAtTail.current) {
      setIndex(samples.length - 1);
    }
  }, [samples.length]);

  // Notify the parent whenever the index changes.
  React.useEffect(() => {
    if (samples.length === 0) return;
    const sample = samples[Math.max(0, Math.min(index, samples.length - 1))];
    if (sample) onSelectRef.current(sample);
  }, [index, samples]);

  // Playback timer.
  React.useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= samples.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, playbackRateMs);
    return () => window.clearInterval(id);
  }, [playing, samples.length, playbackRateMs]);

  if (samples.length === 0) return null;
  const atTail = index === samples.length - 1;
  wasAtTail.current = atTail;
  const current = samples[index];

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background/80 px-3 py-2 text-xs shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setIndex(0)}
        aria-label="Jump to start"
      >
        <RewindIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setPlaying((p) => !p)}
        aria-pressed={playing}
        aria-label={playing ? "Pause replay" : "Play replay"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setIndex(samples.length - 1)}
        aria-label="Jump to live"
      >
        <SkipForward className="h-3.5 w-3.5" />
      </Button>
      <Slider
        value={[index]}
        min={0}
        max={Math.max(0, samples.length - 1)}
        step={1}
        onValueChange={([next]) => {
          if (next !== undefined) setIndex(next);
        }}
        className="mx-2 flex-1"
      />
      <div className="min-w-[170px] text-right">
        <span className={cn(atTail ? "text-emerald-500" : "text-muted-foreground")}>
          {atTail ? "LIVE" : "REPLAY"}
        </span>
        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
          {current ? new Date(current.capturedAt).toLocaleTimeString() : "—"}
        </span>
      </div>
    </div>
  );
}
