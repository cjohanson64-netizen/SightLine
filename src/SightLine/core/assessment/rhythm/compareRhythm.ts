import type {
  ExpectedRhythmUnit,
  RhythmComparisonOptions,
  RhythmResult,
  RhythmStatus,
  SungRhythmUnit,
} from "./rhythmTypes";

const DEFAULT_MATCH_TOLERANCE = 0.2;
const DEFAULT_CLOSE_TOLERANCE = 0.4;
const DEFAULT_FINAL_NOTE_MATCH_TOLERANCE = 0.25;
const DEFAULT_FINAL_NOTE_CLOSE_TOLERANCE = 0.5;
const ADJACENT_BOUNDARY_MATCH_TOLERANCE = 0.2;
const ADJACENT_BOUNDARY_CLOSE_TOLERANCE = 0.4;

type CompareRhythmInput = {
  expectedRhythm: ExpectedRhythmUnit[];
  sungRhythm: SungRhythmUnit[];
  options?: RhythmComparisonOptions;
};

/**
 * Answers assessment question #4:
 * Did their rhythm proportions match?
 *
 * This file owns rhythm comparison only.
 *
 * It does not analyze pitch.
 * It does not analyze stability.
 * It does not calculate mastery.
 * It does not assign UI colors directly.
 */
export function compareRhythm(input: CompareRhythmInput): RhythmResult[] {
  const results = input.expectedRhythm.map((expectedUnit, index) => {
    const sungUnit = findMatchingSungRhythmUnit(input.sungRhythm, expectedUnit);

    if (!sungUnit) {
      return buildMissingRhythmResult(expectedUnit);
    }

    const proportionalError = calculateProportionalError({
      expectedBeats: expectedUnit.expectedBeats,
      sungBeats: sungUnit.sungBeats,
    });

    const isFinalNote = index === input.expectedRhythm.length - 1;

    const status = getRhythmStatus({
      proportionalError,
      isFinalNote,
      options: input.options,
    });

    return {
      noteIndex: expectedUnit.noteIndex,
      expectedBeats: expectedUnit.expectedBeats,
      sungBeats: sungUnit.sungBeats,
      durationMs: sungUnit.durationMs,
      proportionalError,
      status,
    };
  });

  return repairAdjacentBoundaryShifts(results);
}

function findMatchingSungRhythmUnit(
  sungRhythm: SungRhythmUnit[],
  expectedUnit: ExpectedRhythmUnit,
): SungRhythmUnit | undefined {
  return sungRhythm.find(
    (sungUnit) => sungUnit.noteIndex === expectedUnit.noteIndex,
  );
}

function buildMissingRhythmResult(
  expectedUnit: ExpectedRhythmUnit,
): RhythmResult {
  return {
    noteIndex: expectedUnit.noteIndex,
    expectedBeats: expectedUnit.expectedBeats,
    sungBeats: null,
    durationMs: null,
    proportionalError: null,
    status: "missing",
  };
}

function calculateProportionalError(input: {
  expectedBeats: number;
  sungBeats: number;
}): number {
  if (input.expectedBeats <= 0) {
    return 0;
  }

  return Math.abs(input.sungBeats - input.expectedBeats) / input.expectedBeats;
}

function getRhythmStatus(input: {
  proportionalError: number;
  isFinalNote: boolean;
  options?: RhythmComparisonOptions;
}): RhythmStatus {
  const matchTolerance = input.isFinalNote
    ? input.options?.finalNoteMatchTolerance ?? DEFAULT_FINAL_NOTE_MATCH_TOLERANCE
    : input.options?.matchTolerance ?? DEFAULT_MATCH_TOLERANCE;

  const closeTolerance = input.isFinalNote
    ? input.options?.finalNoteCloseTolerance ?? DEFAULT_FINAL_NOTE_CLOSE_TOLERANCE
    : input.options?.closeTolerance ?? DEFAULT_CLOSE_TOLERANCE;

  if (input.proportionalError <= matchTolerance) {
    return "match";
  }

  if (input.proportionalError <= closeTolerance) {
    return "close";
  }

  return "mismatch";
}

function repairAdjacentBoundaryShifts(results: RhythmResult[]): RhythmResult[] {
  const repairedResults = results.map((result) => ({ ...result }));

  for (let index = 0; index < repairedResults.length - 1; index += 1) {
    const first = repairedResults[index];
    const second = repairedResults[index + 1];

    if (!isRepairableAdjacentBoundaryPair(first, second)) {
      continue;
    }

    const firstSungBeats = first.sungBeats;
    const secondSungBeats = second.sungBeats;

    if (firstSungBeats === null || secondSungBeats === null) {
      continue;
    }

    const combinedError = calculateProportionalError({
      expectedBeats: first.expectedBeats + second.expectedBeats,
      sungBeats: firstSungBeats + secondSungBeats,
    });

    const repairedStatus = getAdjacentBoundaryRepairStatus(combinedError);

    if (!repairedStatus) {
      continue;
    }

    repairedResults[index] = applyAdjacentBoundaryRepair(first, repairedStatus);
    repairedResults[index + 1] = applyAdjacentBoundaryRepair(
      second,
      repairedStatus,
    );
  }

  return repairedResults;
}

function isRepairableAdjacentBoundaryPair(
  first: RhythmResult,
  second: RhythmResult,
): boolean {
  return (
    first.status !== "match" &&
    second.status !== "match" &&
    (first.status === "mismatch" || second.status === "mismatch") &&
    first.expectedBeats > 0 &&
    second.expectedBeats > 0 &&
    first.sungBeats !== null &&
    second.sungBeats !== null
  );
}

function getAdjacentBoundaryRepairStatus(
  combinedError: number,
): RhythmStatus | null {
  if (combinedError <= ADJACENT_BOUNDARY_MATCH_TOLERANCE) {
    return "close";
  }

  if (combinedError <= ADJACENT_BOUNDARY_CLOSE_TOLERANCE) {
    return "close";
  }

  return null;
}

function applyAdjacentBoundaryRepair(
  result: RhythmResult,
  repairStatus: RhythmStatus,
): RhythmResult {
  return {
    ...result,
    status: getBetterRhythmStatus(result.status, repairStatus),
    repairReason: "adjacentBoundaryShift",
  };
}

function getBetterRhythmStatus(
  currentStatus: RhythmStatus,
  repairedStatus: RhythmStatus,
): RhythmStatus {
  const statusCredit: Record<RhythmStatus, number> = {
    match: 3,
    close: 2,
    mismatch: 1,
    missing: 0,
  };

  return statusCredit[repairedStatus] > statusCredit[currentStatus]
    ? repairedStatus
    : currentStatus;
}
