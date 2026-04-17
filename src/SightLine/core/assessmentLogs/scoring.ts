import type { AssessmentScoreSummary, MelodyAssessmentResult, PitchAssessmentNote } from '@/SightLine/domain/assessment';
import type { MicAssessmentRunResult, SegmentedPerformedNote } from '@/SightLine/core/audio/types';

function roundFit(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type WeightedAssessmentNoteState =
  | 'correct'
  | 'same_note_off_center'
  | 'adjacent_semitone'
  | 'transposed_consistent'
  | 'low_confidence'
  | 'ambiguous'
  | 'incorrect';

export interface WeightedAssessmentScoreWeights {
  correct: number;
  same_note_off_center: number;
  adjacent_semitone: number;
  transposed_consistent: number;
  low_confidence: number;
  ambiguous: number;
  incorrect: number;
}

export const DEFAULT_WEIGHTED_ASSESSMENT_SCORE_WEIGHTS: WeightedAssessmentScoreWeights = {
  correct: 1,
  same_note_off_center: 0.98,
  adjacent_semitone: 0.55,
  transposed_consistent: 0.93,
  low_confidence: 0.7,
  ambiguous: 0.62,
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
    same_note_off_center: number;
    adjacent_semitone: number;
    transposed_consistent: number;
    low_confidence: number;
    ambiguous: number;
    incorrect: number;
  };
  generosityAdjustments: {
    intervalRecoveryCredit: number;
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
  if (note?.displayState === 'same_note_off_center') {
    return 'same_note_off_center';
  }
  if (note?.displayState === 'adjacent_semitone') {
    return 'adjacent_semitone';
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
  if (note?.matchKind === 'adjacent_semitone') {
    return 'adjacent_semitone';
  }
  if (segmented?.status === 'weak') {
    return 'low_confidence';
  }
  if (segmented?.status === 'ambiguous' || segmented?.targetConsistentAmbiguity) {
    return 'ambiguous';
  }
  // If the pitch signal was unstable (spread pitch cluster or weak dominant bucket) and the
  // miss is small, treat the note as ambiguous rather than fully incorrect. This prevents
  // breathy or unfocused tone — which produces diffuse pitch estimates — from being penalized
  // the same as a genuine pitch error on a clean signal.
  const signalIsUnstable =
    (segmented?.pitchSpread ?? 0) > 1.5 ||
    (segmented?.stablePitchSpread ?? 0) > 1.2 ||
    (typeof segmented?.dominantBucketStrength === 'number' &&
      segmented.dominantBucketStrength < 0.60);
  if (
    note?.matchKind === 'incorrect' &&
    signalIsUnstable &&
    (note.absDelta ?? 99) <= 2
  ) {
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
  const intervalRecoveryCredit = note?.intervalRecoveryApplied
    ? note.intervalRecoveryCredit
    : 0;

  switch (state) {
    case 'correct':
      return Math.max(weights.correct, intervalRecoveryCredit);
    case 'same_note_off_center':
      return Math.max(weights.same_note_off_center, intervalRecoveryCredit);
    case 'adjacent_semitone':
      return Math.max(weights.adjacent_semitone, intervalRecoveryCredit);
    case 'transposed_consistent':
      return Math.max(weights.transposed_consistent, intervalRecoveryCredit);
    case 'low_confidence':
      return Math.max(weights.low_confidence, intervalRecoveryCredit);
    case 'ambiguous':
      return Math.max(weights.ambiguous, intervalRecoveryCredit);
    default:
      return Math.max(weights.incorrect, intervalRecoveryCredit);
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
    same_note_off_center: 0,
    adjacent_semitone: 0,
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
  const intervalRecoveryCredit = roundFit(
    input.assessment.notes.reduce(
      (sum, note) => sum + (note.intervalRecoveryApplied ? note.intervalRecoveryCredit : 0),
      0,
    ),
  );

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
  const sameNoteOffCenterRatio =
    totalPossible > 0 ? counts.same_note_off_center / totalPossible : 0;
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
    phraseStable && sameNoteOffCenterRatio >= 0.3
      ? Math.min(0.18, counts.same_note_off_center * 0.01)
      : 0;
  const mildSessionBias =
    input.assessment.globalOffsetCorrection.sessionPitchBias.treatedAsBias &&
    Math.abs(input.assessment.globalOffsetCorrection.sessionPitchBias.offset ?? 0) === 1 &&
    input.assessment.globalOffsetCorrection.phraseAlreadyMostlyAcceptable;
  const sessionBiasBoost =
    mildSessionBias && counts.same_note_off_center >= 2
      ? Math.min(
          0.08,
          counts.same_note_off_center *
            0.005 *
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
      intervalRecoveryCredit,
      nearMatchPhraseBoost: Number(nearMatchPhraseBoost.toFixed(2)),
      sessionBiasBoost: Number(sessionBiasBoost.toFixed(2)),
      adjustedByGenerosity:
        intervalRecoveryCredit > 0 || nearMatchPhraseBoost > 0 || sessionBiasBoost > 0,
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
