import type { IntakeRequest, IntakeOutput, PitchExtractionInput, PitchExtractionOutput, SignalCleaningInput, SignalCleaningOutput } from "./audio";
import type { KeyDetectionInput, KeyDetectionOutput } from "./key";
import type {
  GuidedSegmentationInput,
  GuidedSegmentationOutput,
  NoteSegmentationInput,
  NoteSegmentationOutput,
  OnsetSegmentationInput,
  OnsetSegmentationOutput,
} from "./note";
import type { NormalizationAlignmentInput, NormalizationAlignmentOutput } from "./alignment";
import type { RelationalAnalysisInput, RelationalAnalysisOutput } from "./analysis";
import type { RhythmAnalysisInput, RhythmAnalysisOutput } from "./rhythm";
import type { ScoringFeedbackInput, ScoringFeedbackOutput } from "./scoring";

export interface IntakeService {
  run(input: IntakeRequest): Promise<IntakeOutput>;
}

export interface KeyDetectionService {
  run(input: KeyDetectionInput): Promise<KeyDetectionOutput>;
}

export interface PitchExtractionService {
  run(input: PitchExtractionInput): Promise<PitchExtractionOutput>;
}

export interface SignalCleaningService {
  run(input: SignalCleaningInput): SignalCleaningOutput;
}

export interface NoteSegmentationService {
  run(input: NoteSegmentationInput): NoteSegmentationOutput;
}

export interface GuidedSegmentationService {
  run(input: GuidedSegmentationInput): GuidedSegmentationOutput;
}

export interface OnsetSegmentationService {
  run(input: OnsetSegmentationInput): OnsetSegmentationOutput;
}

export interface NormalizationAlignmentService {
  run(input: NormalizationAlignmentInput): NormalizationAlignmentOutput;
}

export interface RelationalAnalysisService {
  run(input: RelationalAnalysisInput): RelationalAnalysisOutput;
}

export interface RhythmAnalysisService {
  run(input: RhythmAnalysisInput): RhythmAnalysisOutput;
}

export interface ScoringFeedbackService {
  run(input: ScoringFeedbackInput): ScoringFeedbackOutput;
}
