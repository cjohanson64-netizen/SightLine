import type { CleanedPitchFrame, DetectedPitchFrame, SegmentedPerformedNote } from '@/SightLine/core/audio/types';

export type CalibrationSignalQuality = 'good' | 'fair' | 'poor';

export interface CalibrationProfile {
  successful: boolean;
  keyId: string | null;
  tonicMidi: number | null;
  tonicOffsetSemitones: number | null;
  registerOffset: number | null;
  averageConfidence: number | null;
  averagePitchStability: number | null;
  signalQuality: CalibrationSignalQuality | null;
  summary: string;
  expectedPatternLabels: string[];
  expectedMidis: number[];
  detectedCenters: Array<number | null>;
}

export interface CalibrationRunResult {
  profile: CalibrationProfile;
  frames: DetectedPitchFrame[];
  cleanedFrames: CleanedPitchFrame[];
  segmentedNotes: SegmentedPerformedNote[];
  warnings: string[];
}
