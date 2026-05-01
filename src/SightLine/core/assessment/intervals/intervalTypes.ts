export type ExpectedInterval = {
  index: number;
  fromNoteIndex: number;
  toNoteIndex: number;
  expectedSemitones: number;
};

export type SungInterval = {
  index: number;
  fromNoteIndex: number;
  toNoteIndex: number;
  sungSemitones: number;
  normalizedSungSemitones: number;
};

export type IntervalStatus =
  | "correct"
  | "close"
  | "partial"
  | "incorrect"
  | "missing";

export type IntervalResult = {
  index: number;
  fromNoteIndex: number;
  toNoteIndex: number;
  expectedSemitones: number;
  sungSemitones: number | null;
  normalizedSungSemitones: number | null;
  intervalDifference: number | null;
  status: IntervalStatus;
  repairReason?: "repeatedNoteBoundaryShift";
};

export type IntervalComparisonOptions = {
  /**
   * Difference in semitones allowed for a correct interval.
   *
   * Example:
   * expected +2.00
   * sung +1.78
   * difference 0.22
   * → correct
   */
  correctToleranceSemitones?: number;

  /**
   * Difference in semitones allowed for a close interval.
   *
   * Example:
   * expected +2.00
   * sung +1.45
   * difference 0.55
   * → close
   */
  closeToleranceSemitones?: number;
};
