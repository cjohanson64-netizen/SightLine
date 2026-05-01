import {
  buildExpectedAssessment,
  type ExpectedAssessment,
} from "../intake/buildExpectedAssessment";
import {
  type AssessmentInput,
  validateAssessmentInput,
} from "../intake/assessmentInput";

import { buildExpectedIntervals } from "../intervals/buildExpectedIntervals";
import { buildSungIntervals } from "../intervals/buildSungIntervals";
import { compareIntervals } from "../intervals/compareIntervals";
import type { IntervalResult, SungInterval } from "../intervals/intervalTypes";

import { alignNoteCount } from "../pitches/alignNoteCount";
import { cleanPitchFrames } from "../pitches/cleanPitchFrames";
import { compareNoteCount } from "../pitches/compareNoteCount";
import { extractPitchFrames } from "../pitches/extractPitchFrames";
import { segmentSungNotes } from "../pitches/segmentSungNotes";
import type {
  CleanPitchFrame,
  NoteAlignmentResult,
  NoteCountResult,
  RawPitchFrame,
  SungNote,
} from "../pitches/pitchTypes";

import { buildExpectedRhythm } from "../rhythm/buildExpectedRhythm";
import { buildSungRhythm } from "../rhythm/buildSungRhythm";
import { compareRhythm } from "../rhythm/compareRhythm";
import type { RhythmResult, SungRhythmUnit } from "../rhythm/rhythmTypes";

import { buildAssessmentScore } from "../scoring/buildAssessmentScore";
import type {
  AssessmentNoteResult,
  AssessmentScore,
} from "../scoring/scoreTypes";

import { analyzeNoteStability } from "../stability/analyzeNoteStability";
import type { StabilityResult } from "../stability/stabilityTypes";

export type AssessmentDebugData = {
  rawPitchFrames: RawPitchFrame[];
  cleanPitchFrames: CleanPitchFrame[];
  sungNotes: SungNote[];
  alignedNotes: NoteAlignmentResult;
  sungIntervals: SungInterval[];
  sungRhythm: SungRhythmUnit[];
};

export type AssessmentResult = {
  exerciseId: string;
  attemptId?: string;
  recordedAt?: string;

  expected: ExpectedAssessment;

  sung: {
    notes: SungNote[];
    noteCount: NoteCountResult;
    alignment: NoteAlignmentResult;
  };

  intervals: {
    results: IntervalResult[];
  };

  stability: {
    results: StabilityResult[];
  };

  rhythm: {
    results: RhythmResult[];
  };

  score: AssessmentScore;

  ui: {
    noteResults: AssessmentNoteResult[];
  };

  debug?: AssessmentDebugData;
};

/**
 * Runs the full SightLine assessment pipeline.
 *
 * This file owns orchestration only.
 *
 * It calls the assessment folders in the canonical order:
 * 1. intake
 * 2. pitches
 * 3. intervals
 * 4. stability
 * 5. rhythm
 * 6. scoring
 *
 * It should not contain clever domain logic.
 */
export function runAssessment(input: AssessmentInput): AssessmentResult {
  validateAssessmentInput(input);

  const expected = buildExpectedAssessment({
    melody: input.melody,
  });

  const rawPitchFrames = extractPitchFrames({
    audio: input.audio,
  });

  const cleanFrames = cleanPitchFrames({
    frames: rawPitchFrames,
  });

  const sungNotes = segmentSungNotes({
    frames: cleanFrames,
  });

  const noteCount = compareNoteCount({
    expectedNotes: expected.notes,
    sungNotes,
  });

  const alignment = alignNoteCount({
    expectedNotes: expected.notes,
    sungNotes,
  });

  const expectedIntervals = buildExpectedIntervals(expected.notes);

  const sungIntervals = buildSungIntervals({
    alignedNotes: alignment.alignedNotes,
  });

  const intervalResults = compareIntervals({
    expectedIntervals,
    sungIntervals,
  });

  const stabilityResults = analyzeNoteStability({
    sungNotes,
    cleanFrames,
  });

  const expectedRhythm = buildExpectedRhythm(expected.notes);

  const sungRhythm = buildSungRhythm({
    expectedRhythm,
    alignedNotes: alignment.alignedNotes,
  });

  const rhythmResults = compareRhythm({
    expectedRhythm,
    sungRhythm,
  });

  const scoring = buildAssessmentScore({
    expectedNoteCount: expected.notes.length,
    noteCount,
    intervalResults,
    rhythmResults,
    stabilityResults,
  });

  return {
    exerciseId: input.exerciseId,
    attemptId: input.attemptId,
    recordedAt: input.recordedAt,

    expected,

    sung: {
      notes: sungNotes,
      noteCount,
      alignment,
    },

    intervals: {
      results: intervalResults,
    },

    stability: {
      results: stabilityResults,
    },

    rhythm: {
      results: rhythmResults,
    },

    score: scoring.score,

    ui: {
      noteResults: scoring.noteResults,
    },

    debug: input.includeDebugData
      ? {
          rawPitchFrames,
          cleanPitchFrames: cleanFrames,
          sungNotes,
          alignedNotes: alignment,
          sungIntervals,
          sungRhythm,
        }
      : undefined,
  };
}