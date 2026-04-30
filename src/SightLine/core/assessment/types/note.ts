import type {
  Confidence,
  DurationMs,
  FrequencyHz,
  MidiFloat,
  MidiNumber,
  ScaleDegree,
  TimestampMs,
} from "./primitives";
import type { CleanPitchFrame } from "./audio";

export interface NoteSegmentationInput {
  frames: CleanPitchFrame[];
  minNoteDurationMs: DurationMs;
  tonicPitchClass?: number;
}

export interface GuidedSegmentationInput {
  frames: CleanPitchFrame[];
  expectedNoteCount: number;
  expectedMidiFloats?: number[];
}

export interface OnsetSegmentationInput {
  frames: CleanPitchFrame[];
  expectedNoteCount?: number;
}

export interface SungNoteEvent {
  id: string;
  startMs: TimestampMs;
  endMs: TimestampMs;
  durationMs: DurationMs;
  pitchHz: FrequencyHz;
  midiFloat: MidiFloat;
  confidence: Confidence;
}

export interface NoteSegmentationOutput {
  noteEvents: SungNoteEvent[];
}

export interface GuidedSegmentationOutput {
  noteEvents: SungNoteEvent[];
}

export interface OnsetSegmentationOutput {
  noteEvents: SungNoteEvent[];
  rawOnsetCandidateCount: number;
  suppressedOnsetCount: number;
  resplitCount: number;
  rejectedResplitCount: number;
  trailingReattachmentCount: number;
}

export interface ExpectedNoteEvent {
  id: string;
  index: number;
  writtenMidi: MidiNumber;
  writtenNoteName: string;
}

export interface ExpectedMelody {
  exerciseId: string;
  notes: ExpectedNoteEvent[];
}

export interface NormalizedExpectedNote {
  id: string;
  index: number;
  midiFloat: MidiFloat;
  snappedMidiFloat: MidiFloat;
  scaleDegree: ScaleDegree;
}

export interface NormalizedActualNote {
  id: string;
  index: number;
  sourceEventId: string;
  midiFloat: MidiFloat;
  snappedMidiFloat: MidiFloat;
  scaleDegree: ScaleDegree;
  startMs: TimestampMs;
  endMs: TimestampMs;
  durationMs: DurationMs;
  confidence: Confidence;
}
