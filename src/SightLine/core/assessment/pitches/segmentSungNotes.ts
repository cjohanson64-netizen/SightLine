import type {
  CleanPitchFrame,
  NoteSegmentationOptions,
  SungNote,
} from "./pitchTypes";

const DEFAULT_MIN_NOTE_DURATION_MS = 40;
const DEFAULT_MAX_GAP_MS = 150;
const DEFAULT_MAX_PITCH_DEVIATION_HZ = 6;
const DEFAULT_MIN_SURVIVING_NOTE_DURATION_MS = 180;

type SegmentSungNotesInput = {
  frames: CleanPitchFrame[];
  options?: NoteSegmentationOptions;
};

/**
 * Converts clean pitch frames into sung note events.
 *
 * This file owns:
 * - grouping stable pitch frames into note candidates
 * - merging tiny fragments that belong to neighboring notes
 * - removing tiny surviving fragments
 * - calculating note pitch, MIDI value, duration, and confidence
 *
 * It does not compare notes to expected melody.
 * It does not decide correctness.
 */
export function segmentSungNotes(input: SegmentSungNotesInput): SungNote[] {
  const minNoteDurationMs =
    input.options?.minNoteDurationMs ?? DEFAULT_MIN_NOTE_DURATION_MS;
  const maxGapMs = input.options?.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const maxPitchDeviationHz =
    input.options?.maxPitchDeviationHz ?? DEFAULT_MAX_PITCH_DEVIATION_HZ;
  const minSurvivingNoteDurationMs =
    input.options?.minSurvivingNoteDurationMs ??
    DEFAULT_MIN_SURVIVING_NOTE_DURATION_MS;

  if (input.frames.length === 0) {
    return [];
  }

  const candidateRuns = groupStableRuns(input.frames, maxPitchDeviationHz);
  const candidateNotes = candidateRuns
    .map((run) => buildSungNoteFromRun(run))
    .filter((note) => note.durationMs >= minNoteDurationMs);

  const mergedNotes = mergeAdjacentFragments(candidateNotes, {
    maxGapMs,
    maxPitchDeviationHz,
  });

  const survivingNotes = mergedNotes.filter(
    (note) => note.durationMs >= minSurvivingNoteDurationMs,
  );

  return reindexSungNotes(survivingNotes);
}

function groupStableRuns(
  frames: CleanPitchFrame[],
  maxPitchDeviationHz: number,
): CleanPitchFrame[][] {
  const runs: CleanPitchFrame[][] = [];

  for (const frame of frames) {
    const currentRun = runs[runs.length - 1];

    if (!currentRun) {
      runs.push([frame]);
      continue;
    }

    const previousFrame = currentRun[currentRun.length - 1];
    const isConsecutive = previousFrame.frameIndex + 1 === frame.frameIndex;
    const runAveragePitchHz = average(
      currentRun.map((currentFrame) => currentFrame.stablePitchHz),
    );
    const isPitchClose =
      Math.abs(frame.stablePitchHz - runAveragePitchHz) <= maxPitchDeviationHz;

    if (isConsecutive && isPitchClose) {
      currentRun.push(frame);
    } else {
      runs.push([frame]);
    }
  }

  return runs;
}

function buildSungNoteFromRun(run: CleanPitchFrame[]): SungNote {
  const firstFrame = run[0];
  const lastFrame = run[run.length - 1];

  const pitchHz = average(run.map((frame) => frame.stablePitchHz));
  const confidence = average(run.map((frame) => frame.clarity));
  const midiFloat = frequencyToMidi(pitchHz);

  const startMs = firstFrame.timeMs;
  const endMs = estimateRunEndMs(run);
  const durationMs = Math.max(0, endMs - startMs);

  return {
    index: 0,
    id: "sung-pending",
    startMs,
    endMs,
    durationMs,
    pitchHz,
    midiFloat,
    confidence,
  };
}

function estimateRunEndMs(run: CleanPitchFrame[]): number {
  const firstFrame = run[0];
  const lastFrame = run[run.length - 1];

  if (run.length >= 2) {
    const previousFrame = run[run.length - 2];
    const estimatedFrameStepMs = lastFrame.timeMs - previousFrame.timeMs;
    return lastFrame.timeMs + Math.max(0, estimatedFrameStepMs);
  }

  return firstFrame.timeMs;
}

function mergeAdjacentFragments(
  notes: SungNote[],
  options: {
    maxGapMs: number;
    maxPitchDeviationHz: number;
  },
): SungNote[] {
  const mergedNotes: SungNote[] = [];

  for (const note of notes) {
    const previousNote = mergedNotes[mergedNotes.length - 1];

    if (!previousNote) {
      mergedNotes.push(note);
      continue;
    }

    const gapMs = note.startMs - previousNote.endMs;
    const pitchDistanceHz = Math.abs(note.pitchHz - previousNote.pitchHz);
    const oneNoteIsShort = note.durationMs < 80 || previousNote.durationMs < 80;

    const shouldMerge =
      gapMs <= options.maxGapMs &&
      oneNoteIsShort &&
      pitchDistanceHz <= options.maxPitchDeviationHz;

    if (shouldMerge) {
      mergedNotes[mergedNotes.length - 1] = mergeTwoNotes(previousNote, note);
    } else {
      mergedNotes.push(note);
    }
  }

  return mergedNotes;
}

function mergeTwoNotes(firstNote: SungNote, secondNote: SungNote): SungNote {
  const totalDurationMs = firstNote.durationMs + secondNote.durationMs;

  const weightedPitchHz =
    (firstNote.pitchHz * firstNote.durationMs +
      secondNote.pitchHz * secondNote.durationMs) /
    totalDurationMs;

  const weightedConfidence =
    (firstNote.confidence * firstNote.durationMs +
      secondNote.confidence * secondNote.durationMs) /
    totalDurationMs;

  return {
    index: firstNote.index,
    id: firstNote.id,
    startMs: firstNote.startMs,
    endMs: secondNote.endMs,
    durationMs: secondNote.endMs - firstNote.startMs,
    pitchHz: weightedPitchHz,
    midiFloat: frequencyToMidi(weightedPitchHz),
    confidence: weightedConfidence,
  };
}

function reindexSungNotes(notes: SungNote[]): SungNote[] {
  return notes.map((note, index) => ({
    ...note,
    index,
    id: `sung-${index + 1}`,
  }));
}

function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}