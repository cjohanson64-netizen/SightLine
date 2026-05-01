import type { CleanPitchFrame, SungNote } from "../pitches/pitchTypes";
import type {
  StabilityAnalysisOptions,
  StabilityResult,
  StabilityStatus,
} from "./stabilityTypes";

const DEFAULT_STABLE_SPREAD_CENTS = 35;
const DEFAULT_MOSTLY_STABLE_SPREAD_CENTS = 70;
const DEFAULT_MIN_AVERAGE_CLARITY = 0.7;
const DEFAULT_MIN_FRAMES_PER_NOTE = 2;

type AnalyzeNoteStabilityInput = {
  sungNotes: SungNote[];
  cleanFrames: CleanPitchFrame[];
  options?: StabilityAnalysisOptions;
};

/**
 * Answers assessment question #3:
 * Were their notes reasonably stable?
 *
 * This file owns note reliability only:
 * - pitch wobble/spread inside each sung note
 * - average clarity inside each sung note
 * - whether the note is stable enough to trust
 *
 * It does not compare intervals.
 * It does not score rhythm.
 * It does not calculate mastery.
 * It does not assign UI colors directly.
 */
export function analyzeNoteStability(
  input: AnalyzeNoteStabilityInput,
): StabilityResult[] {
  const stableSpreadCents =
    input.options?.stableSpreadCents ?? DEFAULT_STABLE_SPREAD_CENTS;

  const mostlyStableSpreadCents =
    input.options?.mostlyStableSpreadCents ??
    DEFAULT_MOSTLY_STABLE_SPREAD_CENTS;

  const minAverageClarity =
    input.options?.minAverageClarity ?? DEFAULT_MIN_AVERAGE_CLARITY;

  const minFramesPerNote =
    input.options?.minFramesPerNote ?? DEFAULT_MIN_FRAMES_PER_NOTE;

  return input.sungNotes.map((note) => {
    const framesInsideNote = getFramesInsideNote(input.cleanFrames, note);

    if (framesInsideNote.length < minFramesPerNote) {
      return buildUnassessableResult(note.index);
    }

    const pitchSpreadCents = calculatePitchSpreadCents(framesInsideNote);
    const averageClarity = average(
      framesInsideNote.map((frame) => frame.clarity),
    );

    const status = getStabilityStatus({
      pitchSpreadCents,
      averageClarity,
      stableSpreadCents,
      mostlyStableSpreadCents,
      minAverageClarity,
    });

    return {
      noteIndex: note.index,
      status,
      pitchSpreadCents,
      averageClarity,
      reliabilityWeight: getReliabilityWeight(status),
    };
  });
}

function getFramesInsideNote(
  frames: CleanPitchFrame[],
  note: SungNote,
): CleanPitchFrame[] {
  return frames.filter(
    (frame) => frame.timeMs >= note.startMs && frame.timeMs <= note.endMs,
  );
}

function calculatePitchSpreadCents(frames: CleanPitchFrame[]): number {
  const pitches = frames
    .map((frame) => frame.stablePitchHz)
    .filter((pitchHz) => Number.isFinite(pitchHz) && pitchHz > 0);

  if (pitches.length === 0) {
    return 0;
  }

  const minPitchHz = Math.min(...pitches);
  const maxPitchHz = Math.max(...pitches);

  return frequencyRatioToCents(maxPitchHz / minPitchHz);
}

function frequencyRatioToCents(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }

  return 1200 * Math.log2(ratio);
}

function getStabilityStatus(input: {
  pitchSpreadCents: number;
  averageClarity: number;
  stableSpreadCents: number;
  mostlyStableSpreadCents: number;
  minAverageClarity: number;
}): StabilityStatus {
  if (input.averageClarity < input.minAverageClarity) {
    return "unassessable";
  }

  if (input.pitchSpreadCents <= input.stableSpreadCents) {
    return "stable";
  }

  if (input.pitchSpreadCents <= input.mostlyStableSpreadCents) {
    return "mostlyStable";
  }

  return "unstable";
}

function buildUnassessableResult(noteIndex: number): StabilityResult {
  return {
    noteIndex,
    status: "unassessable",
    pitchSpreadCents: null,
    averageClarity: null,
    reliabilityWeight: 0,
  };
}

function getReliabilityWeight(status: StabilityStatus): number {
  switch (status) {
    case "stable":
      return 1;

    case "mostlyStable":
      return 0.85;

    case "unstable":
      return 0.5;

    case "unassessable":
      return 0;

    default:
      return 0;
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}