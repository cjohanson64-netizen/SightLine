import type { AlignedSungNote } from "../pitches/pitchTypes";
import { normalizeInterval } from "./normalizeInterval";
import type { SungInterval } from "./intervalTypes";

type BuildSungIntervalsInput = {
  alignedNotes: AlignedSungNote[];
};

/**
 * Builds sung melodic intervals from aligned sung notes.
 *
 * This file owns only the student's sung interval sequence.
 *
 * It does not compare the sung intervals to the expected intervals.
 * It does not score correctness.
 * It does not analyze rhythm.
 */
export function buildSungIntervals(
  input: BuildSungIntervalsInput,
): SungInterval[] {
  const intervals: SungInterval[] = [];

  for (let i = 1; i < input.alignedNotes.length; i += 1) {
    const previousAlignedNote = input.alignedNotes[i - 1];
    const currentAlignedNote = input.alignedNotes[i];

    const previousSungNote = previousAlignedNote.sungNote;
    const currentSungNote = currentAlignedNote.sungNote;

    if (!previousSungNote || !currentSungNote) {
      continue;
    }

    const sungSemitones = currentSungNote.midiFloat - previousSungNote.midiFloat;

    intervals.push({
      index: i - 1,
      fromNoteIndex: previousAlignedNote.expectedNoteIndex,
      toNoteIndex: currentAlignedNote.expectedNoteIndex,
      sungSemitones,
      normalizedSungSemitones: normalizeInterval(sungSemitones),
    });
  }

  return intervals;
}