import type { Confidence, DurationMs } from "./primitives";
import type { SungNoteEvent } from "./note";

export interface ExpectedRhythm {
  units: number[];
}

export interface RhythmAnalysisInput {
  expectedRhythm: ExpectedRhythm;
  actualEvents: SungNoteEvent[];
  melodicConfidence?: number;
  melodicIsReliable?: boolean;
  melodicStructureReliable?: boolean;
  melodicStructureReason?: string;
}

export interface RhythmAnalysisWindow {
  index: number;
  expectedUnits: number;
  actualMs: DurationMs;
  expectedMs: DurationMs;
  deviationRatio: number;
  classification: "match" | "close" | "mismatch";
  isFinal: boolean;
}

export interface RhythmFinding {
  id: string;
  type:
    | "rhythm_match"
    | "rhythm_close"
    | "rhythm_mismatch"
    | "final_note_short"
    | "final_note_long";
  windowIndex: number;
  confidence: Confidence;
  message: string;
}

export interface RhythmAnalysisOutput {
  windows: RhythmAnalysisWindow[];
  findings: RhythmFinding[];
  rhythmConfidence: Confidence;
  bodyRhythmConfidence: Confidence;
  finalRhythmConfidence: Confidence;
  tailAnomalyIndices?: number[];
  windowWeights?: number[];
  isProvisional: boolean;
  provisionalReason?: string;
}
