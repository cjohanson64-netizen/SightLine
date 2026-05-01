import type { IntervalResult, IntervalStatus } from "../intervals/intervalTypes";
import type { NoteCountResult } from "../pitches/pitchTypes";
import type { RhythmResult, RhythmStatus } from "../rhythm/rhythmTypes";
import type { StabilityResult, StabilityStatus } from "../stability/stabilityTypes";

export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

export type AssessmentScore = {
  mastery: MasteryLevel;
  pitchAccuracy: number;
  rhythmAccuracy: number;
  melodyScore: number;
  noteCountAccuracy: number;
  stabilityAccuracy: number;
};

export type AssessmentNoteColor = "green" | "yellow" | "orange" | "red" | "gray";

export type AssessmentPitchStatus =
  | "correct"
  | "close"
  | "partial"
  | "incorrect"
  | "missing"
  | "unassessable";

export type AssessmentRhythmStatus =
  | "match"
  | "close"
  | "mismatch"
  | "missing";

export type AssessmentNoteResult = {
  noteIndex: number;

  /**
   * This is note-level pitch status for UI rendering.
   *
   * Since interval assessment lives between notes, note 0 is treated as an
   * anchor. Notes 1+ receive the interval result that arrives at that note.
   */
  pitchStatus: AssessmentPitchStatus;

  rhythmStatus: AssessmentRhythmStatus;
  stabilityStatus: StabilityStatus;

  color: AssessmentNoteColor;

  interval?: {
    expectedSemitones: number;
    sungSemitones: number | null;
    normalizedSungSemitones: number | null;
    intervalDifference: number | null;
    status: IntervalStatus;
  };

  rhythm?: {
    expectedBeats: number;
    sungBeats: number | null;
    proportionalError: number | null;
    status: RhythmStatus;
  };

  stability?: {
    pitchSpreadCents: number | null;
    averageClarity: number | null;
    reliabilityWeight: number;
  };
};

export type AssessmentScoreInput = {
  expectedNoteCount: number;
  noteCount: NoteCountResult;
  intervalResults: IntervalResult[];
  rhythmResults: RhythmResult[];
  stabilityResults: StabilityResult[];
};

export type AssessmentScoreResult = {
  score: AssessmentScore;
  noteResults: AssessmentNoteResult[];
};