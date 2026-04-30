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

type CandidateSnap = {
  snappedMidiFloat: number;
  snappedDegree: number;
};

type ExpectedNeighborContext = {
  previousExpected: NormalizedExpectedNote | null;
  expectedNote: NormalizedExpectedNote;
  nextExpected: NormalizedExpectedNote | null;
};

// Pitch-class helpers
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

// Scale-degree helpers
function getScaleDegreeFromRelativePitchClass(
  relativePitchClass: number,
): number {
  return MAJOR_SCALE_DEGREE_MAP[relativePitchClass] ?? -1;
}

function getScaleDegreeFromMidiFloat(
  midiFloat: number,
  tonicPitchClass: number,
): number {
  const relativePitchClass = getRelativePitchClassFromMidiFloat(
    midiFloat,
    tonicPitchClass,
  );

  return getScaleDegreeFromRelativePitchClass(relativePitchClass);
}

// Snapping helpers
function buildNearbyCandidateMidis(expectedMidiFloat: number): number[] {
  return [
    expectedMidiFloat - 2,
    expectedMidiFloat - 1,
    expectedMidiFloat,
    expectedMidiFloat + 1,
    expectedMidiFloat + 2,
  ];
}

function getExpectedNeighborContext(
  expectedNotes: NormalizedExpectedNote[],
  index: number,
): ExpectedNeighborContext {
  return {
    previousExpected: index > 0 ? expectedNotes[index - 1] : null,
    expectedNote: expectedNotes[index],
    nextExpected:
      index < expectedNotes.length - 1 ? expectedNotes[index + 1] : null,
  };
}

function getPathPenalty(params: {
  candidateMidi: number;
  previousExpected: NormalizedExpectedNote | null;
  expectedNote: NormalizedExpectedNote;
  nextExpected: NormalizedExpectedNote | null;
}): number {
  const { candidateMidi, previousExpected, expectedNote, nextExpected } =
    params;
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
    const expectedStepToNext = nextExpected.midiFloat - expectedNote.midiFloat;
    const candidateStepToNext = nextExpected.midiFloat - candidateMidi;

    pathPenalty += Math.abs(candidateStepToNext - expectedStepToNext);
  }

  return pathPenalty;
}

function getTiToDoProtectionPenalty(params: {
  sungMidiFloat: number;
  candidateMidi: number;
  candidateDegree: number;
  expectedNote: NormalizedExpectedNote;
  nextExpected: NormalizedExpectedNote | null;
}): number {
  const {
    sungMidiFloat,
    candidateMidi,
    candidateDegree,
    expectedNote,
    nextExpected,
  } = params;

  if (
    expectedNote.scaleDegree !== 6 ||
    !nextExpected ||
    nextExpected.scaleDegree !== 0
  ) {
    return 0;
  }

  const isCandidateDo =
    candidateDegree === 0 && candidateMidi >= expectedNote.midiFloat;
  const isCandidateTi = candidateDegree === 6;

  if (isCandidateDo && sungMidiFloat < expectedNote.midiFloat + 0.75) {
    return 1.5;
  }

  if (isCandidateTi && sungMidiFloat < expectedNote.midiFloat + 0.75) {
    return -0.5;
  }

  return 0;
}

function scoreCandidateMidi(params: {
  sungMidiFloat: number;
  candidateMidi: number;
  candidateDegree: number;
  previousExpected: NormalizedExpectedNote | null;
  expectedNote: NormalizedExpectedNote;
  nextExpected: NormalizedExpectedNote | null;
}): number {
  const {
    sungMidiFloat,
    candidateMidi,
    candidateDegree,
    previousExpected,
    expectedNote,
    nextExpected,
  } = params;

  const pitchDistance = Math.abs(sungMidiFloat - candidateMidi);
  const pathPenalty = getPathPenalty({
    candidateMidi,
    previousExpected,
    expectedNote,
    nextExpected,
  });

  const tiProtectionPenalty = getTiToDoProtectionPenalty({
    sungMidiFloat,
    candidateMidi,
    candidateDegree,
    expectedNote,
    nextExpected,
  });

  return pitchDistance + pathPenalty * 0.75 + tiProtectionPenalty;
}

function findBestCandidateSnap(params: {
  sungMidiFloat: number;
  tonicPitchClass: number;
  previousExpected: NormalizedExpectedNote | null;
  expectedNote: NormalizedExpectedNote;
  nextExpected: NormalizedExpectedNote | null;
}): CandidateSnap {
  const {
    sungMidiFloat,
    tonicPitchClass,
    previousExpected,
    expectedNote,
    nextExpected,
  } = params;

  const candidateMidis = buildNearbyCandidateMidis(expectedNote.midiFloat);

  let bestMidi = expectedNote.midiFloat;
  let bestDegree = expectedNote.scaleDegree;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateMidi of candidateMidis) {
    const candidateDegree = getScaleDegreeFromMidiFloat(
      candidateMidi,
      tonicPitchClass,
    );

    if (candidateDegree === -1) {
      continue;
    }

    const score = scoreCandidateMidi({
      sungMidiFloat,
      candidateMidi,
      candidateDegree,
      previousExpected,
      expectedNote,
      nextExpected,
    });

    if (score < bestScore) {
      bestScore = score;
      bestMidi = candidateMidi;
      bestDegree = candidateDegree;
    }
  }

  return {
    snappedMidiFloat: bestMidi,
    snappedDegree: bestDegree,
  };
}

function shouldRejectSnapForWrongFinalOctave(params: {
  sungMidiFloat: number;
  expectedNote: NormalizedExpectedNote;
  bestSnap: CandidateSnap;
  index: number;
  expectedNotes: NormalizedExpectedNote[];
}): boolean {
  const { sungMidiFloat, expectedNote, bestSnap, index, expectedNotes } =
    params;

  const isFinalExpectedNote = index === expectedNotes.length - 1;
  const expectedOctaveDistance = Math.abs(
    sungMidiFloat - expectedNote.midiFloat,
  );

  return (
    isFinalExpectedNote &&
    bestSnap.snappedDegree === expectedNote.scaleDegree &&
    expectedOctaveDistance > 6
  );
}

function shouldAcceptSnap(params: {
  sungMidiFloat: number;
  bestSnap: CandidateSnap;
  shouldRejectForWrongOctave: boolean;
}): boolean {
  const { sungMidiFloat, bestSnap, shouldRejectForWrongOctave } = params;
  const snapDistance = Math.abs(sungMidiFloat - bestSnap.snappedMidiFloat);

  return snapDistance <= 1.5 && !shouldRejectForWrongOctave;
}

function getFallbackActualSnap(
  note: SungNoteEvent,
  tonic: DetectedTonic,
): CandidateSnap {
  return {
    snappedMidiFloat: note.midiFloat,
    snappedDegree: getScaleDegreeFromMidiFloat(
      note.midiFloat,
      tonic.tonicPitchClass,
    ),
  };
}

function getActualSnapForExpectedContext(params: {
  note: SungNoteEvent;
  tonic: DetectedTonic;
  expectedNotes: NormalizedExpectedNote[];
  index: number;
}): CandidateSnap {
  const { note, tonic, expectedNotes, index } = params;
  const expectedNote = expectedNotes[index];

  if (!expectedNote) {
    return getFallbackActualSnap(note, tonic);
  }

  const { previousExpected, nextExpected } = getExpectedNeighborContext(
    expectedNotes,
    index,
  );

  const bestSnap = findBestCandidateSnap({
    sungMidiFloat: note.midiFloat,
    tonicPitchClass: tonic.tonicPitchClass,
    previousExpected,
    expectedNote,
    nextExpected,
  });

  const shouldRejectForWrongOctave = shouldRejectSnapForWrongFinalOctave({
    sungMidiFloat: note.midiFloat,
    expectedNote,
    bestSnap,
    index,
    expectedNotes,
  });

  if (
    shouldAcceptSnap({
      sungMidiFloat: note.midiFloat,
      bestSnap,
      shouldRejectForWrongOctave,
    })
  ) {
    return bestSnap;
  }

  return getFallbackActualSnap(note, tonic);
}

// Expected note normalization
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

// Actual note normalization
function buildActualNotes(
  actualNotes: SungNoteEvent[],
  tonic: DetectedTonic,
  expectedNotes: NormalizedExpectedNote[],
): NormalizedActualNote[] {
  return actualNotes.map((note, index) => {
    const snap = getActualSnapForExpectedContext({
      note,
      tonic,
      expectedNotes,
      index,
    });

    return {
      id: note.id,
      index,
      sourceEventId: note.id,
      midiFloat: note.midiFloat,
      snappedMidiFloat: snap.snappedMidiFloat,
      scaleDegree: snap.snappedDegree,
      startMs: note.startMs,
      endMs: note.endMs,
      durationMs: note.durationMs,
      confidence: note.confidence,
    };
  });
}

function collapseRepeatedScaleDegreeFragments(
  notes: NormalizedActualNote[],
): NormalizedActualNote[] {
  if (notes.length < 2) {
    return notes;
  }

  const collapsed: NormalizedActualNote[] = [notes[0]];

  for (let index = 1; index < notes.length; index += 1) {
    const current = notes[index];
    const previous = collapsed[collapsed.length - 1];

    const sameScaleDegree = current.scaleDegree === previous.scaleDegree;

    const currentIsVeryShort = current.durationMs <= 220;
    const previousIsLonger =
      previous.durationMs >= current.durationMs * 2;
    const currentHasWeakConfidence =
      current.confidence <= previous.confidence;

    const pitchClose =
      Math.abs(current.snappedMidiFloat - previous.snappedMidiFloat) <= 1;

    if (
      sameScaleDegree &&
      currentIsVeryShort &&
      previousIsLonger &&
      currentHasWeakConfidence &&
      pitchClose
    ) {
      collapsed[collapsed.length - 1] = {
        ...previous,
        endMs: current.endMs,
        durationMs: current.endMs - previous.startMs,
      };

      continue;
    }

    collapsed.push(current);
  }

  return collapsed;
}

// Interval building
function getAnalysisPitch(note: {
  midiFloat: number;
  snappedMidiFloat?: number;
}): number {
  return note.snappedMidiFloat !== undefined
    ? note.snappedMidiFloat
    : note.midiFloat;
}

function buildIntervals<
  T extends { id: string; midiFloat: number; snappedMidiFloat?: number },
>(notes: T[]): IntervalStep[] {
  const intervals: IntervalStep[] = [];

  for (let index = 1; index < notes.length; index += 1) {
    const previous = notes[index - 1];
    const current = notes[index];

    const previousPitch = getAnalysisPitch(previous);
    const currentPitch = getAnalysisPitch(current);

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

// Degree building
function buildDegrees<T extends { scaleDegree: number }>(notes: T[]): number[] {
  return notes.map((note) => note.scaleDegree);
}

// Alignment building
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
    // Phase 1: Normalize expected written notes into scale-aware notes.
    const expectedNotes = buildExpectedNotes(input.expectedMelody, input.tonic);

    // Phase 2: Normalize actual sung events using expected melodic context.
    const rawActualNotes = buildActualNotes(
      input.actualNotes,
      input.tonic,
      expectedNotes,
    );
    const actualNotes = collapseRepeatedScaleDegreeFragments(rawActualNotes);

    // Phase 3: Build interval views from normalized notes.
    const expectedIntervals = buildIntervals(expectedNotes);
    const actualIntervals = buildIntervals(actualNotes);

    // Phase 4: Build degree views for debug and melodic comparison.
    const expectedDegrees = buildDegrees(expectedNotes);
    const actualDegrees = buildDegrees(actualNotes);

    // Phase 5: Build simple position-based alignment pairs.
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
