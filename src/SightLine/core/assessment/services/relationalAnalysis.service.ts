import type {
  IntervalStep,
  RelationalAnalysisInput,
  RelationalAnalysisOutput,
  RelationalFinding,
} from "../types";
import type { RelationalAnalysisService } from "../types/services";

const EXACT_MATCH_TOLERANCE = 0.35;
const CLOSE_MATCH_TOLERANCE = 0.8;
const INTERVAL_TOLERANCE = 0.5;

type AnalysisCounters = {
  exactMatchCount: number;
  closeMatchCount: number;
  pitchMismatchCount: number;
  insertionCount: number;
  omissionCount: number;
  intervalMismatchCount: number;
};

type MatchedPairContext = {
  expectedNote: RelationalAnalysisInput["expectedNotes"][number];
  actualNote: RelationalAnalysisInput["actualNotes"][number];
};

type MatchedAlignmentPair =
  RelationalAnalysisInput["alignedPairs"][number] & {
    kind: "matched";
    expectedNoteId: string;
    actualNoteId: string;
  };

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildFinding(
  id: string,
  type: RelationalFinding["type"],
  message: string,
  confidence: number,
  alignmentRange: [number, number],
): RelationalFinding {
  return {
    id,
    type,
    message,
    confidence,
    alignmentRange,
  };
}

function nextFindingId(findings: RelationalFinding[]): string {
  return `f${findings.length + 1}`;
}

function findIntervalForNote(
  intervals: IntervalStep[],
  fromId: string,
  toId: string,
): IntervalStep | undefined {
  return intervals.find(
    (interval) => interval.fromId === fromId && interval.toId === toId,
  );
}

function isInsertionPair(
  pair: RelationalAnalysisInput["alignedPairs"][number],
): boolean {
  return pair.kind === "insertion";
}

function isOmissionPair(
  pair: RelationalAnalysisInput["alignedPairs"][number],
): boolean {
  return pair.kind === "omission";
}

function isMatchedPair(
  pair: RelationalAnalysisInput["alignedPairs"][number],
): pair is MatchedAlignmentPair {
  return (
    pair.kind === "matched" &&
    pair.expectedNoteId !== null &&
    pair.actualNoteId !== null
  );
}

function getMatchedPairContext(
  input: RelationalAnalysisInput,
  pair: RelationalAnalysisInput["alignedPairs"][number],
): MatchedPairContext | null {
  if (!isMatchedPair(pair)) {
    return null;
  }

  const expectedNote = input.expectedNotes.find(
    (note) => note.id === pair.expectedNoteId,
  );

  const actualNote = input.actualNotes.find(
    (note) => note.id === pair.actualNoteId,
  );

  if (!expectedNote || !actualNote) {
    return null;
  }

  return {
    expectedNote,
    actualNote,
  };
}

function getReferenceOffset(input: RelationalAnalysisInput): number {
  for (const pair of input.alignedPairs) {
    const context = getMatchedPairContext(input, pair);

    if (!context) {
      continue;
    }

    return (
      context.actualNote.midiFloat -
      context.expectedNote.midiFloat
    );
  }

  return 0;
}

function buildInsertionFinding(
  findings: RelationalFinding[],
  index: number,
): RelationalFinding {
  return buildFinding(
    nextFindingId(findings),
    "insertion",
    `Extra sung note detected at position ${index + 1}.`,
    0.85,
    [index, index],
  );
}

function buildOmissionFinding(
  findings: RelationalFinding[],
  index: number,
): RelationalFinding {
  return buildFinding(
    nextFindingId(findings),
    "omission",
    `Expected note missing at position ${index + 1}.`,
    0.85,
    [index, index],
  );
}

function buildExactMatchFinding(
  findings: RelationalFinding[],
  index: number,
  pitchDelta: number,
): RelationalFinding {
  return buildFinding(
    nextFindingId(findings),
    "exact_match",
    `Matched expected note at position ${index + 1} after offset normalization (Δ ${pitchDelta.toFixed(
      2,
    )} semitones).`,
    0.95,
    [index, index],
  );
}

function buildCloseMatchFinding(
  findings: RelationalFinding[],
  index: number,
  pitchDelta: number,
): RelationalFinding {
  return buildFinding(
    nextFindingId(findings),
    "wrong_interval",
    `Close pitch at position ${index + 1} after offset normalization, but offset by ${pitchDelta.toFixed(
      2,
    )} semitones.`,
    0.88,
    [index, index],
  );
}

function buildPitchMismatchFinding(
  findings: RelationalFinding[],
  index: number,
  pitchDelta: number,
): RelationalFinding {
  const direction = pitchDelta > 0 ? "sharp" : "flat";

  return buildFinding(
    nextFindingId(findings),
    "wrong_interval",
    `Pitch mismatch at position ${index + 1} after offset normalization: ${direction} by ${Math.abs(
      pitchDelta,
    ).toFixed(2)} semitones.`,
    0.8,
    [index, index],
  );
}

function analyzePitchMatch(params: {
  findings: RelationalFinding[];
  counters: AnalysisCounters;
  index: number;
  expectedMidiFloat: number;
  actualMidiFloat: number;
  referenceOffset: number;
}): void {
  const {
    findings,
    counters,
    index,
    expectedMidiFloat,
    actualMidiFloat,
    referenceOffset,
  } = params;

  const normalizedActualMidiFloat =
    actualMidiFloat - referenceOffset;

  const pitchDelta =
    normalizedActualMidiFloat - expectedMidiFloat;

  const absPitchDelta = Math.abs(pitchDelta);

  if (absPitchDelta <= EXACT_MATCH_TOLERANCE) {
    counters.exactMatchCount += 1;

    findings.push(
      buildExactMatchFinding(findings, index, pitchDelta),
    );

    return;
  }

  if (absPitchDelta <= CLOSE_MATCH_TOLERANCE) {
    counters.closeMatchCount += 1;

    findings.push(
      buildCloseMatchFinding(findings, index, pitchDelta),
    );

    return;
  }

  counters.pitchMismatchCount += 1;

  findings.push(
    buildPitchMismatchFinding(findings, index, pitchDelta),
  );
}

function analyzeIntervalMatch(params: {
  findings: RelationalFinding[];
  counters: AnalysisCounters;
  index: number;
  previousPair: RelationalAnalysisInput["alignedPairs"][number];
  currentPair: RelationalAnalysisInput["alignedPairs"][number];
  input: RelationalAnalysisInput;
}): void {
  const {
    findings,
    counters,
    index,
    previousPair,
    currentPair,
    input,
  } = params;

  if (
    !isMatchedPair(previousPair) ||
    !isMatchedPair(currentPair)
  ) {
    return;
  }

  const expectedInterval = findIntervalForNote(
    input.expectedIntervals,
    previousPair.expectedNoteId,
    currentPair.expectedNoteId,
  );

  const actualInterval = findIntervalForNote(
    input.actualIntervals,
    previousPair.actualNoteId,
    currentPair.actualNoteId,
  );

  if (!expectedInterval || !actualInterval) {
    return;
  }

  const intervalDelta =
    actualInterval.semitones -
    expectedInterval.semitones;

  const absIntervalDelta = Math.abs(intervalDelta);

  if (absIntervalDelta <= INTERVAL_TOLERANCE) {
    findings.push(
      buildFinding(
        nextFindingId(findings),
        "interval_match",
        `Interval matched between positions ${index} and ${index + 1} (Δ ${intervalDelta.toFixed(
          2,
        )} semitones).`,
        0.9,
        [index - 1, index],
      ),
    );

    return;
  }

  counters.intervalMismatchCount += 1;

  findings.push(
    buildFinding(
      nextFindingId(findings),
      "wrong_interval",
      `Interval mismatch between positions ${index} and ${index + 1} (Δ ${intervalDelta.toFixed(
        2,
      )} semitones).`,
      0.82,
      [index - 1, index],
    ),
  );
}

function buildEmptyCounters(): AnalysisCounters {
  return {
    exactMatchCount: 0,
    closeMatchCount: 0,
    pitchMismatchCount: 0,
    insertionCount: 0,
    omissionCount: 0,
    intervalMismatchCount: 0,
  };
}

function calculateTotalPenalty(
  counters: AnalysisCounters,
): number {
  return (
    counters.pitchMismatchCount +
    counters.insertionCount +
    counters.omissionCount +
    counters.closeMatchCount * 0.5 +
    counters.intervalMismatchCount * 0.75
  );
}

function calculateAnalysisConfidence(
  input: RelationalAnalysisInput,
  counters: AnalysisCounters,
): number {
  const totalPenalty = calculateTotalPenalty(counters);

  const totalComparisons = Math.max(
    input.expectedNotes.length,
    input.actualNotes.length,
    1,
  );

  return clampConfidence(
    1 - totalPenalty / totalComparisons,
  );
}

export const relationalAnalysisService: RelationalAnalysisService = {
  run(input: RelationalAnalysisInput): RelationalAnalysisOutput {
    const findings: RelationalFinding[] = [];
    const counters = buildEmptyCounters();

    // Phase 1: Establish global pitch normalization offset.
    const referenceOffset = getReferenceOffset(input);

    // Phase 2: Walk alignment pairs and evaluate note relationships.
    for (let index = 0; index < input.alignedPairs.length; index += 1) {
      const pair = input.alignedPairs[index];

      // State: insertion
      if (isInsertionPair(pair)) {
        counters.insertionCount += 1;

        findings.push(
          buildInsertionFinding(findings, index),
        );

        continue;
      }

      // State: omission
      if (isOmissionPair(pair)) {
        counters.omissionCount += 1;

        findings.push(
          buildOmissionFinding(findings, index),
        );

        continue;
      }

      // State: matched note pair
      const context = getMatchedPairContext(input, pair);

      if (!context) {
        continue;
      }

      // Phase 2A: Pitch relationship analysis.
      analyzePitchMatch({
        findings,
        counters,
        index,
        expectedMidiFloat: context.expectedNote.midiFloat,
        actualMidiFloat: context.actualNote.midiFloat,
        referenceOffset,
      });

      // Phase 2B: Interval relationship analysis.
      if (index > 0) {
        analyzeIntervalMatch({
          findings,
          counters,
          index,
          previousPair: input.alignedPairs[index - 1],
          currentPair: pair,
          input,
        });
      }
    }

    // Phase 3: Convert accumulated penalties into confidence.
    const analysisConfidence = calculateAnalysisConfidence(
      input,
      counters,
    );

    return {
      findings,
      analysisConfidence,
    };
  },
};