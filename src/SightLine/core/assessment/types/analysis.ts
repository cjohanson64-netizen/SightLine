import type { Confidence, RelationalFindingType } from "./primitives";
import type { AlignmentPair, IntervalStep } from "./alignment";
import type { DetectedTonic } from "./key";
import type { NormalizedActualNote, NormalizedExpectedNote } from "./note";

export interface AnalysisWindow {
  startAlignmentIndex: number;
  endAlignmentIndex: number;
}

export interface RelationalAnalysisInput {
  tonic: DetectedTonic;
  expectedNotes: NormalizedExpectedNote[];
  actualNotes: NormalizedActualNote[];
  alignedPairs: AlignmentPair[];
  expectedIntervals: IntervalStep[];
  actualIntervals: IntervalStep[];
  windows: AnalysisWindow[];
}

export interface RelationalFinding {
  id: string;
  type: RelationalFindingType;
  alignmentRange: [number, number];
  confidence: Confidence;
  message: string;
}

export interface RelationalAnalysisOutput {
  findings: RelationalFinding[];
  analysisConfidence: Confidence;
}
