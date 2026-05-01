import type { ExpectedNote } from "../intake/buildExpectedAssessment";
import type { NoteCountResult, SungNote } from "./pitchTypes";

type CompareNoteCountInput = {
  expectedNotes: ExpectedNote[];
  sungNotes: SungNote[];
};

/**
 * Answers assessment question #1:
 * Did they sing the same number of notes?
 *
 * This file owns note count comparison only.
 *
 * It does not decide melodic correctness.
 * It does not compare intervals.
 * It does not grade rhythm.
 */
export function compareNoteCount(
  input: CompareNoteCountInput,
): NoteCountResult {
  const expectedCount = input.expectedNotes.length;
  const sungCount = input.sungNotes.length;
  const difference = sungCount - expectedCount;

  if (sungCount === 0) {
    return {
      expectedCount,
      sungCount,
      difference,
      status: "noneDetected",
    };
  }

  if (difference === 0) {
    return {
      expectedCount,
      sungCount,
      difference,
      status: "match",
    };
  }

  return {
    expectedCount,
    sungCount,
    difference,
    status: difference < 0 ? "tooFew" : "tooMany",
  };
}