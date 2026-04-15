import type { MelodyEvent } from '@/SightLine/domain/music';
import type { AssessmentComparisonMode, MelodyAssessmentResult } from '@/SightLine/domain/assessment';
import type { CalibrationProfile } from '@/SightLine/core/calibration/types';

export interface DetectedPitchFrame {
  timeMs: number;
  frequencyHz: number | null;
  midi: number | null;
  confidence: number;
  rms: number;
}

export interface CleanedPitchFrame extends DetectedPitchFrame {
  rawMidi: number | null;
  cleanedMidi: number | null;
  voiced: boolean;
  rejectedReason: 'noise_floor' | 'low_confidence' | 'isolated_spike' | 'unstable_support' | null;
}

export type SegmentedNoteStatus = 'clear' | 'weak' | 'missing' | 'ambiguous';

export interface SegmentedPerformedNote {
  index: number;
  targetIndex: number;
  expectedMidi: number | null;
  expectedPitch: string | null;
  windowStartMs: number;
  windowEndMs: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  pitchCenter: number | null;
  midi: number | null;
  confidence: number;
  frameCount: number;
  voicedFrameCount: number;
  usedFrameCount: number;
  pitchSpread: number | null;
  dominantPitchBucket: number | null;
  dominantBucketStrength: number | null;
  dominantBucketSnapped: boolean;
  stablePitchSpread: number | null;
  alternateCandidateCenters: number[];
  expectedPriorAdjusted: boolean;
  contourAdjusted: boolean;
  phraseInitialAdjusted: boolean;
  onsetAdjusted: boolean;
  phraseLevelSmoothed: boolean;
  octaveAlternativesTested: boolean;
  roundedFromCenter: boolean;
  edgeTrimApplied: boolean;
  clusterRescued: boolean;
  targetConsistentAmbiguity: boolean;
  calibrationSupportedLocalEvidence: boolean;
  calibrationSupportLevel: 'strong' | 'weak' | 'rejected' | null;
  calibrationSupportReason: string | null;
  status: SegmentedNoteStatus;
  debugReason: string;
}

export interface PerformedAlignment {
  alignedMelody: MelodyEvent[];
  targetIndices: number[];
}

export interface MicAssessmentSignalQuality {
  level: 'high' | 'medium' | 'low';
  score: number;
  rejectedFrameCount: number;
  rejectedForNoiseCount: number;
  ambiguousWindowCount: number;
  targetConsistentAmbiguousCount: number;
  onsetAdjustedWindowCount: number;
  summary: string;
}

export interface MicAssessmentRunResult {
  frames: DetectedPitchFrame[];
  cleanedFrames: CleanedPitchFrame[];
  segmentedNotes: SegmentedPerformedNote[];
  alignedTargetIndices: number[];
  performedMelody: MelodyEvent[];
  assessment: MelodyAssessmentResult;
  warnings: string[];
  signalQuality: MicAssessmentSignalQuality;
  comparisonMode: AssessmentComparisonMode;
  calibrationProfileUsed: CalibrationProfile | null;
}
