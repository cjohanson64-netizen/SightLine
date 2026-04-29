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

function findIntervalForNote(
  intervals: IntervalStep[],
  fromId: string,
  toId: string,
): IntervalStep | undefined {
  return intervals.find(
    (interval) => interval.fromId === fromId && interval.toId === toId,
  );
}

function getReferenceOffset(input: RelationalAnalysisInput): number {
  for (const pair of input.alignedPairs) {
    if (
      pair.kind !== "matched" ||
      !pair.expectedNoteId ||
      !pair.actualNoteId
    ) {
      continue;
    }

    const expectedNote = input.expectedNotes.find(
      (note) => note.id === pair.expectedNoteId,
    );
    const actualNote = input.actualNotes.find(
      (note) => note.id === pair.actualNoteId,
    );

    if (!expectedNote || !actualNote) {
      continue;
    }

    return actualNote.midiFloat - expectedNote.midiFloat;
  }

  return 0;
}

export const relationalAnalysisService: RelationalAnalysisService = {
  run(input: RelationalAnalysisInput): RelationalAnalysisOutput {
    const findings: RelationalFinding[] = [];

    let exactMatchCount = 0;
    let closeMatchCount = 0;
    let pitchMismatchCount = 0;
    let insertionCount = 0;
    let omissionCount = 0;
    let intervalMismatchCount = 0;

    const referenceOffset = getReferenceOffset(input);

    for (let index = 0; index < input.alignedPairs.length; index += 1) {
      const pair = input.alignedPairs[index];
      const alignmentRange: [number, number] = [index, index];

      if (pair.kind === "insertion") {
        insertionCount += 1;
        findings.push(
          buildFinding(
            `f${findings.length + 1}`,
            "insertion",
            `Extra sung note detected at position ${index + 1}.`,
            0.85,
            alignmentRange,
          ),
        );
        continue;
      }

      if (pair.kind === "omission") {
        omissionCount += 1;
        findings.push(
          buildFinding(
            `f${findings.length + 1}`,
            "omission",
            `Expected note missing at position ${index + 1}.`,
            0.85,
            alignmentRange,
          ),
        );
        continue;
      }

      if (
        pair.kind !== "matched" ||
        !pair.expectedNoteId ||
        !pair.actualNoteId
      ) {
        continue;
      }

      const expectedNote = input.expectedNotes.find(
        (note) => note.id === pair.expectedNoteId,
      );
      const actualNote = input.actualNotes.find(
        (note) => note.id === pair.actualNoteId,
      );

      if (!expectedNote || !actualNote) {
        continue;
      }

      const normalizedActualMidiFloat =
        actualNote.midiFloat - referenceOffset;

      const pitchDelta =
        normalizedActualMidiFloat - expectedNote.midiFloat;
      const absPitchDelta = Math.abs(pitchDelta);

      if (absPitchDelta <= EXACT_MATCH_TOLERANCE) {
        exactMatchCount += 1;
        findings.push(
          buildFinding(
            `f${findings.length + 1}`,
            "exact_match",
            `Matched expected note at position ${index + 1} after offset normalization (Δ ${pitchDelta.toFixed(2)} semitones).`,
            0.95,
            alignmentRange,
          ),
        );
      } else if (absPitchDelta <= CLOSE_MATCH_TOLERANCE) {
        closeMatchCount += 1;
        findings.push(
          buildFinding(
            `f${findings.length + 1}`,
            "wrong_interval",
            `Close pitch at position ${index + 1} after offset normalization, but offset by ${pitchDelta.toFixed(2)} semitones.`,
            0.88,
            alignmentRange,
          ),
        );
      } else {
        pitchMismatchCount += 1;

        const direction = pitchDelta > 0 ? "sharp" : "flat";

        findings.push(
          buildFinding(
            `f${findings.length + 1}`,
            "wrong_interval",
            `Pitch mismatch at position ${index + 1} after offset normalization: ${direction} by ${absPitchDelta.toFixed(2)} semitones.`,
            0.8,
            alignmentRange,
          ),
        );
      }

      if (index > 0) {
        const previousPair = input.alignedPairs[index - 1];

        if (
          previousPair.kind === "matched" &&
          previousPair.expectedNoteId &&
          previousPair.actualNoteId
        ) {
          const expectedInterval = findIntervalForNote(
            input.expectedIntervals,
            previousPair.expectedNoteId,
            pair.expectedNoteId,
          );

          const actualInterval = findIntervalForNote(
            input.actualIntervals,
            previousPair.actualNoteId,
            pair.actualNoteId,
          );

          if (expectedInterval && actualInterval) {
            const intervalDelta =
              actualInterval.semitones - expectedInterval.semitones;
            const absIntervalDelta = Math.abs(intervalDelta);

            if (absIntervalDelta <= INTERVAL_TOLERANCE) {
              findings.push(
                buildFinding(
                  `f${findings.length + 1}`,
                  "interval_match",
                  `Interval matched between positions ${index} and ${index + 1} (Δ ${intervalDelta.toFixed(2)} semitones).`,
                  0.9,
                  [index - 1, index],
                ),
              );
            } else {
              intervalMismatchCount += 1;

              findings.push(
                buildFinding(
                  `f${findings.length + 1}`,
                  "wrong_interval",
                  `Interval mismatch between positions ${index} and ${index + 1} (Δ ${intervalDelta.toFixed(2)} semitones).`,
                  0.82,
                  [index - 1, index],
                ),
              );
            }
          }
        }
      }
    }

    const totalPenalty =
      pitchMismatchCount +
      insertionCount +
      omissionCount +
      closeMatchCount * 0.5 +
      intervalMismatchCount * 0.75;

    const totalComparisons = Math.max(
      input.expectedNotes.length,
      input.actualNotes.length,
      1,
    );

    return {
      findings,
      analysisConfidence: clampConfidence(
        1 - totalPenalty / totalComparisons,
      ),
    };
  },
};