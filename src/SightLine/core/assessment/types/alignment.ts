import type {
  AlignmentKind,
  ContourDirection,
  ScaleDegree,
} from "./primitives";
import type {
  ExpectedMelody,
  NormalizedActualNote,
  NormalizedExpectedNote,
  SungNoteEvent,
} from "./note";
import type { DetectedTonic } from "./key";

export interface IntervalStep {
  fromId: string;
  toId: string;
  semitones: number;
  semitonesFloat: number;
  contour: ContourDirection;
}

export interface AlignmentPair {
  index: number;
  kind: AlignmentKind;
  expectedNoteId: string | null;
  actualNoteId: string | null;
}

export interface NormalizationAlignmentInput {
  tonic: DetectedTonic;
  expectedMelody: ExpectedMelody;
  actualNotes: SungNoteEvent[];
}

export interface NormalizationAlignmentOutput {
  expectedNotes: NormalizedExpectedNote[];
  actualNotes: NormalizedActualNote[];
  alignedPairs: AlignmentPair[];
  expectedDegrees: ScaleDegree[];
  actualDegrees: ScaleDegree[];
  expectedIntervals: IntervalStep[];
  actualIntervals: IntervalStep[];
}
