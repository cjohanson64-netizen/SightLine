import type {
  AlignmentPair,
  DetectedTonic,
  ExpectedMelody,
  IntervalStep,
  NormalizationAlignmentInput,
  NormalizationAlignmentOutput,
  NormalizedActualNote,
  NormalizedExpectedNote,
  SungNoteEvent,
} from "../types";
import type { NormalizationAlignmentService } from "../types/services";

const MAJOR_SCALE_DEGREE_MAP: Record<number, number> = {
  0: 0, // do
  2: 1, // re
  4: 2, // mi
  5: 3, // fa
  7: 4, // sol
  9: 5, // la
  11: 6, // ti
};

const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

function getPitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function getRelativePitchClass(midi: number, tonicPitchClass: number): number {
  return (getPitchClass(midi) - tonicPitchClass + 12) % 12;
}

function quantizeMidiToPitchClass(midiFloat: number): number {
  return getPitchClass(Math.round(midiFloat));
}

function getRelativePitchClassFromMidiFloat(
  midiFloat: number,
  tonicPitchClass: number,
): number {
  return (quantizeMidiToPitchClass(midiFloat) - tonicPitchClass + 12) % 12;
}

function getScaleDegreeFromRelativePitchClass(
  relativePitchClass: number,
): number {
  return MAJOR_SCALE_DEGREE_MAP[relativePitchClass] ?? -1;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function getDegreeOffsetFromTonic(scaleDegree: number): number {
  return MAJOR_SCALE_OFFSETS[scaleDegree] ?? 0;
}

function getNearestExpectedRelativeScaleTone(params: {
  midiFloat: number;
  tonicPitchClass: number;
  expectedMidiFloat: number;
}): {
  snappedMidiFloat: number;
  snappedDegree: number;
} {
  const { midiFloat, tonicPitchClass, expectedMidiFloat } = params;

  const candidateMidis = [
    expectedMidiFloat - 2,
    expectedMidiFloat - 1,
    expectedMidiFloat,
    expectedMidiFloat + 1,
    expectedMidiFloat + 2,
  ];

  let bestMidi = expectedMidiFloat;
  let bestDegree = getScaleDegreeFromRelativePitchClass(
    getRelativePitchClassFromMidiFloat(expectedMidiFloat, tonicPitchClass),
  );
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidateMidi of candidateMidis) {
    const relativePitchClass = getRelativePitchClassFromMidiFloat(
      candidateMidi,
      tonicPitchClass,
    );

    const candidateDegree =
      getScaleDegreeFromRelativePitchClass(relativePitchClass);

    if (candidateDegree === -1) {
      continue;
    }

    const distance = Math.abs(midiFloat - candidateMidi);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMidi = candidateMidi;
      bestDegree = candidateDegree;
    }
  }

  return {
    snappedMidiFloat: bestMidi,
    snappedDegree: bestDegree,
  };
}

function buildExpectedNotes(
  expectedMelody: ExpectedMelody,
  tonic: DetectedTonic,
): NormalizedExpectedNote[] {
  return expectedMelody.notes.map((note, index) => {
    const relativePitchClass = getRelativePitchClass(
      note.writtenMidi,
      tonic.tonicPitchClass,
    );

    const scaleDegree =
      getScaleDegreeFromRelativePitchClass(relativePitchClass);

    return {
      id: note.id,
      index,
      midiFloat: note.writtenMidi,
      snappedMidiFloat: note.writtenMidi,
      scaleDegree,
    };
  });
}

function buildActualNotes(
  actualNotes: SungNoteEvent[],
  tonic: DetectedTonic,
  expectedNotes: NormalizedExpectedNote[],
): NormalizedActualNote[] {
  return actualNotes.map((note, index) => {
    const expectedNote = expectedNotes[index];

    let snappedMidiFloat = note.midiFloat;
    let scaleDegree = getScaleDegreeFromRelativePitchClass(
      getRelativePitchClassFromMidiFloat(note.midiFloat, tonic.tonicPitchClass),
    );

    if (expectedNote) {
      const previousExpected = index > 0 ? expectedNotes[index - 1] : null;
      const nextExpected =
        index < expectedNotes.length - 1 ? expectedNotes[index + 1] : null;

      const candidateMidis = [
        expectedNote.midiFloat - 2,
        expectedNote.midiFloat - 1,
        expectedNote.midiFloat,
        expectedNote.midiFloat + 1,
        expectedNote.midiFloat + 2,
      ];

      let bestMidi = expectedNote.midiFloat;
      let bestDegree = expectedNote.scaleDegree;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const candidateMidi of candidateMidis) {
        const relativePitchClass = getRelativePitchClassFromMidiFloat(
          candidateMidi,
          tonic.tonicPitchClass,
        );

        const candidateDegree =
          getScaleDegreeFromRelativePitchClass(relativePitchClass);

        if (candidateDegree === -1) {
          continue;
        }

        const pitchDistance = Math.abs(note.midiFloat - candidateMidi);

        let pathPenalty = 0;

        if (previousExpected) {
          const expectedStepFromPrevious =
            expectedNote.midiFloat - previousExpected.midiFloat;
          const candidateStepFromPrevious =
            candidateMidi - previousExpected.midiFloat;

          pathPenalty += Math.abs(
            candidateStepFromPrevious - expectedStepFromPrevious,
          );
        }

        if (nextExpected) {
          const expectedStepToNext =
            nextExpected.midiFloat - expectedNote.midiFloat;
          const candidateStepToNext = nextExpected.midiFloat - candidateMidi;

          pathPenalty += Math.abs(candidateStepToNext - expectedStepToNext);
        }

        // Special protection for TI in ascending scales:
        // if expected is TI and next is upper DO, prefer TI unless candidate DO is clearly closer
        if (
          expectedNote.scaleDegree === 6 &&
          nextExpected &&
          nextExpected.scaleDegree === 0
        ) {
          const isCandidateDo =
            candidateDegree === 0 && candidateMidi >= expectedNote.midiFloat;
          const isCandidateTi = candidateDegree === 6;

          if (isCandidateDo && note.midiFloat < expectedNote.midiFloat + 0.75) {
            pathPenalty += 1.5;
          }

          if (isCandidateTi && note.midiFloat < expectedNote.midiFloat + 0.75) {
            pathPenalty -= 0.5;
          }
        }

        const score = pitchDistance + pathPenalty * 0.75;

        if (score < bestScore) {
          bestScore = score;
          bestMidi = candidateMidi;
          bestDegree = candidateDegree;
        }
      }

      const snapDistance = Math.abs(note.midiFloat - bestMidi);

      const isFinalExpectedNote = index === expectedNotes.length - 1;
      const expectedOctaveDistance = Math.abs(
        note.midiFloat - expectedNote.midiFloat,
      );

      const shouldRejectForWrongOctave =
        isFinalExpectedNote &&
        bestDegree === expectedNote.scaleDegree &&
        expectedOctaveDistance > 6;

      if (snapDistance <= 1.5 && !shouldRejectForWrongOctave) {
        snappedMidiFloat = bestMidi;
        scaleDegree = bestDegree;
      } else {
        snappedMidiFloat = note.midiFloat;

        const relativePitchClass = getRelativePitchClassFromMidiFloat(
          note.midiFloat,
          tonic.tonicPitchClass,
        );

        scaleDegree = getScaleDegreeFromRelativePitchClass(relativePitchClass);
      }
    }

    return {
      id: note.id,
      index,
      sourceEventId: note.id,
      midiFloat: note.midiFloat,
      snappedMidiFloat,
      scaleDegree,
      startMs: note.startMs,
      endMs: note.endMs,
      durationMs: note.durationMs,
      confidence: note.confidence,
    };
  });
}

function buildIntervals<
  T extends { id: string; midiFloat: number; snappedMidiFloat?: number },
>(notes: T[]): IntervalStep[] {
  const intervals: IntervalStep[] = [];

  for (let index = 1; index < notes.length; index += 1) {
    const previous = notes[index - 1];
    const current = notes[index];

    const previousPitch =
      previous.snappedMidiFloat !== undefined
        ? previous.snappedMidiFloat
        : previous.midiFloat;

    const currentPitch =
      current.snappedMidiFloat !== undefined
        ? current.snappedMidiFloat
        : current.midiFloat;

    const semitonesFloat = currentPitch - previousPitch;
    const semitones = Math.round(semitonesFloat);
    const contour =
      semitonesFloat > 0 ? "up" : semitonesFloat < 0 ? "down" : "same";

    intervals.push({
      fromId: previous.id,
      toId: current.id,
      semitones,
      semitonesFloat,
      contour,
    });
  }

  return intervals;
}

function buildDegrees<T extends { scaleDegree: number }>(notes: T[]): number[] {
  return notes.map((note) => note.scaleDegree);
}

function buildSimpleAlignment(
  expectedNotes: NormalizedExpectedNote[],
  actualNotes: NormalizedActualNote[],
): AlignmentPair[] {
  const maxLength = Math.max(expectedNotes.length, actualNotes.length);
  const pairs: AlignmentPair[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const expected = expectedNotes[index] ?? null;
    const actual = actualNotes[index] ?? null;

    if (expected && actual) {
      pairs.push({
        index,
        kind: "matched",
        expectedNoteId: expected.id,
        actualNoteId: actual.id,
      });
    } else if (expected && !actual) {
      pairs.push({
        index,
        kind: "omission",
        expectedNoteId: expected.id,
        actualNoteId: null,
      });
    } else if (!expected && actual) {
      pairs.push({
        index,
        kind: "insertion",
        expectedNoteId: null,
        actualNoteId: actual.id,
      });
    }
  }

  return pairs;
}

export const normalizationAlignmentService: NormalizationAlignmentService = {
  run(input: NormalizationAlignmentInput): NormalizationAlignmentOutput {
    const expectedNotes = buildExpectedNotes(input.expectedMelody, input.tonic);
    const actualNotes = buildActualNotes(
      input.actualNotes,
      input.tonic,
      expectedNotes,
    );

    const expectedIntervals = buildIntervals(expectedNotes);
    const actualIntervals = buildIntervals(actualNotes);

    const expectedDegrees = buildDegrees(expectedNotes);
    const actualDegrees = buildDegrees(actualNotes);

    const alignedPairs = buildSimpleAlignment(expectedNotes, actualNotes);

    return {
      expectedNotes,
      actualNotes,
      alignedPairs,
      expectedIntervals,
      actualIntervals,
      expectedDegrees,
      actualDegrees,
    };
  },
};
