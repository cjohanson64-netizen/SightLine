export type RawPitchFrame = {
  frameIndex: number;
  timeMs: number;
  pitchHz: number | null;
  clarity: number;
  isVoiced: boolean;
};

export type CleanPitchFrame = {
  frameIndex: number;
  timeMs: number;
  rawPitchHz: number;
  stablePitchHz: number;
  clarity: number;
};

export type SungNote = {
  index: number;
  id: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  pitchHz: number;
  midiFloat: number;
  confidence: number;
};

export type NoteCountStatus =
  | "match"
  | "tooFew"
  | "tooMany"
  | "noneDetected";

export type NoteCountResult = {
  expectedCount: number;
  sungCount: number;
  difference: number;
  status: NoteCountStatus;
};

export type AlignedSungNote = {
  expectedNoteIndex: number;
  sungNote: SungNote | null;
  alignmentStatus: "matched" | "missing";
};

export type ExtraSungNote = {
  sungNote: SungNote;
  reason: "extra";
};

export type NoteAlignmentResult = {
  alignedNotes: AlignedSungNote[];
  extraNotes: ExtraSungNote[];
  noteCount: NoteCountResult;
};

export type PitchExtractionOptions = {
  frameSize?: number;
  hopSize?: number;
  clarityThreshold?: number;
};

export type PitchCleaningOptions = {
  minPitchHz?: number;
  maxPitchHz?: number;
  minVoicedRunFrames?: number;
  smoothingWindowSize?: number;
};

export type NoteSegmentationOptions = {
  minNoteDurationMs?: number;
  maxGapMs?: number;
  maxPitchDeviationHz?: number;
  minSurvivingNoteDurationMs?: number;
};