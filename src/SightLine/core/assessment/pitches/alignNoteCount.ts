import type { ExpectedNote } from "../intake/buildExpectedAssessment";
import { compareNoteCount } from "./compareNoteCount";
import type {
  AlignedSungNote,
  ExtraSungNote,
  NoteAlignmentResult,
  SungNote,
} from "./pitchTypes";

type AlignNoteCountInput = {
  expectedNotes: ExpectedNote[];
  sungNotes: SungNote[];
};

type AlignmentStep =
  | {
      kind: "match";
      expectedIndex: number;
      sungIndex: number;
    }
  | {
      kind: "missing";
      expectedIndex: number;
    }
  | {
      kind: "extra";
      sungIndex: number;
    };

type AlignmentCell = {
  cost: number;
  previousExpectedIndex: number;
  previousSungIndex: number;
  step: AlignmentStep | null;
};

type PartitionCell = {
  cost: number;
  previousSungCount: number;
};

type SungNoteGroup = {
  expectedOrdinal: number;
  sungStartIndex: number;
  sungEndIndex: number;
};

const MISSING_EXPECTED_NOTE_COST = 0.75;
const EXTRA_SUNG_NOTE_COST = 0.75;
const GROUPED_FRAGMENT_PENALTY = 0.2;
const LARGE_GROUP_FRAGMENT_PENALTY = 0.35;
const SHORT_GROUP_DURATION_MS = 90;
const SHORT_GROUP_PENALTY = 0.08;
const ALIGNMENT_DEBUG_STORAGE_KEY = "sightline:assessmentAlignmentDebug";

/**
 * Aligns sung notes to expected note positions.
 *
 * This file owns structural alignment only:
 * - which sung note belongs to which expected note slot?
 * - which expected notes are missing?
 * - which sung notes are extra?
 *
 * It does not decide whether an interval is correct.
 * It does not score pitch or rhythm.
 */
export function alignNoteCount(
  input: AlignNoteCountInput,
): NoteAlignmentResult {
  const noteCount = compareNoteCount(input);

  if (shouldCoalesceSungFragments(input)) {
    const result = buildCoalescedAlignmentResult(input);

    logAlignmentDebug({
      expectedNotes: input.expectedNotes,
      sungNotes: input.sungNotes,
      alignedNotes: result.alignedNotes,
      extraNotes: result.extraNotes,
    });

    return {
      ...result,
      noteCount,
    };
  }

  const steps = buildStructuralAlignmentPath(input);
  const alignedNotes = buildAlignedNotes({
    expectedNotes: input.expectedNotes,
    sungNotes: input.sungNotes,
    steps,
  });
  const extraNotes = buildExtraNotes({
    sungNotes: input.sungNotes,
    steps,
  });

  logAlignmentDebug({
    expectedNotes: input.expectedNotes,
    sungNotes: input.sungNotes,
    alignedNotes,
    extraNotes,
  });

  return {
    alignedNotes,
    extraNotes,
    noteCount,
  };
}

function shouldCoalesceSungFragments(input: AlignNoteCountInput): boolean {
  const expectedCount = input.expectedNotes.length;
  const sungCount = input.sungNotes.length;

  return expectedCount > 0 && sungCount > expectedCount;
}

function buildCoalescedAlignmentResult(input: AlignNoteCountInput): {
  alignedNotes: AlignedSungNote[];
  extraNotes: ExtraSungNote[];
} {
  const groups = partitionSungNotesIntoExpectedSlots(input);
  const alignedNotes: AlignedSungNote[] = input.expectedNotes.map(
    (expectedNote, expectedOrdinal) => {
      const group = groups.find(
        (candidate) => candidate.expectedOrdinal === expectedOrdinal,
      );
      const sungNote = group
        ? mergeSungNoteGroup({
            expectedNoteIndex: expectedNote.index,
            sungNotes: input.sungNotes.slice(
              group.sungStartIndex,
              group.sungEndIndex + 1,
            ),
          })
        : null;

      return {
        expectedNoteIndex: expectedNote.index,
        sungNote,
        alignmentStatus: sungNote ? "matched" : "missing",
      };
    },
  );

  return {
    alignedNotes,
    extraNotes: [],
  };
}

function partitionSungNotesIntoExpectedSlots(
  input: AlignNoteCountInput,
): SungNoteGroup[] {
  const expectedCount = input.expectedNotes.length;
  const sungCount = input.sungNotes.length;
  const matrix = createPartitionMatrix(expectedCount, sungCount);

  matrix[0][0] = {
    cost: 0,
    previousSungCount: -1,
  };

  for (
    let expectedOrdinal = 0;
    expectedOrdinal < expectedCount;
    expectedOrdinal += 1
  ) {
    for (
      let consumedSungCount = expectedOrdinal;
      consumedSungCount <= sungCount;
      consumedSungCount += 1
    ) {
      const current = matrix[expectedOrdinal][consumedSungCount];

      if (!Number.isFinite(current.cost)) {
        continue;
      }

      const remainingExpectedSlots = expectedCount - expectedOrdinal - 1;
      const maxNextConsumedSungCount = sungCount - remainingExpectedSlots;

      for (
        let nextConsumedSungCount = consumedSungCount + 1;
        nextConsumedSungCount <= maxNextConsumedSungCount;
        nextConsumedSungCount += 1
      ) {
        const groupStartIndex = consumedSungCount;
        const groupEndIndex = nextConsumedSungCount - 1;
        const candidateCost =
          current.cost +
          calculateSungGroupCost({
            expectedOrdinal,
            expectedNotes: input.expectedNotes,
            sungNotes: input.sungNotes,
            groupStartIndex,
            groupEndIndex,
          });
        const target = matrix[expectedOrdinal + 1][nextConsumedSungCount];

        if (candidateCost < target.cost) {
          matrix[expectedOrdinal + 1][nextConsumedSungCount] = {
            cost: candidateCost,
            previousSungCount: consumedSungCount,
          };
        }
      }
    }
  }

  return backtrackSungGroups(matrix, expectedCount, sungCount);
}

function createPartitionMatrix(
  expectedCount: number,
  sungCount: number,
): PartitionCell[][] {
  return Array.from({ length: expectedCount + 1 }, () =>
    Array.from({ length: sungCount + 1 }, () => ({
      cost: Number.POSITIVE_INFINITY,
      previousSungCount: -1,
    })),
  );
}

function calculateSungGroupCost(input: {
  expectedOrdinal: number;
  expectedNotes: ExpectedNote[];
  sungNotes: SungNote[];
  groupStartIndex: number;
  groupEndIndex: number;
}): number {
  const groupSize = input.groupEndIndex - input.groupStartIndex + 1;
  const expectedPosition = getExpectedNoteCenterPosition({
    expectedNotes: input.expectedNotes,
    expectedOrdinal: input.expectedOrdinal,
  });
  const sungGroupCenterPosition = getSungGroupCenterPosition({
    sungNotes: input.sungNotes,
    groupStartIndex: input.groupStartIndex,
    groupEndIndex: input.groupEndIndex,
  });
  const positionCost = Math.abs(expectedPosition - sungGroupCenterPosition);
  const groupingPenalty =
    Math.max(0, groupSize - 1) * GROUPED_FRAGMENT_PENALTY +
    Math.max(0, groupSize - 2) * LARGE_GROUP_FRAGMENT_PENALTY;
  const durationMs = getSungGroupDurationMs({
    sungNotes: input.sungNotes,
    groupStartIndex: input.groupStartIndex,
    groupEndIndex: input.groupEndIndex,
  });
  const shortGroupPenalty =
    durationMs > 0 && durationMs < SHORT_GROUP_DURATION_MS
      ? SHORT_GROUP_PENALTY
      : 0;

  return positionCost + groupingPenalty + shortGroupPenalty;
}

function getExpectedNoteCenterPosition(input: {
  expectedNotes: ExpectedNote[];
  expectedOrdinal: number;
}): number {
  const totalBeats = input.expectedNotes.reduce((sum, note) => {
    return sum + getExpectedNoteDurationBeats(note);
  }, 0);

  if (totalBeats <= 0) {
    return input.expectedOrdinal / Math.max(input.expectedNotes.length - 1, 1);
  }

  const precedingBeats = input.expectedNotes
    .slice(0, input.expectedOrdinal)
    .reduce((sum, note) => sum + getExpectedNoteDurationBeats(note), 0);
  const currentDurationBeats = getExpectedNoteDurationBeats(
    input.expectedNotes[input.expectedOrdinal],
  );

  return (precedingBeats + currentDurationBeats / 2) / totalBeats;
}

function getExpectedNoteDurationBeats(note: ExpectedNote | undefined): number {
  if (!note || !Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
    return 1;
  }

  return note.durationBeats;
}

function getSungGroupCenterPosition(input: {
  sungNotes: SungNote[];
  groupStartIndex: number;
  groupEndIndex: number;
}): number {
  const firstSungNote = input.sungNotes[0];
  const lastSungNote = input.sungNotes[input.sungNotes.length - 1];
  const firstGroupNote = input.sungNotes[input.groupStartIndex];
  const lastGroupNote = input.sungNotes[input.groupEndIndex];

  if (!firstSungNote || !lastSungNote || !firstGroupNote || !lastGroupNote) {
    return 0;
  }

  const phraseStartMs = firstSungNote.startMs;
  const phraseEndMs = lastSungNote.endMs;
  const phraseDurationMs = phraseEndMs - phraseStartMs;

  if (phraseDurationMs <= 0) {
    return (
      (input.groupStartIndex + input.groupEndIndex) /
      2 /
      Math.max(input.sungNotes.length - 1, 1)
    );
  }

  const groupCenterMs = (firstGroupNote.startMs + lastGroupNote.endMs) / 2;

  return (groupCenterMs - phraseStartMs) / phraseDurationMs;
}

function getSungGroupDurationMs(input: {
  sungNotes: SungNote[];
  groupStartIndex: number;
  groupEndIndex: number;
}): number {
  const first = input.sungNotes[input.groupStartIndex];
  const last = input.sungNotes[input.groupEndIndex];

  if (!first || !last) {
    return 0;
  }

  return Math.max(0, last.endMs - first.startMs);
}

function backtrackSungGroups(
  matrix: PartitionCell[][],
  expectedCount: number,
  sungCount: number,
): SungNoteGroup[] {
  const groups: SungNoteGroup[] = [];
  let currentSungCount = sungCount;

  for (
    let expectedOrdinal = expectedCount;
    expectedOrdinal > 0;
    expectedOrdinal -= 1
  ) {
    const cell = matrix[expectedOrdinal][currentSungCount];

    if (cell.previousSungCount < 0) {
      break;
    }

    groups.push({
      expectedOrdinal: expectedOrdinal - 1,
      sungStartIndex: cell.previousSungCount,
      sungEndIndex: currentSungCount - 1,
    });
    currentSungCount = cell.previousSungCount;
  }

  return groups.reverse();
}

function mergeSungNoteGroup(input: {
  expectedNoteIndex: number;
  sungNotes: SungNote[];
}): SungNote | null {
  const first = input.sungNotes[0];
  const last = input.sungNotes[input.sungNotes.length - 1];

  if (!first || !last) {
    return null;
  }

  const startMs = first.startMs;
  const endMs = last.endMs;
  const durationMs = Math.max(0, endMs - startMs);
  const representativePitchNote = getStrongestPitchFragment(input.sungNotes);
  const sourceIndices = input.sungNotes.map((note) => note.index).join("+");

  return {
    index: input.expectedNoteIndex,
    id: `aligned-sung-${input.expectedNoteIndex + 1}[${sourceIndices}]`,
    startMs,
    endMs,
    durationMs,
    pitchHz: representativePitchNote.pitchHz,
    midiFloat: representativePitchNote.midiFloat,
    confidence: representativePitchNote.confidence,
  };
}

function getStrongestPitchFragment(sungNotes: SungNote[]): SungNote {
  return sungNotes.reduce((strongest, candidate) => {
    return getPitchFragmentStrength(candidate) > getPitchFragmentStrength(strongest)
      ? candidate
      : strongest;
  });
}

function getPitchFragmentStrength(note: SungNote): number {
  return Math.max(0, note.durationMs) * Math.max(0, note.confidence);
}

function buildStructuralAlignmentPath(
  input: AlignNoteCountInput,
): AlignmentStep[] {
  const expectedCount = input.expectedNotes.length;
  const sungCount = input.sungNotes.length;
  const matrix = createAlignmentMatrix(expectedCount, sungCount);

  for (
    let expectedIndex = 0;
    expectedIndex <= expectedCount;
    expectedIndex += 1
  ) {
    for (let sungIndex = 0; sungIndex <= sungCount; sungIndex += 1) {
      const current = matrix[expectedIndex][sungIndex];

      if (!Number.isFinite(current.cost)) {
        continue;
      }

      if (expectedIndex < expectedCount && sungIndex < sungCount) {
        updateAlignmentCell({
          matrix,
          nextExpectedIndex: expectedIndex + 1,
          nextSungIndex: sungIndex + 1,
          candidate: {
            cost:
              current.cost +
              calculateStructuralMatchCost({
                expectedIndex,
                expectedCount,
                sungIndex,
                sungCount,
              }),
            previousExpectedIndex: expectedIndex,
            previousSungIndex: sungIndex,
            step: {
              kind: "match",
              expectedIndex,
              sungIndex,
            },
          },
        });
      }

      if (expectedIndex < expectedCount) {
        updateAlignmentCell({
          matrix,
          nextExpectedIndex: expectedIndex + 1,
          nextSungIndex: sungIndex,
          candidate: {
            cost: current.cost + MISSING_EXPECTED_NOTE_COST,
            previousExpectedIndex: expectedIndex,
            previousSungIndex: sungIndex,
            step: {
              kind: "missing",
              expectedIndex,
            },
          },
        });
      }

      if (sungIndex < sungCount) {
        updateAlignmentCell({
          matrix,
          nextExpectedIndex: expectedIndex,
          nextSungIndex: sungIndex + 1,
          candidate: {
            cost: current.cost + EXTRA_SUNG_NOTE_COST,
            previousExpectedIndex: expectedIndex,
            previousSungIndex: sungIndex,
            step: {
              kind: "extra",
              sungIndex,
            },
          },
        });
      }
    }
  }

  return backtrackAlignmentPath(matrix, expectedCount, sungCount);
}

function createAlignmentMatrix(
  expectedCount: number,
  sungCount: number,
): AlignmentCell[][] {
  const matrix: AlignmentCell[][] = Array.from(
    { length: expectedCount + 1 },
    () =>
      Array.from({ length: sungCount + 1 }, () => ({
        cost: Number.POSITIVE_INFINITY,
        previousExpectedIndex: -1,
        previousSungIndex: -1,
        step: null,
      })),
  );

  matrix[0][0] = {
    cost: 0,
    previousExpectedIndex: -1,
    previousSungIndex: -1,
    step: null,
  };

  return matrix;
}

function updateAlignmentCell(input: {
  matrix: AlignmentCell[][];
  nextExpectedIndex: number;
  nextSungIndex: number;
  candidate: AlignmentCell;
}): void {
  const current =
    input.matrix[input.nextExpectedIndex][input.nextSungIndex];

  if (input.candidate.cost < current.cost) {
    input.matrix[input.nextExpectedIndex][input.nextSungIndex] =
      input.candidate;
  }
}

function calculateStructuralMatchCost(input: {
  expectedIndex: number;
  expectedCount: number;
  sungIndex: number;
  sungCount: number;
}): number {
  const expectedPosition =
    input.expectedIndex / Math.max(input.expectedCount - 1, 1);
  const sungPosition = input.sungIndex / Math.max(input.sungCount - 1, 1);

  return Math.abs(expectedPosition - sungPosition);
}

function backtrackAlignmentPath(
  matrix: AlignmentCell[][],
  expectedCount: number,
  sungCount: number,
): AlignmentStep[] {
  const steps: AlignmentStep[] = [];
  let expectedIndex = expectedCount;
  let sungIndex = sungCount;

  while (expectedIndex > 0 || sungIndex > 0) {
    const cell = matrix[expectedIndex][sungIndex];

    if (!cell.step) {
      break;
    }

    steps.push(cell.step);
    expectedIndex = cell.previousExpectedIndex;
    sungIndex = cell.previousSungIndex;
  }

  return steps.reverse();
}

function buildAlignedNotes(input: {
  expectedNotes: ExpectedNote[];
  sungNotes: SungNote[];
  steps: AlignmentStep[];
}): AlignedSungNote[] {
  const matchesByExpectedIndex = new Map<number, SungNote | null>();

  for (const step of input.steps) {
    if (step.kind === "match") {
      matchesByExpectedIndex.set(
        step.expectedIndex,
        input.sungNotes[step.sungIndex] ?? null,
      );
    }

    if (step.kind === "missing") {
      matchesByExpectedIndex.set(step.expectedIndex, null);
    }
  }

  return input.expectedNotes.map((expectedNote, expectedOrdinal) => {
    const sungNote = matchesByExpectedIndex.get(expectedOrdinal) ?? null;

    return {
      expectedNoteIndex: expectedNote.index,
      sungNote,
      alignmentStatus: sungNote ? "matched" : "missing",
    };
  });
}

function buildExtraNotes(input: {
  sungNotes: SungNote[];
  steps: AlignmentStep[];
}): ExtraSungNote[] {
  return input.steps
    .filter((step): step is Extract<AlignmentStep, { kind: "extra" }> => {
      return step.kind === "extra";
    })
    .map((step) => ({
      sungNote: input.sungNotes[step.sungIndex],
      reason: "extra",
    }));
}

function logAlignmentDebug(input: {
  expectedNotes: ExpectedNote[];
  sungNotes: SungNote[];
  alignedNotes: AlignedSungNote[];
  extraNotes: ExtraSungNote[];
}): void {
  if (!isAlignmentDebugEnabled()) {
    return;
  }

  const missingExpectedSlots = input.alignedNotes
    .filter((note) => note.alignmentStatus === "missing")
    .map((note) => note.expectedNoteIndex);

  console.groupCollapsed("SightLine structural note alignment");
  console.debug("expected count", input.expectedNotes.length);
  console.debug("sung count", input.sungNotes.length);
  console.table(
    input.alignedNotes.map((note) => ({
      expectedNoteIndex: note.expectedNoteIndex,
      sungNoteIndex: note.sungNote?.index ?? null,
      sungNoteId: note.sungNote?.id ?? null,
      alignmentStatus: note.alignmentStatus,
    })),
  );
  console.debug("missing expected slots", missingExpectedSlots);
  console.table(
    input.extraNotes.map((extra) => ({
      sungNoteIndex: extra.sungNote.index,
      sungNoteId: extra.sungNote.id,
      reason: extra.reason,
    })),
  );
  console.groupEnd();
}

function isAlignmentDebugEnabled(): boolean {
  const globalWithDebugFlag = globalThis as typeof globalThis & {
    __SIGHTLINE_ASSESSMENT_ALIGNMENT_DEBUG__?: boolean;
  };

  if (globalWithDebugFlag.__SIGHTLINE_ASSESSMENT_ALIGNMENT_DEBUG__ === true) {
    return true;
  }

  try {
    return (
      globalThis.localStorage?.getItem(ALIGNMENT_DEBUG_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}
