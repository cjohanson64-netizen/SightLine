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
const MIN_SURVIVING_NOTE_DURATION_MS = 180;

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

function buildPreliminaryNotes(runs: CleanPitchFrame[][]): SungNoteEvent[] {
  const noteEvents: SungNoteEvent[] = [];

  for (let index = 0; index < runs.length; index += 1) {
    const noteEvent = buildNoteEvent(runs[index], index);

    if (noteEvent) {
      noteEvents.push(noteEvent);
    }
  }

  return noteEvents;
}

function areMergeable(a: SungNoteEvent, b: SungNoteEvent): boolean {
  const pitchDiffHz = Math.abs(a.pitchHz - b.pitchHz);
  const gapMs = b.startMs - a.endMs;
  const midiFloatDiff = Math.abs(a.midiFloat - b.midiFloat);
  const oneNoteIsShort =
    a.durationMs < POST_MERGE_MIN_NOTE_DURATION_MS ||
    b.durationMs < POST_MERGE_MIN_NOTE_DURATION_MS;

  return (
    gapMs >= 0 &&
    gapMs <= MAX_MERGE_GAP_MS &&
    oneNoteIsShort &&
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

function shouldKeepPostMergeNote(note: SungNoteEvent): boolean {
  return note.durationMs >= MIN_SURVIVING_NOTE_DURATION_MS;
}

function filterShortPostMergeNotes(
  noteEvents: SungNoteEvent[],
): SungNoteEvent[] {
  return noteEvents.filter(shouldKeepPostMergeNote);
}

function isTransientOutlierNote(
  previous: SungNoteEvent,
  current: SungNoteEvent,
  next: SungNoteEvent,
): boolean {
  const currentIsShort = current.durationMs <= 160;

  const prevToCurrentSemitones = Math.abs(
    previous.midiFloat - current.midiFloat,
  );
  const currentToNextSemitones = Math.abs(current.midiFloat - next.midiFloat);
  const prevToNextSemitones = Math.abs(previous.midiFloat - next.midiFloat);

  const currentIsFarFromBoth =
    prevToCurrentSemitones >= 7 && currentToNextSemitones >= 7;

  const neighborsAreCloserToEachOther = prevToNextSemitones <= 5;

  return (
    currentIsShort && currentIsFarFromBoth && neighborsAreCloserToEachOther
  );
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

    if (!isTransientOutlierNote(previous, current, next)) {
      filtered.push(current);
    }
  }

  filtered.push(noteEvents[noteEvents.length - 1]);
  return filtered;
}

function filterShortNonScaleArtifacts(
  noteEvents: SungNoteEvent[],
  tonicPitchClass: number,
): SungNoteEvent[] {
  return noteEvents.filter((note) => {
    const relativePitchClass =
      ((Math.round(note.midiFloat) % 12) - tonicPitchClass + 12) % 12;

    const majorScalePitchClasses = [0, 2, 4, 5, 7, 9, 11];

    const isScaleTone = majorScalePitchClasses.includes(relativePitchClass);

    const isVeryShort = note.durationMs <= 220;

    // Suppress likely transition artifacts.
    if (!isScaleTone && isVeryShort) {
      return false;
    }

    return true;
  });
}

function mergeTrailingSamePitchFragment(
  noteEvents: SungNoteEvent[],
): SungNoteEvent[] {
  if (noteEvents.length < 2) {
    return noteEvents;
  }

  const last = noteEvents[noteEvents.length - 1];
  const previous = noteEvents[noteEvents.length - 2];

  const pitchDistance = Math.abs(last.midiFloat - previous.midiFloat);
  const isShortFinalFragment = last.durationMs <= 300;
  const isSamePitch = pitchDistance <= 0.5;
  const previousIsMuchLonger = previous.durationMs >= last.durationMs * 2;

  if (!isShortFinalFragment || !isSamePitch || !previousIsMuchLonger) {
    return noteEvents;
  }

  const mergedFinalNote = mergeTwoNotes(previous, last);

  return [...noteEvents.slice(0, noteEvents.length - 2), mergedFinalNote];
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

    // Phase 1: Group stable pitch frames into note-like regions.
    const runs = groupNoteRuns(input.frames);

    // Phase 2: Convert valid runs into preliminary note events.
    const preliminaryNotes = buildPreliminaryNotes(runs);

    // Phase 3: Merge adjacent note events that represent the same pitch.
    const mergedNotes = mergeAdjacentSimilarNotes(preliminaryNotes);

    // Phase 4: Remove short fragments created or exposed after merging.
    const noShortFragments = filterShortPostMergeNotes(mergedNotes);

    // Phase 5: Remove brief transient pitch outliers.
    const noTransientOutliers = filterTransientOutlierNotes(noShortFragments);

    // Phase 6: Remove short non-scale artifact notes.
    const noNonScaleArtifacts = filterShortNonScaleArtifacts(
      noTransientOutliers,
      input.tonicPitchClass ?? 0,
    );

    // Phase 7: Merge phrase-final release fragments.
    const noTrailingFragment =
      mergeTrailingSamePitchFragment(noNonScaleArtifacts);

    // Phase 8: Normalize note ids after cleanup.
    const noteEvents = reindexNotes(noTrailingFragment);

    return { noteEvents };
  },
};
