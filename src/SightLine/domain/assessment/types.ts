import type { MelodyEvent } from '@/SightLine/domain/music';

export type ContourDirection = 'up' | 'down' | 'same';
export type AssessmentComparisonMode = 'literal' | 'octave_flexible' | 'transposition_aware';
export type PitchMatchKind =
  | 'exact'
  | 'adjacent_semitone'
  | 'ambiguous'
  | 'incorrect'
  | 'missing';
export type PitchAssessmentDisplayState =
  | 'correct'
  | 'adjacent_semitone'
  | 'incorrect'
  | 'ambiguous'
  | 'low_confidence'
  | 'transposed_consistent';
export type PitchIntonationBand =
  | 'in_tune'
  | 'tuned'
  | 'loose_center'
  | 'poor_center'
  | 'boundary_cross'
  | 'adjacent_close'
  | null;
export type GlobalRelationshipKind =
  | 'exact_match'
  | 'octave_shifted'
  | 'globally_transposed'
  | 'locally_divergent'
  | 'unclassified';
export type RecoveryKind =
  | 'no_recovery'
  | 'contour_recovery'
  | 'interval_recovery'
  | 'pitch_recovery'
  | 'partial_recovery'
  | 'full_recovery';
export type TonalStateKind =
  | 'not_applicable'
  | 'unknown'
  | 'stable_target_tonic'
  | 'ambiguous'
  | 'structurally_recovered_only'
  | 'recovered_target_tonic'
  | 'recentered_new_tonic';
export type TonalWindowKind =
  | 'aligned_target'
  | 'leaning_alternate'
  | 'ambiguous'
  | 'insufficient_data';
export type RhythmRelationshipKind = 'shorter' | 'equal' | 'longer';
export type RhythmAccuracyKind =
  | 'insufficient_data'
  | 'strong'
  | 'mostly_correct'
  | 'partially_preserved'
  | 'unclear';
export type FlowQualityKind =
  | 'insufficient_data'
  | 'continuous'
  | 'mostly_continuous'
  | 'interrupted'
  | 'fragmented';

export interface AssessmentMelodyNote {
  index: number;
  midi: number;
  pitch: string;
  measure: number;
  beat: number;
  onsetBeat: number;
  sourceEvent: MelodyEvent;
}

export interface PitchAssessmentNote {
  index: number;
  target: AssessmentMelodyNote | null;
  performed: AssessmentMelodyNote | null;
  matchKind: PitchMatchKind;
  semitoneDelta: number | null;
  rawNormalizedExpectedMidi: number | null;
  rawScoringDelta: number | null;
  normalizedExpectedMidi: number | null;
  scoringDelta: number | null;
  absDelta: number | null;
  toleranceApplied: boolean;
  correctnessLocked: boolean;
  normalizedScoringUsed: boolean;
  comparisonTargetMidi: number | null;
  comparisonSemitoneDelta: number | null;
  centerDeviationCents: number | null;
  isCorrect: boolean;
  displayState: PitchAssessmentDisplayState;
  intonationBand: PitchIntonationBand;
  weakWindowProtectionApplied: boolean;
  isolatedErrorSoftened: boolean;
  globalOffsetCorrectionApplied: boolean;
  appliedGlobalOffset: number | null;
  intervalRecoveryCredit: number;
  intervalRecoveryApplied: boolean;
  interpretationReason: string | null;
}

export interface GlobalOffsetCorrectionAnalysis {
  candidateOffset: number | null;
  supportCount: number;
  supportRatio: number;
  applied: boolean;
  calibrationOffsetHint: number | null;
  calibrationContributed: boolean;
  calibrationSupportedCandidate: boolean;
  rawScore: number;
  correctedScore: number | null;
  improvement: number;
  rawAverageScore: number;
  correctedAverageScore: number | null;
  phraseAlreadyMostlyAcceptable: boolean;
  acceptedReason: string | null;
  rejectedReason: string | null;
  consideredCandidates: Array<{
    offset: number;
    exactSupportCount: number;
    supportCount: number;
    supportRatio: number;
    correctedAverageScore: number;
    improvement: number;
    calibrationSupportedCandidate: boolean;
    accepted: boolean;
    rejectedReason: string | null;
  }>;
  sessionPitchBias: {
    offset: number | null;
    supportCount: number;
    supportRatio: number;
    confidence: number;
    strongConsistentBiasDetected: boolean;
    treatedAsBias: boolean;
    appliedAsPhraseCorrection: boolean;
    appliedNoteCount: number;
    appliedSupportRatio: number;
    medianResidualCents: number | null;
    scoringImpact: string | null;
    reason: string | null;
  };
}

export interface IntervalAssessmentSpan {
  fromIndex: number;
  toIndex: number;
  expectedSemitones: number | null;
  performedSemitones: number | null;
  isCorrect: boolean;
}

export interface ContourAssessmentSpan {
  fromIndex: number;
  toIndex: number;
  expected: ContourDirection | null;
  performed: ContourDirection | null;
  isCorrect: boolean;
}

export type FirstDivergenceReason =
  | 'pitch_mismatch'
  | 'missing_performed_note'
  | 'extra_performed_note'
  | 'interval_mismatch'
  | 'contour_mismatch';

export interface FirstDivergencePoint {
  noteIndex: number;
  reason: FirstDivergenceReason;
  target: AssessmentMelodyNote | null;
  performed: AssessmentMelodyNote | null;
}

export interface MelodyAssessmentSummary {
  comparisonMode: AssessmentComparisonMode;
  globalRelationship: GlobalRelationshipKind;
  recoveryKind: RecoveryKind | null;
  tonalStateKind: TonalStateKind | null;
  transpositionSemitoneOffset: number | null;
  transpositionPitchClassOffset: number | null;
  transpositionLockedPhraseWide: boolean;
  targetNoteCount: number;
  performedNoteCount: number;
  pitchCorrectCount: number;
  pitchIncorrectCount: number;
  intervalCorrectCount: number;
  intervalIncorrectCount: number;
  contourCorrectCount: number;
  contourIncorrectCount: number;
  firstDivergenceIndex: number | null;
  literalPitchFullyCorrect: boolean;
  contourFullyCorrect: boolean;
}

export interface RecoveryAssessment {
  applicable: boolean;
  kind: RecoveryKind | null;
  recoveryNoteIndex: number | null;
  pitchRecoveryIndex: number | null;
  intervalRecoveryIndex: number | null;
  contourRecoveryIndex: number | null;
  recoveredDimensions: {
    pitch: boolean;
    interval: boolean;
    contour: boolean;
  };
  intervalRescue: {
    applicable: boolean;
    startIndex: number | null;
    endIndex: number | null;
    rescuedNoteIndices: number[];
    comparableIntervalCount: number;
    directionMatchRatio: number | null;
    intervalCloseness: number | null;
    rejoinedTarget: boolean;
    creditPerNote: number;
  };
}

export interface TonalWindowAssessment {
  label: 'pre_divergence' | 'post_divergence' | 'post_recovery';
  startIndex: number;
  endIndex: number | null;
  noteCount: number;
  targetFit: number | null;
  alternateFit: number | null;
  alternateTonicPitchClass: number | null;
  classification: TonalWindowKind;
}

export interface TonalStateAssessment {
  applicable: boolean;
  kind: TonalStateKind;
  targetTonicPitchClass: number | null;
  targetMode: 'major' | 'minor' | null;
  alternateTonicPitchClass: number | null;
  alignedWithTargetBeforeDivergence: boolean | null;
  returnedToTargetFrameAfterRecovery: boolean | null;
  likelyAlternateTonicAfterDivergence: boolean | null;
  structuralConsistency: {
    evaluatedStartIndex: number | null;
    evaluatedEndIndex: number | null;
    noteCount: number;
    intervalCount: number;
    contourCount: number;
    intervalConsistency: number | null;
    contourConsistency: number | null;
    pitchOffsetVariance: number | null;
    dominantPitchOffset: number | null;
    dominantPitchOffsetSupport: number | null;
    stronglyConsistent: boolean;
  };
  finalSegment: {
    startIndex: number | null;
    endIndex: number | null;
    noteCount: number;
    targetFit: number | null;
    shiftedFit: number | null;
    shiftedTonicPitchClass: number | null;
    betterAlignedWithTargetEnding: boolean | null;
  };
  windows: {
    preDivergence: TonalWindowAssessment;
    postDivergence: TonalWindowAssessment | null;
    postRecovery: TonalWindowAssessment | null;
  };
}

export interface RhythmSpanAssessment {
  fromIndex: number;
  toIndex: number;
  targetRatio: number | null;
  performedRatio: number | null;
  performedIoiMs: number | null;
  performedNextIoiMs: number | null;
  performedIoiRatio: number | null;
  performedDurationRatio: number | null;
  ratioError: number | null;
  ioiRatioError: number | null;
  durationRatioError: number | null;
  rhythmSignalUsed: 'ioi' | 'duration' | 'blended' | 'none';
  ioiWeightApplied: number;
  durationWeightApplied: number;
  ioiReducedForBreath: boolean;
  durationTrustedOverIoi: boolean;
  targetRelationship: RhythmRelationshipKind | null;
  performedRelationship: RhythmRelationshipKind | null;
  ratioScore: number | null;
  assignedScore: number | null;
  relationshipPreserved: boolean;
  patternPreservedBonusApplied: boolean;
  pauseAfterMs: number | null;
  pauseImpact: 'none' | 'brief_pause' | 'clear_pause';
  pausesIgnoredForAccuracy: boolean;
  gapAffectedFlowOnly: boolean;
}

export interface RhythmAccuracyAssessment {
  applicable: boolean;
  kind: RhythmAccuracyKind;
  score: number;
  baseScore: number;
  patternPreservedBonus: number;
  preservedStructureBonus: number;
  recognizablePatternSafeguard: number;
  flowOnlyRelief: number;
  noteCount: number;
  comparableSpanCount: number;
  preservedSpanCount: number;
  summary: string;
  spans: RhythmSpanAssessment[];
}

export interface FlowQualityAssessment {
  applicable: boolean;
  kind: FlowQualityKind;
  score: number;
  summary: string;
  averagePauseMs: number | null;
  pauseCount: number;
  longPauseCount: number;
  tempoDrift: number | null;
}

export interface RhythmAssessment {
  accuracy: RhythmAccuracyAssessment;
  flow: FlowQualityAssessment;
}

export interface AssessmentScoreSummary {
  pitchScore: number;
  rhythmScore: number;
  melodicScore: number;
}

export interface PerformanceValidityAssessment {
  isValid: boolean;
  coverage: number;
  weakRatio: number;
  contourRecognizable: boolean;
  flowScore: number;
  comparableRhythmSpanCount: number;
  reason: string;
}

export interface MelodyAssessmentFutureFields {
  interval: null;
  tonal: null;
  drift: null;
  recovery: null;
}

export interface MelodyAssessmentResult {
  summary: MelodyAssessmentSummary;
  notes: PitchAssessmentNote[];
  intervals: IntervalAssessmentSpan[];
  contours: ContourAssessmentSpan[];
  firstDivergence: FirstDivergencePoint | null;
  recovery: RecoveryAssessment;
  tonalState: TonalStateAssessment;
  rhythm: RhythmAssessment;
  scores: AssessmentScoreSummary;
  validity: PerformanceValidityAssessment;
  globalOffsetCorrection: GlobalOffsetCorrectionAnalysis;
  tonalFrame: TonalFrameSelectionAnalysis;
  future: MelodyAssessmentFutureFields;
}

export interface EvaluateMelodyAssessmentInput {
  targetMelody: MelodyEvent[];
  performedMelody: MelodyEvent[];
  performedDurationsMs?: Array<number | null>;
  performedStartsMs?: Array<number | null>;
  performedEndsMs?: Array<number | null>;
  performedWindowStatuses?: Array<'clear' | 'weak' | 'missing' | 'ambiguous' | null>;
  mode?: AssessmentComparisonMode;
  calibrationOffsetHint?: number | null;
  calibrationSignalQuality?: 'good' | 'fair' | 'poor' | null;
}

export interface GlobalRelationshipAnalysis {
  kind: GlobalRelationshipKind;
  semitoneDelta: number | null;
  pitchClassDelta: number | null;
  phraseOffsetLocked: boolean;
}

export type TonalFrameKind = 'written' | 'calibration_transposed';

export interface TonalFrameCandidateAnalysis {
  kind: TonalFrameKind;
  label: string;
  semitoneOffset: number;
  source: 'written' | 'calibration';
  targetKeyId: string | null;
  pitchScore: number;
  localPitchFit: number;
  structuralFit: number;
  intervalFit: number;
  contourFit: number;
  cadenceFit: number;
  rescuePressure: number;
  calibrationSupport: number;
  totalScore: number;
  accepted: boolean;
  rationale: string[];
}

export interface TonalFrameSelectionAnalysis {
  selectedKind: TonalFrameKind;
  selectedLabel: string;
  selectedSemitoneOffset: number;
  comparedAgainstWritten: boolean;
  calibrationProposedOffset: number | null;
  usedCalibrationProfile: boolean;
  rationale: string[];
  candidates: TonalFrameCandidateAnalysis[];
}
