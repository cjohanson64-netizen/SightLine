import type {
  CleanedPitchFrame,
  DetectedPitchFrame,
  SegmentedPerformedNote,
} from "@/SightLine/core/audio/types";

export type CalibrationSignalQuality = "good" | "fair" | "poor";

export type CalibratedScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CalibratedDegreeProfile {
  degree: CalibratedScaleDegree;
  label: string;
  expectedPitch: string;
  expectedMidi: number;
  detectedMidi: number | null;
  center: number | null;
  offsetFromExpected: number | null;
  confidence: number;
  stability: number;
  status: SegmentedPerformedNote["status"];
}

export interface CalibrationProfile {
  successful: boolean;
  keyId: string | null;
  tonicMidi: number | null;
  tonicOffsetSemitones: number | null;
  registerOffset: number | null;
  averageConfidence: number | null;
  averagePitchStability: number | null;
  overallConfidence: number | null;
  signalQuality: CalibrationSignalQuality | null;
  summary: string;
  expectedPatternLabels: string[];
  expectedMidis: number[];
  detectedCenters: Array<number | null>;
  degrees: CalibratedDegreeProfile[];
  offsetSpreadSemitones: number | null;
  coherentDegreeCount: number;
  coherence: "high" | "medium" | "low";
}

export interface CalibrationRunResult {
  profile: CalibrationProfile;
  frames: DetectedPitchFrame[];
  cleanedFrames: CleanedPitchFrame[];
  segmentedNotes: SegmentedPerformedNote[];
  warnings: string[];
}
