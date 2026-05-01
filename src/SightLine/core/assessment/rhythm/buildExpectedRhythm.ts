import type { ExpectedNote } from "../intake/buildExpectedAssessment";
import type { ExpectedRhythmUnit } from "./rhythmTypes";

/**
 * Builds expected rhythm proportions from expected notes.
 *
 * This file owns only the written/expected rhythm sequence.
 *
 * It does not inspect sung audio.
 * It does not infer tempo.
 * It does not score rhythm.
 */
export function buildExpectedRhythm(
  expectedNotes: ExpectedNote[],
): ExpectedRhythmUnit[] {
  return expectedNotes.map((note) => ({
    index: note.index,
    noteIndex: note.index,
    expectedBeats: note.durationBeats,
  }));
}