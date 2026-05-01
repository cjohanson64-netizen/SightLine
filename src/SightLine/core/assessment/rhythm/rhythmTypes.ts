export type ExpectedRhythmUnit = {
  index: number;
  noteIndex: number;
  expectedBeats: number;
};

export type SungRhythmUnit = {
  index: number;
  noteIndex: number;
  durationMs: number;
  durationSource?: "onsetToOnset" | "noteDuration" | "estimatedFinal";

  /**
   * Sung duration normalized into beat-like units.
   *
   * Example:
   * If the inferred tempo is 500ms per beat,
   * a 1000ms sung note becomes 2 sung units.
   */
  sungBeats: number;
};

export type RhythmStatus = "match" | "close" | "mismatch" | "missing";

export type RhythmResult = {
  noteIndex: number;
  expectedBeats: number;
  sungBeats: number | null;
  durationMs: number | null;

  /**
   * Absolute proportional error.
   *
   * Example:
   * expected 2 beats, sung 1.5 beats
   * error = 0.25
   */
  proportionalError: number | null;

  status: RhythmStatus;
  repairReason?: "adjacentBoundaryShift";
};

export type RhythmComparisonOptions = {
  /**
   * Proportional error allowed for a rhythm match.
   *
   * Example:
   * 0.15 means the sung duration can be within 15% of expected.
   */
  matchTolerance?: number;

  /**
   * Proportional error allowed for a close rhythm.
   *
   * Example:
   * 0.3 means the sung duration can be within 30% of expected.
   */
  closeTolerance?: number;

  /**
   * Final notes/releases are often less precise in real singing.
   * This allows the final note to be judged with slightly more forgiveness.
   */
  finalNoteMatchTolerance?: number;

  /**
   * Final notes/releases are often less precise in real singing.
   * This allows the final note to be judged close with slightly more forgiveness.
   */
  finalNoteCloseTolerance?: number;
};
