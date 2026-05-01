export type StabilityStatus =
  | "stable"
  | "mostlyStable"
  | "unstable"
  | "unassessable";

export type StabilityResult = {
  noteIndex: number;
  status: StabilityStatus;

  /**
   * Difference between the lowest and highest detected stable pitch
   * inside the sung note, measured in cents.
   */
  pitchSpreadCents: number | null;

  /**
   * Average clarity/confidence of the pitch frames inside the note.
   */
  averageClarity: number | null;

  /**
   * How much this stability result should influence scoring/UI.
   *
   * Example:
   * stable       → 1
   * mostlyStable → 0.85
   * unstable     → 0.5
   * unassessable → 0
   */
  reliabilityWeight: number;
};

export type StabilityAnalysisOptions = {
  /**
   * Pitch spread at or below this value counts as stable.
   */
  stableSpreadCents?: number;

  /**
   * Pitch spread at or below this value counts as mostly stable.
   */
  mostlyStableSpreadCents?: number;

  /**
   * Minimum average clarity needed to trust the note.
   */
  minAverageClarity?: number;

  /**
   * Minimum number of clean pitch frames needed inside a note.
   */
  minFramesPerNote?: number;
};