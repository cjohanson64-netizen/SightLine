import type {
  CleanPitchFrame,
  ExpectedRhythm,
  NoteSegmentationOutput,
  SungNoteEvent,
} from "../types";
import { frequencyToMidiFloat } from "./pitchMath";

const DEFAULT_MIN_FRAME_CLARITY = 0.75;
const INNER_WINDOW_RATIO = 0.15;
const MAX_EDGE_TRIM_MS = 90;
const MIN_CORE_FRAME_COUNT = 2;

export interface RhythmGuidedSegmentationInput {
  frames: CleanPitchFrame[];
  expectedRhythm: ExpectedRhythm;
  minFrameClarity?: number;
}

function emptyOutput(): NoteSegmentationOutput {
  return { noteEvents: [] };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function getFrameStepMs(frames: CleanPitchFrame[]): number {
  const steps: number[] = [];

  for (let index = 1; index < frames.length; index += 1) {
    const step = frames[index].timeMs - frames[index - 1].timeMs;

    if (step > 0) {
      steps.push(step);
    }
  }

  return median(steps);
}

function getTotalUnits(expectedRhythm: ExpectedRhythm): number {
  return expectedRhythm.units.reduce((sum, units) => sum + units, 0);
}

function getPhraseSpan(frames: CleanPitchFrame[]): {
  startMs: number;
  endMs: number;
} {
  const frameStepMs = getFrameStepMs(frames);
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];

  return {
    startMs: firstFrame.timeMs,
    endMs: lastFrame.timeMs + frameStepMs,
  };
}

function getTempoMsPerUnit(params: {
  phraseStartMs: number;
  phraseEndMs: number;
  expectedRhythm: ExpectedRhythm;
}): number {
  const { phraseStartMs, phraseEndMs, expectedRhythm } = params;
  const totalUnits = getTotalUnits(expectedRhythm);

  if (totalUnits <= 0) {
    return 0;
  }

  return (phraseEndMs - phraseStartMs) / totalUnits;
}

function getWindowBounds(params: {
  phraseStartMs: number;
  tempoMsPerUnit: number;
  expectedRhythm: ExpectedRhythm;
}): Array<{ startMs: number; endMs: number; expectedUnits: number }> {
  const { phraseStartMs, tempoMsPerUnit, expectedRhythm } = params;
  const windows: Array<{
    startMs: number;
    endMs: number;
    expectedUnits: number;
  }> = [];

  let cursorMs = phraseStartMs;

  for (const expectedUnits of expectedRhythm.units) {
    const startMs = cursorMs;
    const endMs = startMs + expectedUnits * tempoMsPerUnit;

    windows.push({
      startMs,
      endMs,
      expectedUnits,
    });

    cursorMs = endMs;
  }

  return windows;
}

function getCoreWindowBounds(window: {
  startMs: number;
  endMs: number;
}): { startMs: number; endMs: number } {
  const durationMs = window.endMs - window.startMs;
  const edgeTrimMs = Math.min(durationMs * INNER_WINDOW_RATIO, MAX_EDGE_TRIM_MS);

  return {
    startMs: window.startMs + edgeTrimMs,
    endMs: window.endMs - edgeTrimMs,
  };
}

function getFramesInWindow(
  frames: CleanPitchFrame[],
  window: { startMs: number; endMs: number },
): CleanPitchFrame[] {
  return frames.filter(
    (frame) => frame.timeMs >= window.startMs && frame.timeMs < window.endMs,
  );
}

function getUsablePitchFrames(params: {
  frames: CleanPitchFrame[];
  window: { startMs: number; endMs: number };
  minFrameClarity: number;
}): CleanPitchFrame[] {
  const { frames, window, minFrameClarity } = params;
  const coreWindow = getCoreWindowBounds(window);

  const coreFrames = getFramesInWindow(frames, coreWindow).filter(
    (frame) =>
      Number.isFinite(frame.stablePitchHz) &&
      frame.stablePitchHz > 0 &&
      frame.clarity >= minFrameClarity,
  );

  if (coreFrames.length >= MIN_CORE_FRAME_COUNT) {
    return coreFrames;
  }

  return getFramesInWindow(frames, window).filter(
    (frame) =>
      Number.isFinite(frame.stablePitchHz) &&
      frame.stablePitchHz > 0 &&
      frame.clarity >= minFrameClarity,
  );
}

function buildNoteEvent(params: {
  frames: CleanPitchFrame[];
  window: { startMs: number; endMs: number };
  index: number;
}): SungNoteEvent | null {
  const { frames, window, index } = params;

  if (frames.length === 0) {
    return null;
  }

  const pitchHz = average(frames.map((frame) => frame.stablePitchHz));
  const confidence = average(frames.map((frame) => frame.clarity));
  const midiFloat = frequencyToMidiFloat(pitchHz);

  return {
    id: `rg${index + 1}`,
    startMs: window.startMs,
    endMs: window.endMs,
    durationMs: window.endMs - window.startMs,
    pitchHz,
    midiFloat,
    confidence,
  };
}

export const rhythmGuidedSegmentationService = {
  run(input: RhythmGuidedSegmentationInput): NoteSegmentationOutput {
    if (
      !input.frames ||
      input.frames.length === 0 ||
      !input.expectedRhythm.units ||
      input.expectedRhythm.units.length === 0
    ) {
      return emptyOutput();
    }

    const phraseSpan = getPhraseSpan(input.frames);
    const tempoMsPerUnit = getTempoMsPerUnit({
      phraseStartMs: phraseSpan.startMs,
      phraseEndMs: phraseSpan.endMs,
      expectedRhythm: input.expectedRhythm,
    });

    if (tempoMsPerUnit <= 0) {
      return emptyOutput();
    }

    const windows = getWindowBounds({
      phraseStartMs: phraseSpan.startMs,
      tempoMsPerUnit,
      expectedRhythm: input.expectedRhythm,
    });

    const noteEvents: SungNoteEvent[] = [];
    const minFrameClarity =
      input.minFrameClarity ?? DEFAULT_MIN_FRAME_CLARITY;

    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];

      const usableFrames = getUsablePitchFrames({
        frames: input.frames,
        window,
        minFrameClarity,
      });

      const noteEvent = buildNoteEvent({
        frames: usableFrames,
        window,
        index,
      });

      if (noteEvent) {
        noteEvents.push(noteEvent);
      }
    }

    return { noteEvents };
  },
};