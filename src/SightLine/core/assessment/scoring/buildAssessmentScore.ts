import type { IntervalResult } from "../intervals/intervalTypes";
import type { RhythmResult, RhythmStatus } from "../rhythm/rhythmTypes";
import type { StabilityResult, StabilityStatus } from "../stability/stabilityTypes";
import type {
  AssessmentNoteColor,
  AssessmentNoteResult,
  AssessmentPitchStatus,
  AssessmentRhythmStatus,
  AssessmentScoreInput,
  AssessmentScoreResult,
  MasteryLevel,
} from "./scoreTypes";

const PITCH_CREDITS: Record<AssessmentPitchStatus, number> = {
  correct: 1,
  close: 0.75,
  partial: 0.5,
  incorrect: 0,
  missing: 0,
  unassessable: 0,
};

const RHYTHM_CREDITS: Record<AssessmentRhythmStatus, number> = {
  match: 1,
  close: 0.75,
  mismatch: 0,
  missing: 0,
};

const STABILITY_CREDITS: Record<StabilityStatus, number> = {
  stable: 1,
  mostlyStable: 0.85,
  unstable: 0.5,
  unassessable: 0,
};

/**
 * Builds the final student-facing assessment score.
 *
 * This file owns only final score math and UI-ready note result assembly.
 *
 * It does not extract pitch.
 * It does not compare intervals.
 * It does not compare rhythm.
 * It does not analyze stability.
 */
export function buildAssessmentScore(
  input: AssessmentScoreInput,
): AssessmentScoreResult {
  const noteResults = buildAssessmentNoteResults(input);

  const pitchAccuracy = calculatePitchAccuracy(noteResults);
  const rhythmAccuracy = calculateRhythmAccuracy(noteResults);
  const stabilityAccuracy = calculateStabilityAccuracy(noteResults);
  const noteCountAccuracy = calculateNoteCountAccuracy(input);

  const melodyScore = calculateMelodyScore({
    pitchAccuracy,
    rhythmAccuracy,
  });

  const mastery = calculateMastery(melodyScore);

  return {
    score: {
      mastery,
      pitchAccuracy,
      rhythmAccuracy,
      melodyScore,
      noteCountAccuracy,
      stabilityAccuracy,
    },
    noteResults,
  };
}

function buildAssessmentNoteResults(
  input: AssessmentScoreInput,
): AssessmentNoteResult[] {
  const results: AssessmentNoteResult[] = [];

  for (let noteIndex = 0; noteIndex < input.expectedNoteCount; noteIndex += 1) {
    const intervalResult = findIntervalArrivingAtNote(
      input.intervalResults,
      noteIndex,
    );

    const rhythmResult = findRhythmForNote(input.rhythmResults, noteIndex);
    const stabilityResult = findStabilityForNote(
      input.stabilityResults,
      noteIndex,
    );

    const pitchStatus = getPitchStatusForNote({
      noteIndex,
      intervalResult,
    });

    const rhythmStatus = rhythmResult?.status ?? "missing";
    const stabilityStatus = stabilityResult?.status ?? "unassessable";

    const color = getNoteColor({
      pitchStatus,
      rhythmStatus,
      stabilityStatus,
    });

    results.push({
      noteIndex,
      pitchStatus,
      rhythmStatus,
      stabilityStatus,
      color,

      interval: intervalResult
        ? {
            expectedSemitones: intervalResult.expectedSemitones,
            sungSemitones: intervalResult.sungSemitones,
            normalizedSungSemitones: intervalResult.normalizedSungSemitones,
            intervalDifference: intervalResult.intervalDifference,
            status: intervalResult.status,
          }
        : undefined,

      rhythm: rhythmResult
        ? {
            expectedBeats: rhythmResult.expectedBeats,
            sungBeats: rhythmResult.sungBeats,
            proportionalError: rhythmResult.proportionalError,
            status: rhythmResult.status,
          }
        : undefined,

      stability: stabilityResult
        ? {
            pitchSpreadCents: stabilityResult.pitchSpreadCents,
            averageClarity: stabilityResult.averageClarity,
            reliabilityWeight: stabilityResult.reliabilityWeight,
          }
        : undefined,
    });
  }

  return results;
}

/**
 * Interval results live between notes:
 *
 * note 0 → note 1 = interval result for note 1
 * note 1 → note 2 = interval result for note 2
 *
 * So note 0 is the anchor note. It is treated as present/correct when the
 * structural note alignment produced an expected slot for it.
 */
function getPitchStatusForNote(input: {
  noteIndex: number;
  intervalResult?: IntervalResult;
}): AssessmentPitchStatus {
  if (input.noteIndex === 0) {
    return "correct";
  }

  if (!input.intervalResult) {
    return "missing";
  }

  if (input.intervalResult.status === "missing") {
    return "missing";
  }

  return input.intervalResult.status;
}

function getNoteColor(input: {
  pitchStatus: AssessmentPitchStatus;
  rhythmStatus: AssessmentRhythmStatus;
  stabilityStatus: StabilityStatus;
}): AssessmentNoteColor {
  if (
    input.pitchStatus === "missing" ||
    input.pitchStatus === "unassessable" ||
    input.stabilityStatus === "unassessable"
  ) {
    return "gray";
  }

  if (input.pitchStatus === "incorrect") {
    return "red";
  }

  if (input.pitchStatus === "partial" || input.rhythmStatus === "mismatch") {
    return "orange";
  }

  if (
    input.pitchStatus === "close" ||
    input.rhythmStatus === "close" ||
    input.stabilityStatus === "mostlyStable" ||
    input.stabilityStatus === "unstable"
  ) {
    return "yellow";
  }

  return "green";
}

function calculatePitchAccuracy(noteResults: AssessmentNoteResult[]): number {
  if (noteResults.length === 0) {
    return 0;
  }

  const totalCredit = noteResults.reduce((sum, result) => {
    return sum + PITCH_CREDITS[result.pitchStatus];
  }, 0);

  return toPercent(totalCredit / noteResults.length);
}

function calculateRhythmAccuracy(noteResults: AssessmentNoteResult[]): number {
  if (noteResults.length === 0) {
    return 0;
  }

  const totalCredit = noteResults.reduce((sum, result) => {
    return sum + RHYTHM_CREDITS[result.rhythmStatus];
  }, 0);

  return toPercent(totalCredit / noteResults.length);
}

function calculateStabilityAccuracy(noteResults: AssessmentNoteResult[]): number {
  if (noteResults.length === 0) {
    return 0;
  }

  const totalCredit = noteResults.reduce((sum, result) => {
    return sum + STABILITY_CREDITS[result.stabilityStatus];
  }, 0);

  return toPercent(totalCredit / noteResults.length);
}

function calculateNoteCountAccuracy(input: AssessmentScoreInput): number {
  if (input.noteCount.expectedCount === 0) {
    return 0;
  }

  const missedOrExtraNotes = Math.abs(input.noteCount.difference);
  const correctSlots = Math.max(0, input.noteCount.expectedCount - missedOrExtraNotes);

  return toPercent(correctSlots / input.noteCount.expectedCount);
}

function calculateMelodyScore(input: {
  pitchAccuracy: number;
  rhythmAccuracy: number;
}): number {
  return roundScore((2 / 3) * input.pitchAccuracy + (1 / 3) * input.rhythmAccuracy);
}

function calculateMastery(melodyScore: number): MasteryLevel {
  if (melodyScore < 25) {
    return 0;
  }

  if (melodyScore < 50) {
    return 1;
  }

  if (melodyScore < 75) {
    return 2;
  }

  if (melodyScore < 85) {
    return 3;
  }

  return 4;
}

function findIntervalArrivingAtNote(
  intervalResults: IntervalResult[],
  noteIndex: number,
): IntervalResult | undefined {
  return intervalResults.find((result) => result.toNoteIndex === noteIndex);
}

function findRhythmForNote(
  rhythmResults: RhythmResult[],
  noteIndex: number,
): RhythmResult | undefined {
  return rhythmResults.find((result) => result.noteIndex === noteIndex);
}

function findStabilityForNote(
  stabilityResults: StabilityResult[],
  noteIndex: number,
): StabilityResult | undefined {
  return stabilityResults.find((result) => result.noteIndex === noteIndex);
}

function toPercent(value: number): number {
  return roundScore(value * 100);
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
