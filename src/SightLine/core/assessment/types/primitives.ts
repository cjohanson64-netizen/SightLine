export type TimestampMs = number;
export type DurationMs = number;
export type FrequencyHz = number;
export type MidiNumber = number;
export type MidiFloat = number;
export type PitchClass = number; // 0-11
export type ScaleDegree = number; // relative to tonic
export type Confidence = number; // 0-1

export type ContourDirection = "up" | "down" | "same";

export type AlignmentKind =
  | "matched"
  | "insertion"
  | "omission"
  | "substitution";

export type RelationalFindingType =
  | "exact_match"
  | "interval_match"
  | "tone_center_drift"
  | "wrong_interval"
  | "insertion"
  | "omission"
  | "recovery";
