import type { OnsetSegmentationOutput } from "../../types";

export const STABLE_CLARITY_THRESHOLD = 0.75;
export const PITCH_SHIFT_THRESHOLD_SEMITONES = 0.75;
export const PERSISTENCE_WINDOW_FRAMES = 4;
export const PERSISTENCE_REQUIRED_FRAMES = 2;
export const MIN_ONSET_SPACING_MS = 130;
export const HARD_MIN_NOTE_DURATION_MS = 180;
export const MIN_VALID_NOTE_DURATION_MS = 230;
export const MIN_STABLE_FRAMES_PER_EVENT = 2;
export const MIN_STABLE_COVERAGE_RATIO = 0.35;
export const STRONG_SHORT_EVENT_CLARITY = 0.9;
export const LONG_SPAN_ABSOLUTE_DURATION_MS = 1000;
export const LONG_SPAN_MEDIAN_MULTIPLIER = 1.5;
export const LONG_SPAN_NEIGHBOR_MULTIPLIER = 1.4;
export const RESPLIT_MIN_SUBSPAN_DURATION_MS = 220;
export const RESPLIT_MIN_PITCH_SHIFT_SEMITONES = 0.45;
export const RESPLIT_SUPPORT_WINDOW_FRAMES = 6;
export const RESPLIT_HARD_MIN_SUBSPAN_DURATION_MS = 250;
export const RESPLIT_NEIGHBOR_PLAUSIBILITY_SEMITONES = 6;
export const RESPLIT_SPIKE_FRAGMENT_SEMITONES = 7;
export const TRAILING_REATTACH_MAX_DURATION_MS = 180;
export const TRAILING_REATTACH_MIN_PREVIOUS_DURATION_MS = 320;
export const TAIL_SHORT_EVENT_DURATION_MS = 220;
export const TAIL_REATTACH_MAX_DURATION_MS = 240;
export const TAIL_OUTLIER_SEMITONES = 5.5;
export const TAIL_HIGH_SPIKE_SEMITONES = 7;
export const TAIL_FINAL_PITCH_PRESERVE_SEMITONES = 4.5;
export const SPIKE_EVENT_MAX_DURATION_MS = 220;
export const SPIKE_NEIGHBOR_DISTANCE_SEMITONES = 5;
export const ADJACENT_MERGE_SEMITONES = 0.5;
export const RECOVERY_LONG_SPAN_MULTIPLIER = 1.8;
export const RECOVERY_MIN_SUBSPAN_DURATION_MS = 300;
export const RECOVERY_MIN_PITCH_SHIFT_SEMITONES = 1.75;
export const RECOVERY_SUPPORT_WINDOW_FRAMES = 4;
export const RECOVERY_MIN_STABLE_FRAMES = 3;
export const MUCH_LONGER_NEIGHBOR_DURATION_MS = 280;
export const HARMONIC_SPIKE_NEIGHBOR_DISTANCE_SEMITONES = 3.5;
export const HARMONIC_SPIKE_NEIGHBOR_MATCH_SEMITONES = 1.5;

export function emptyOnsetSegmentationOutput(): OnsetSegmentationOutput {
  return {
    noteEvents: [],
    rawOnsetCandidateCount: 0,
    suppressedOnsetCount: 0,
    resplitCount: 0,
    rejectedResplitCount: 0,
    trailingReattachmentCount: 0,
  };
}