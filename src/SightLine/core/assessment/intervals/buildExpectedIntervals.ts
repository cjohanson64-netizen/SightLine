import type { ExpectedNote } from "../intake/buildExpectedAssessment";
import type { ExpectedInterval } from "./intervalTypes";

/**
 * Builds written melodic intervals from expected notes.
 *
 * Example:
 * C4 D4 E4 F4
 *
 * becomes:
 * +2, +2, +1
 *
 * This file owns only the expected written interval sequence.
 * It does not analyze student singing.
 * It does not score correctness.
 */
export function buildExpectedIntervals(
  expectedNotes: ExpectedNote[],
): ExpectedInterval[] {
  const intervals: ExpectedInterval[] = [];

  for (let i = 1; i < expectedNotes.length; i += 1) {
    const previousNote = expectedNotes[i - 1];
    const currentNote = expectedNotes[i];

    intervals.push({
      index: i - 1,
      fromNoteIndex: previousNote.index,
      toNoteIndex: currentNote.index,
      expectedSemitones: currentNote.writtenMidi - previousNote.writtenMidi,
    });
  }

  return intervals;
}