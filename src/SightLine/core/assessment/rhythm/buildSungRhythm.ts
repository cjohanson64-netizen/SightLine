import type { AlignedSungNote, SungNote } from "../pitches/pitchTypes";
import type { ExpectedRhythmUnit, SungRhythmUnit } from "./rhythmTypes";

type BuildSungRhythmInput = {
  expectedRhythm: ExpectedRhythmUnit[];
  alignedNotes: AlignedSungNote[];
};

/**
 * Builds sung rhythm units from aligned sung notes.
 *
 * This file owns:
 * - extracting sung note durations
 * - inferring a performance tempo from the student's own singing
 * - converting sung durations into beat-like units
 *
 * It does not decide whether rhythm is correct.
 * It does not compare pitch.
 */
export function buildSungRhythm(input: BuildSungRhythmInput): SungRhythmUnit[] {
  const matchedPairs = getMatchedRhythmPairs(input);

  if (matchedPairs.length === 0) {
    return [];
  }

  const durationRecords = buildSungDurationRecords(matchedPairs);
  const tempoMsPerBeat = inferTempoMsPerBeat(durationRecords);

  return durationRecords.map((record) => ({
    index: record.expected.index,
    noteIndex: record.expected.noteIndex,
    durationMs: record.durationMs,
    durationSource: record.durationSource,
    sungBeats: record.durationMs / tempoMsPerBeat,
  }));
}

type MatchedRhythmPair = {
  expected: ExpectedRhythmUnit;
  sungNote: SungNote;
};

type SungDurationRecord = {
  expected: ExpectedRhythmUnit;
  durationMs: number;
  durationSource: NonNullable<SungRhythmUnit["durationSource"]>;
};

function getMatchedRhythmPairs(
  input: BuildSungRhythmInput,
): MatchedRhythmPair[] {
  return input.expectedRhythm.flatMap((expectedUnit) => {
    const alignedNote = input.alignedNotes.find(
      (note) => note.expectedNoteIndex === expectedUnit.noteIndex,
    );

    if (!alignedNote?.sungNote) {
      return [];
    }

    return [
      {
        expected: expectedUnit,
        sungNote: alignedNote.sungNote,
      },
    ];
  });
}

function buildSungDurationRecords(
  pairs: MatchedRhythmPair[],
): SungDurationRecord[] {
  return pairs.flatMap((pair, index) => {
    const nextPair = pairs[index + 1];
    const isFinalMatchedPair = !nextPair;
    const duration = isFinalMatchedPair
      ? getFinalNoteDuration({
          pair,
          previousDurationMs: getPreviousValidDurationMs(pairs, index),
        })
      : getNonFinalNoteDuration({
          pair,
          nextPair,
        });

    if (!duration) {
      return [];
    }

    return [
      {
        expected: pair.expected,
        durationMs: duration.durationMs,
        durationSource: duration.durationSource,
      },
    ];
  });
}

function getNonFinalNoteDuration(input: {
  pair: MatchedRhythmPair;
  nextPair: MatchedRhythmPair;
}): Pick<SungDurationRecord, "durationMs" | "durationSource"> | null {
  const onsetToOnsetDurationMs =
    input.nextPair.sungNote.startMs - input.pair.sungNote.startMs;

  if (isValidDurationMs(onsetToOnsetDurationMs)) {
    return {
      durationMs: onsetToOnsetDurationMs,
      durationSource: "onsetToOnset",
    };
  }

  if (isValidDurationMs(input.pair.sungNote.durationMs)) {
    return {
      durationMs: input.pair.sungNote.durationMs,
      durationSource: "noteDuration",
    };
  }

  return null;
}

function getFinalNoteDuration(input: {
  pair: MatchedRhythmPair;
  previousDurationMs: number | null;
}): Pick<SungDurationRecord, "durationMs" | "durationSource"> | null {
  if (isReliableFinalDurationMs(input.pair.sungNote.durationMs)) {
    return {
      durationMs: input.pair.sungNote.durationMs,
      durationSource: "noteDuration",
    };
  }

  if (input.previousDurationMs !== null) {
    return {
      durationMs: input.previousDurationMs,
      durationSource: "estimatedFinal",
    };
  }

  if (isValidDurationMs(input.pair.sungNote.durationMs)) {
    return {
      durationMs: input.pair.sungNote.durationMs,
      durationSource: "noteDuration",
    };
  }

  return null;
}

function getPreviousValidDurationMs(
  pairs: MatchedRhythmPair[],
  finalPairIndex: number,
): number | null {
  for (let index = finalPairIndex - 1; index >= 0; index -= 1) {
    const currentPair = pairs[index];
    const nextPair = pairs[index + 1];

    if (!currentPair || !nextPair) {
      continue;
    }

    const durationMs = nextPair.sungNote.startMs - currentPair.sungNote.startMs;

    if (isValidDurationMs(durationMs)) {
      return durationMs;
    }
  }

  return null;
}

function isReliableFinalDurationMs(durationMs: number): boolean {
  return isValidDurationMs(durationMs) && durationMs <= 4000;
}

function isValidDurationMs(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > 0;
}

/**
 * Infers tempo from duration/beat ratios.
 *
 * This keeps assessment tempo-independent:
 * - sung slowly but proportionally correct = good rhythm
 * - sung quickly but proportionally correct = good rhythm
 */
function inferTempoMsPerBeat(records: SungDurationRecord[]): number {
  const ratios = records
    .filter((pair) => pair.expected.expectedBeats > 0)
    .map((pair) => pair.durationMs / pair.expected.expectedBeats)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
    .sort((a, b) => a - b);

  if (ratios.length === 0) {
    return 1;
  }

  return median(ratios);
}

function median(values: number[]): number {
  const middleIndex = Math.floor(values.length / 2);

  if (values.length % 2 === 1) {
    return values[middleIndex];
  }

  return (values[middleIndex - 1] + values[middleIndex]) / 2;
}
