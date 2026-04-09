import type { AssessmentScoreSummary, MelodyAssessmentResult, PitchAssessmentNote } from '@/SightLine/domain/assessment';
import type { MicAssessmentRunResult, SegmentedPerformedNote } from '@/SightLine/core/audio/types';

export type WeightedAssessmentNoteState =
  | 'correct'
  | 'near'
  | 'transposed_consistent'
  | 'low_confidence'
  | 'ambiguous'
  | 'incorrect';

export interface WeightedAssessmentScoreWeights {
  correct: number;
  near: number;
  transposed_consistent: number;
  low_confidence: number;
  ambiguous: number;
  incorrect: number;
}

export const DEFAULT_WEIGHTED_ASSESSMENT_SCORE_WEIGHTS: WeightedAssessmentScoreWeights = {
  correct: 1,
  near: 0.95,
  transposed_consistent: 0.95,
  low_confidence: 0.95,
  ambiguous: 0.85,
  incorrect: 0,
};

export interface WeightedAssessmentSummary {
  baseTotalScore: number;
  totalScore: number;
  totalPossible: number;
  basePercentage: number;
  percentage: number;
  counts: {
    correct: number;
    near: number;
    transposed_consistent: number;
    low_confidence: number;
    ambiguous: number;
    incorrect: number;
  };
  generosityAdjustments: {
    nearMatchPhraseBoost: number;
    sessionBiasBoost: number;
    adjustedByGenerosity: boolean;
  };
}

export interface BuildAssessmentScoreSummaryInput {
  assessment: MelodyAssessmentResult;
  segmentedNotes: SegmentedPerformedNote[];
  weights?: WeightedAssessmentScoreWeights;
}

export function classifyWeightedAssessmentNoteState(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined
): WeightedAssessmentNoteState {
  if (note?.displayState === 'correct') {
    return 'correct';
  }
  if (note?.displayState === 'near') {
    return 'near';
  }
  if (note?.displayState === 'transposed_consistent') {
    return 'transposed_consistent';
  }
  if (note?.displayState === 'low_confidence') {
    return 'low_confidence';
  }
  if (note?.displayState === 'ambiguous') {
    return 'ambiguous';
  }
  if (note?.isCorrect) {
    return 'correct';
  }
  if (segmented?.status === 'weak') {
    return 'low_confidence';
  }
  if (segmented?.status === 'ambiguous' || segmented?.targetConsistentAmbiguity) {
    return 'ambiguous';
  }
  return 'incorrect';
}

export function getWeightedAssessmentNoteScore(
  note: PitchAssessmentNote | undefined,
  segmented: SegmentedPerformedNote | undefined,
  weights: WeightedAssessmentScoreWeights = DEFAULT_WEIGHTED_ASSESSMENT_SCORE_WEIGHTS
): number {
  const state = classifyWeightedAssessmentNoteState(note, segmented);
  switch (state) {
    case 'correct':
      return weights.correct;
    case 'near':
      return weights.near;
    case 'transposed_consistent':
      return weights.transposed_consistent;
    case 'low_confidence':
      return weights.low_confidence;
    case 'ambiguous':
      return weights.ambiguous;
    default:
      return weights.incorrect;
  }
}

export function buildWeightedAssessmentSummary(
  result: MicAssessmentRunResult,
  weights: WeightedAssessmentScoreWeights = DEFAULT_WEIGHTED_ASSESSMENT_SCORE_WEIGHTS
): WeightedAssessmentSummary {
  return buildWeightedAssessmentSummaryFromAssessment({
    assessment: result.assessment,
    segmentedNotes: result.segmentedNotes,
    weights,
  });
}

export function buildWeightedAssessmentSummaryFromAssessment(
  input: BuildAssessmentScoreSummaryInput
): WeightedAssessmentSummary {
  const counts = {
    correct: 0,
    near: 0,
    transposed_consistent: 0,
    low_confidence: 0,
    ambiguous: 0,
    incorrect: 0,
  };

  const baseTotalScore = input.assessment.notes.reduce((sum, note, index) => {
    const segmented = input.segmentedNotes[index];
    const state = classifyWeightedAssessmentNoteState(note, segmented);
    counts[state] += 1;
    return sum + getWeightedAssessmentNoteScore(note, segmented, input.weights);
  }, 0);

  const totalPossible = input.assessment.summary.targetNoteCount;
  const basePercentage =
    totalPossible > 0
      ? Math.round((baseTotalScore / totalPossible) * 100)
      : 0;

  const contourComparableCount =
    input.assessment.summary.contourCorrectCount + input.assessment.summary.contourIncorrectCount;
  const contourAccuracy =
    contourComparableCount > 0
      ? input.assessment.summary.contourCorrectCount / contourComparableCount
      : 0;
  const nearRatio = totalPossible > 0 ? counts.near / totalPossible : 0;
  const ambiguousRatio = totalPossible > 0 ? counts.ambiguous / totalPossible : 0;
  const incorrectRatio = totalPossible > 0 ? counts.incorrect / totalPossible : 0;
  const largeErrorRatio =
    totalPossible > 0
      ? input.assessment.notes.filter((note) => (note.absDelta ?? 0) >= 2).length / totalPossible
      : 0;
  const phraseStable =
    contourAccuracy >= 0.6 &&
    ambiguousRatio <= 0.22 &&
    incorrectRatio <= 0.35 &&
    largeErrorRatio <= 0.28;
  const nearMatchPhraseBoost =
    phraseStable && nearRatio >= 0.3
      ? Math.min(0.3, counts.near * 0.02)
      : 0;
  const mildSessionBias =
    input.assessment.globalOffsetCorrection.sessionPitchBias.treatedAsBias &&
    Math.abs(input.assessment.globalOffsetCorrection.sessionPitchBias.offset ?? 0) === 1 &&
    input.assessment.globalOffsetCorrection.phraseAlreadyMostlyAcceptable;
  const sessionBiasBoost =
    mildSessionBias && counts.near >= 2
      ? Math.min(
          0.18,
          counts.near *
            0.01 *
            Math.max(0.5, input.assessment.globalOffsetCorrection.sessionPitchBias.confidence)
        )
      : 0;
  const totalScore = Math.min(
    totalPossible,
    baseTotalScore + nearMatchPhraseBoost + sessionBiasBoost
  );
  const percentage =
    totalPossible > 0
      ? Math.round((totalScore / totalPossible) * 100)
      : 0;

  return {
    baseTotalScore,
    totalScore,
    totalPossible,
    basePercentage,
    percentage,
    counts,
    generosityAdjustments: {
      nearMatchPhraseBoost: Number(nearMatchPhraseBoost.toFixed(2)),
      sessionBiasBoost: Number(sessionBiasBoost.toFixed(2)),
      adjustedByGenerosity: nearMatchPhraseBoost > 0 || sessionBiasBoost > 0,
    },
  };
}

export function buildAssessmentScoreSummary(
  input: BuildAssessmentScoreSummaryInput
): AssessmentScoreSummary {
  const weightedPitch = buildWeightedAssessmentSummaryFromAssessment(input);
  const pitchScore = weightedPitch.percentage;
  const rhythmScore = Math.round(input.assessment.rhythm.accuracy.score * 100);
  const melodicScore = Math.round((pitchScore + rhythmScore) / 2);

  return {
    pitchScore,
    rhythmScore,
    melodicScore,
  };
}
