import type {
  CleanPitchFrame,
  NoteSegmentationInput,
  NoteSegmentationOutput,
  SungNoteEvent,
} from "../types";
import type { NoteSegmentationService } from "../types/services";
import { frequencyToMidiFloat } from "./pitchMath";

const MAX_DEVIATION_FROM_RUN_CENTER_HZ = 6;
const MIN_NOTE_DURATION_MS = 40;
const POST_MERGE_MIN_NOTE_DURATION_MS = 80;
const MAX_MERGE_PITCH_DIFF_HZ = 6;
const MAX_MERGE_GAP_MS = 150;

function emptyNoteSegmentationOutput(): NoteSegmentationOutput {
  return { noteEvents: [] };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function getRunAveragePitch(run: CleanPitchFrame[]): number {
  return average(run.map((frame) => frame.stablePitchHz));
}

function groupNoteRuns(frames: CleanPitchFrame[]): CleanPitchFrame[][] {
  if (frames.length === 0) {
    return [];
  }

  const runs: CleanPitchFrame[][] = [];
  let currentRun: CleanPitchFrame[] = [frames[0]];

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];

    const isConsecutive = current.frameIndex === previous.frameIndex + 1;
    const currentRunAverage = getRunAveragePitch(currentRun);
    const deviationFromRunCenter = Math.abs(
      current.stablePitchHz - currentRunAverage,
    );

    const sameNoteRegion =
      isConsecutive &&
      deviationFromRunCenter <= MAX_DEVIATION_FROM_RUN_CENTER_HZ;

    if (sameNoteRegion) {
      currentRun.push(current);
    } else {
      runs.push(currentRun);
      currentRun = [current];
    }
  }

  runs.push(currentRun);
  return runs;
}

function buildNoteEvent(
  run: CleanPitchFrame[],
  index: number,
): SungNoteEvent | null {
  if (run.length === 0) {
    return null;
  }

  const startMs = run[0].timeMs;
  const endMs = run[run.length - 1].timeMs;
  const frameStepMs = run.length > 1 ? run[1].timeMs - run[0].timeMs : 0;
  const durationMs = endMs - startMs + frameStepMs;

  if (durationMs < MIN_NOTE_DURATION_MS) {
    return null;
  }

  const avgStablePitchHz = average(run.map((frame) => frame.stablePitchHz));
  const avgClarity = average(run.map((frame) => frame.clarity));
  const midiFloat = frequencyToMidiFloat(avgStablePitchHz);

  return {
    id: `a${index + 1}`,
    startMs,
    endMs,
    durationMs,
    pitchHz: avgStablePitchHz,
    midiFloat,
    confidence: avgClarity,
  };
}

function areMergeable(a: SungNoteEvent, b: SungNoteEvent): boolean {
  const pitchDiffHz = Math.abs(a.pitchHz - b.pitchHz);
  const gapMs = b.startMs - a.endMs;
  const midiFloatDiff = Math.abs(a.midiFloat - b.midiFloat);

  return (
    gapMs >= 0 &&
    gapMs <= MAX_MERGE_GAP_MS &&
    (midiFloatDiff <= 0.5 || pitchDiffHz <= MAX_MERGE_PITCH_DIFF_HZ)
  );
}

function mergeTwoNotes(a: SungNoteEvent, b: SungNoteEvent): SungNoteEvent {
  const frameGapMs = Math.max(0, b.startMs - a.endMs);
  const combinedSpanMs = b.endMs - a.startMs + frameGapMs;

  const weightedPitchHz =
    combinedSpanMs > 0
      ? (a.pitchHz * a.durationMs + b.pitchHz * b.durationMs) /
        (a.durationMs + b.durationMs)
      : average([a.pitchHz, b.pitchHz]);

  const weightedConfidence =
    combinedSpanMs > 0
      ? (a.confidence * a.durationMs + b.confidence * b.durationMs) /
        (a.durationMs + b.durationMs)
      : average([a.confidence, b.confidence]);

  const midiFloat = frequencyToMidiFloat(weightedPitchHz);

  return {
    id: a.id,
    startMs: a.startMs,
    endMs: b.endMs,
    durationMs: b.endMs - a.startMs,
    pitchHz: weightedPitchHz,
    midiFloat,
    confidence: weightedConfidence,
  };
}

function mergeAdjacentSimilarNotes(
  noteEvents: SungNoteEvent[],
): SungNoteEvent[] {
  if (noteEvents.length === 0) {
    return [];
  }

  const merged: SungNoteEvent[] = [noteEvents[0]];

  for (let index = 1; index < noteEvents.length; index += 1) {
    const current = noteEvents[index];
    const previous = merged[merged.length - 1];

    if (areMergeable(previous, current)) {
      merged[merged.length - 1] = mergeTwoNotes(previous, current);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function filterShortPostMergeNotes(
  noteEvents: SungNoteEvent[],
): SungNoteEvent[] {
  if (noteEvents.length === 0) {
    return [];
  }

  return noteEvents.filter((note, index, allNotes) => {
    if (note.durationMs >= POST_MERGE_MIN_NOTE_DURATION_MS) {
      return true;
    }

    const previous = index > 0 ? allNotes[index - 1] : null;
    const next = index < allNotes.length - 1 ? allNotes[index + 1] : null;

    const previousMuchLonger =
      previous !== null &&
      previous.durationMs >= POST_MERGE_MIN_NOTE_DURATION_MS * 2;
    const nextMuchLonger =
      next !== null && next.durationMs >= POST_MERGE_MIN_NOTE_DURATION_MS * 2;

    const isEdgeFragment = index === 0 || index === allNotes.length - 1;

    if (isEdgeFragment && (previousMuchLonger || nextMuchLonger)) {
      return false;
    }

    return false;
  });
}

function filterTransientOutlierNotes(
  noteEvents: SungNoteEvent[],
): SungNoteEvent[] {
  if (noteEvents.length < 3) {
    return noteEvents;
  }

  const filtered: SungNoteEvent[] = [noteEvents[0]];

  for (let index = 1; index < noteEvents.length - 1; index += 1) {
    const previous = noteEvents[index - 1];
    const current = noteEvents[index];
    const next = noteEvents[index + 1];

    const currentIsShort = current.durationMs <= 160;

    const prevToCurrentSemitones = Math.abs(
      previous.midiFloat - current.midiFloat,
    );
    const currentToNextSemitones = Math.abs(current.midiFloat - next.midiFloat);
    const prevToNextSemitones = Math.abs(previous.midiFloat - next.midiFloat);

    const currentIsFarFromBoth =
      prevToCurrentSemitones >= 7 && currentToNextSemitones >= 7;

    const neighborsAreCloserToEachOther = prevToNextSemitones <= 5;

    if (
      currentIsShort &&
      currentIsFarFromBoth &&
      neighborsAreCloserToEachOther
    ) {
      continue;
    }

    filtered.push(current);
  }

  filtered.push(noteEvents[noteEvents.length - 1]);
  return filtered;
}

function reindexNotes(noteEvents: SungNoteEvent[]): SungNoteEvent[] {
  return noteEvents.map((note, index) => ({
    ...note,
    id: `a${index + 1}`,
  }));
}

export const noteSegmentationService: NoteSegmentationService = {
  run(input: NoteSegmentationInput): NoteSegmentationOutput {
    if (!input.frames || input.frames.length === 0) {
      return emptyNoteSegmentationOutput();
    }

    const runs = groupNoteRuns(input.frames);

    const preliminaryNotes: SungNoteEvent[] = [];

    for (let index = 0; index < runs.length; index += 1) {
      const noteEvent = buildNoteEvent(runs[index], index);

      if (noteEvent) {
        preliminaryNotes.push(noteEvent);
      }
    }

    const mergedNotes = mergeAdjacentSimilarNotes(preliminaryNotes);
    const noShortFragments = filterShortPostMergeNotes(mergedNotes);
    const noTransientOutliers = filterTransientOutlierNotes(noShortFragments);
    const noteEvents = reindexNotes(noTransientOutliers);
    
    return { noteEvents };
  },
};
