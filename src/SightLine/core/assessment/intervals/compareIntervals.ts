import type {
  ExpectedInterval,
  IntervalComparisonOptions,
  IntervalResult,
  IntervalStatus,
  SungInterval,
} from "./intervalTypes";

const DEFAULT_CORRECT_TOLERANCE_SEMITONES = 0.35;
const DEFAULT_CLOSE_TOLERANCE_SEMITONES = 0.75;
const REPEATED_NOTE_CLOSE_TOLERANCE_SEMITONES = 1;
const REPEATED_NOTE_PARTIAL_TOLERANCE_SEMITONES = 1.5;
const REPEATED_BOUNDARY_SHIFT_TOLERANCE_SEMITONES = 1;
const REPEATED_BOUNDARY_MAX_SHIFT_SEMITONES = 3.5;
const MIN_NONZERO_INTERVAL_SEMITONES = 0.5;

type CompareIntervalsInput = {
  expectedIntervals: ExpectedInterval[];
  sungIntervals: SungInterval[];
  options?: IntervalComparisonOptions;
};

/**
 * Answers assessment question #2:
 * Did their intervals match the written intervals?
 *
 * This file owns interval comparison only.
 *
 * It does not extract pitch.
 * It does not analyze stability.
 * It does not analyze rhythm.
 * It does not calculate the final mastery score.
 */
export function compareIntervals(
  input: CompareIntervalsInput,
): IntervalResult[] {
  const correctToleranceSemitones =
    input.options?.correctToleranceSemitones ??
    DEFAULT_CORRECT_TOLERANCE_SEMITONES;

  const closeToleranceSemitones =
    input.options?.closeToleranceSemitones ??
    DEFAULT_CLOSE_TOLERANCE_SEMITONES;

  const results = input.expectedIntervals.map((expectedInterval) => {
    const sungInterval = findMatchingSungInterval(
      input.sungIntervals,
      expectedInterval,
    );

    if (!sungInterval) {
      return buildMissingIntervalResult(expectedInterval);
    }

    const intervalDifference = Math.abs(
      expectedInterval.expectedSemitones -
        sungInterval.normalizedSungSemitones,
    );

    const status = getIntervalStatus({
      expectedSemitones: expectedInterval.expectedSemitones,
      normalizedSungSemitones: sungInterval.normalizedSungSemitones,
      intervalDifference,
      correctToleranceSemitones,
      closeToleranceSemitones,
    });

    return {
      index: expectedInterval.index,
      fromNoteIndex: expectedInterval.fromNoteIndex,
      toNoteIndex: expectedInterval.toNoteIndex,
      expectedSemitones: expectedInterval.expectedSemitones,
      sungSemitones: sungInterval.sungSemitones,
      normalizedSungSemitones: sungInterval.normalizedSungSemitones,
      intervalDifference,
      status,
    };
  });

  return repairRepeatedNoteBoundaryShifts({
    results,
    correctToleranceSemitones,
  });
}

function findMatchingSungInterval(
  sungIntervals: SungInterval[],
  expectedInterval: ExpectedInterval,
): SungInterval | undefined {
  return sungIntervals.find(
    (sungInterval) =>
      sungInterval.fromNoteIndex === expectedInterval.fromNoteIndex &&
      sungInterval.toNoteIndex === expectedInterval.toNoteIndex,
  );
}

function buildMissingIntervalResult(
  expectedInterval: ExpectedInterval,
): IntervalResult {
  return {
    index: expectedInterval.index,
    fromNoteIndex: expectedInterval.fromNoteIndex,
    toNoteIndex: expectedInterval.toNoteIndex,
    expectedSemitones: expectedInterval.expectedSemitones,
    sungSemitones: null,
    normalizedSungSemitones: null,
    intervalDifference: null,
    status: "missing",
  };
}

function getIntervalStatus(input: {
  expectedSemitones: number;
  normalizedSungSemitones: number;
  intervalDifference: number;
  correctToleranceSemitones: number;
  closeToleranceSemitones: number;
}): IntervalStatus {
  if (input.expectedSemitones === 0) {
    return getRepeatedNoteIntervalStatus({
      normalizedSungSemitones: input.normalizedSungSemitones,
      correctToleranceSemitones: input.correctToleranceSemitones,
    });
  }

  if (input.intervalDifference <= input.correctToleranceSemitones) {
    return "correct";
  }

  if (input.intervalDifference <= input.closeToleranceSemitones) {
    return "close";
  }

  if (
    hasSameDirection(input.expectedSemitones, input.normalizedSungSemitones)
  ) {
    return "partial";
  }

  return "incorrect";
}

function getRepeatedNoteIntervalStatus(input: {
  normalizedSungSemitones: number;
  correctToleranceSemitones: number;
}): IntervalStatus {
  const sungDistanceFromRepeat = Math.abs(input.normalizedSungSemitones);

  if (sungDistanceFromRepeat <= input.correctToleranceSemitones) {
    return "correct";
  }

  if (sungDistanceFromRepeat <= REPEATED_NOTE_CLOSE_TOLERANCE_SEMITONES) {
    return "close";
  }

  if (sungDistanceFromRepeat <= REPEATED_NOTE_PARTIAL_TOLERANCE_SEMITONES) {
    return "partial";
  }

  return "incorrect";
}

function repairRepeatedNoteBoundaryShifts(input: {
  results: IntervalResult[];
  correctToleranceSemitones: number;
}): IntervalResult[] {
  const repairedResults = input.results.map((result) => ({ ...result }));

  for (let index = 0; index < repairedResults.length - 1; index += 1) {
    const first = repairedResults[index];
    const second = repairedResults[index + 1];

    if (isRepairableRepeatedBoundaryShift(first, second)) {
      const repairStatus = getRepeatedBoundaryRepairStatus({
        first,
        second,
        correctToleranceSemitones: input.correctToleranceSemitones,
      });

      repairedResults[index] = applyRepeatedBoundaryRepair(first, repairStatus);
      repairedResults[index + 1] = applyRepeatedBoundaryRepair(
        second,
        repairStatus,
      );
    }
  }

  return repairedResults;
}

function isRepairableRepeatedBoundaryShift(
  first: IntervalResult,
  second: IntervalResult,
): boolean {
  if (
    first.normalizedSungSemitones === null ||
    second.normalizedSungSemitones === null
  ) {
    return false;
  }

  return (
    isExpectedRepeatThenMoveShift(first, second) ||
    isExpectedMoveThenRepeatShift(first, second)
  );
}

function isExpectedRepeatThenMoveShift(
  repeatedInterval: IntervalResult,
  movingInterval: IntervalResult,
): boolean {
  return (
    repeatedInterval.expectedSemitones === 0 &&
    isRepairableExpectedMove(movingInterval.expectedSemitones) &&
    sungLooksLikeExpectedMove({
      sungSemitones: repeatedInterval.normalizedSungSemitones,
      expectedSemitones: movingInterval.expectedSemitones,
    }) &&
    sungLooksLikeRepeat(movingInterval.normalizedSungSemitones)
  );
}

function isExpectedMoveThenRepeatShift(
  movingInterval: IntervalResult,
  repeatedInterval: IntervalResult,
): boolean {
  return (
    isRepairableExpectedMove(movingInterval.expectedSemitones) &&
    repeatedInterval.expectedSemitones === 0 &&
    sungLooksLikeRepeat(movingInterval.normalizedSungSemitones) &&
    sungLooksLikeExpectedMove({
      sungSemitones: repeatedInterval.normalizedSungSemitones,
      expectedSemitones: movingInterval.expectedSemitones,
    })
  );
}

function isRepairableExpectedMove(expectedSemitones: number): boolean {
  const size = Math.abs(expectedSemitones);

  return (
    size >= MIN_NONZERO_INTERVAL_SEMITONES &&
    size <= REPEATED_BOUNDARY_MAX_SHIFT_SEMITONES
  );
}

function sungLooksLikeExpectedMove(input: {
  sungSemitones: number | null;
  expectedSemitones: number;
}): boolean {
  if (input.sungSemitones === null) {
    return false;
  }

  return (
    Math.abs(input.sungSemitones - input.expectedSemitones) <=
    REPEATED_BOUNDARY_SHIFT_TOLERANCE_SEMITONES
  );
}

function sungLooksLikeRepeat(sungSemitones: number | null): boolean {
  return (
    sungSemitones !== null &&
    Math.abs(sungSemitones) <= REPEATED_BOUNDARY_SHIFT_TOLERANCE_SEMITONES
  );
}

function getRepeatedBoundaryRepairStatus(input: {
  first: IntervalResult;
  second: IntervalResult;
  correctToleranceSemitones: number;
}): IntervalStatus {
  const repeatedInterval =
    input.first.expectedSemitones === 0 ? input.first : input.second;
  const movingInterval =
    input.first.expectedSemitones === 0 ? input.second : input.first;
  const sungRepeat =
    input.first.expectedSemitones === 0
      ? input.second.normalizedSungSemitones
      : input.first.normalizedSungSemitones;
  const sungMove =
    input.first.expectedSemitones === 0
      ? input.first.normalizedSungSemitones
      : input.second.normalizedSungSemitones;

  if (sungRepeat === null || sungMove === null) {
    return "close";
  }

  const repeatIsCorrect =
    Math.abs(sungRepeat) <= input.correctToleranceSemitones;
  const moveIsCorrect =
    Math.abs(sungMove - movingInterval.expectedSemitones) <=
    input.correctToleranceSemitones;

  if (
    repeatedInterval.expectedSemitones === 0 &&
    repeatIsCorrect &&
    moveIsCorrect
  ) {
    return "correct";
  }

  return "close";
}

function applyRepeatedBoundaryRepair(
  result: IntervalResult,
  repairStatus: IntervalStatus,
): IntervalResult {
  return {
    ...result,
    status: getBetterIntervalStatus(result.status, repairStatus),
    repairReason: "repeatedNoteBoundaryShift",
  };
}

function getBetterIntervalStatus(
  currentStatus: IntervalStatus,
  repairedStatus: IntervalStatus,
): IntervalStatus {
  const statusCredit: Record<IntervalStatus, number> = {
    correct: 4,
    close: 3,
    partial: 2,
    incorrect: 1,
    missing: 0,
  };

  return statusCredit[repairedStatus] > statusCredit[currentStatus]
    ? repairedStatus
    : currentStatus;
}

function hasSameDirection(
  expectedSemitones: number,
  sungSemitones: number,
): boolean {
  if (expectedSemitones === 0 && Math.abs(sungSemitones) <= 0.75) {
    return true;
  }

  if (expectedSemitones > 0 && sungSemitones > 0) {
    return true;
  }

  if (expectedSemitones < 0 && sungSemitones < 0) {
    return true;
  }

  return false;
}
