import type {
  RhythmAnalysisInput,
  RhythmAnalysisOutput,
  RhythmAnalysisWindow,
  RhythmFinding,
} from "../types";
import type { RhythmAnalysisService } from "../types/services";

const BODY_MATCH_MAX_DEVIATION_RATIO = 0.15;
const BODY_CLOSE_MAX_DEVIATION_RATIO = 0.3;
const FINAL_MATCH_MAX_DEVIATION_RATIO = 0.2;
const FINAL_CLOSE_MAX_DEVIATION_RATIO = 0.4;
const PROVISIONAL_MELODIC_CONFIDENCE_THRESHOLD = 0.5;
const BODY_WINDOW_WEIGHT = 1;
const FINAL_WINDOW_WEIGHT = 0.6;
const ANOMALOUS_BODY_TAIL_WEIGHT = 0.5;
const ANOMALOUS_FINAL_TAIL_WEIGHT = 0.35;

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  return sorted[middleIndex];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0 || values.length !== weights.length) {
    return 0;
  }

  let weightedTotal = 0;
  let weightTotal = 0;

  for (let index = 0; index < values.length; index += 1) {
    weightedTotal += values[index] * weights[index];
    weightTotal += weights[index];
  }

  return weightTotal > 0 ? weightedTotal / weightTotal : 0;
}

function getTempoMsPerUnit(bodyRatios: number[]): number {
  if (bodyRatios.length < 5) {
    return median(bodyRatios);
  }

  const sorted = [...bodyRatios].sort((a, b) => a - b);
  return median(sorted.slice(1, sorted.length - 1));
}

function classifyDeviation(
  deviationRatio: number,
  isFinal: boolean,
): RhythmAnalysisWindow["classification"] {
  const matchThreshold = isFinal
    ? FINAL_MATCH_MAX_DEVIATION_RATIO
    : BODY_MATCH_MAX_DEVIATION_RATIO;
  const closeThreshold = isFinal
    ? FINAL_CLOSE_MAX_DEVIATION_RATIO
    : BODY_CLOSE_MAX_DEVIATION_RATIO;

  if (deviationRatio <= matchThreshold) {
    return "match";
  }

  if (deviationRatio <= closeThreshold) {
    return "close";
  }

  return "mismatch";
}

function getClassificationConfidence(
  classification: RhythmAnalysisWindow["classification"],
): number {
  if (classification === "match") {
    return 1;
  }

  if (classification === "close") {
    return 0.65;
  }

  return 0.2;
}

function buildWindow(
  index: number,
  expectedUnits: number,
  actualMs: number,
  expectedMs: number,
  isFinal: boolean,
): RhythmAnalysisWindow {
  const deviationRatio =
    expectedMs > 0 ? Math.abs(actualMs - expectedMs) / expectedMs : 1;

  return {
    index,
    expectedUnits,
    actualMs,
    expectedMs,
    deviationRatio,
    classification: classifyDeviation(deviationRatio, isFinal),
    isFinal,
  };
}

function buildFinding(window: RhythmAnalysisWindow): RhythmFinding {
  let type: RhythmFinding["type"];

  if (window.isFinal && window.classification === "mismatch") {
    type = window.actualMs < window.expectedMs ? "final_note_short" : "final_note_long";
  } else if (window.classification === "match") {
    type = "rhythm_match";
  } else if (window.classification === "close") {
    type = "rhythm_close";
  } else {
    type = "rhythm_mismatch";
  }

  return {
    id: `r${window.index + 1}`,
    type,
    windowIndex: window.index,
    confidence: getClassificationConfidence(window.classification),
    message: window.isFinal
      ? `Final note expected ${window.expectedMs.toFixed(1)}ms, got ${window.actualMs.toFixed(1)}ms.`
      : `Rhythm window ${window.index + 1} expected ${window.expectedMs.toFixed(1)}ms, got ${window.actualMs.toFixed(1)}ms.`,
  };
}

function emptyRhythmAnalysisOutput(): RhythmAnalysisOutput {
  return {
    windows: [],
    findings: [],
    rhythmConfidence: 0,
    bodyRhythmConfidence: 0,
    finalRhythmConfidence: 0,
    tailAnomalyIndices: [],
    windowWeights: [],
    isProvisional: false,
  };
}

function getTailAnomalyIndices(windows: RhythmAnalysisWindow[]): number[] {
  const bodyWindows = windows.filter((window) => !window.isFinal);
  const earlierBodyWindows = bodyWindows.slice(
    0,
    Math.max(0, bodyWindows.length - 2),
  );

  if (earlierBodyWindows.length === 0) {
    return [];
  }

  const earlierBodyMedianDeviation = median(
    earlierBodyWindows.map((window) => window.deviationRatio),
  );
  const anomalyThreshold = Math.max(0.35, earlierBodyMedianDeviation * 2.5);
  const tailWindows = windows.slice(Math.max(0, windows.length - 2));

  return tailWindows
    .filter((window) => window.deviationRatio > anomalyThreshold)
    .map((window) => window.index);
}

function getWindowWeight(
  window: RhythmAnalysisWindow,
  tailAnomalyIndices: number[],
): number {
  const isTailAnomalous = tailAnomalyIndices.includes(window.index);

  if (isTailAnomalous) {
    return window.isFinal ? ANOMALOUS_FINAL_TAIL_WEIGHT : ANOMALOUS_BODY_TAIL_WEIGHT;
  }

  return window.isFinal ? FINAL_WINDOW_WEIGHT : BODY_WINDOW_WEIGHT;
}

export const rhythmAnalysisService: RhythmAnalysisService = {
  run(input: RhythmAnalysisInput): RhythmAnalysisOutput {
    if (
      !input.expectedRhythm.units ||
      input.expectedRhythm.units.length === 0 ||
      !input.actualEvents ||
      input.actualEvents.length === 0
    ) {
      return emptyRhythmAnalysisOutput();
    }

    const comparableCount = Math.min(
      input.expectedRhythm.units.length,
      input.actualEvents.length,
    );

    if (comparableCount === 0) {
      return emptyRhythmAnalysisOutput();
    }

    const bodyRatios: number[] = [];

    for (let index = 0; index < comparableCount - 1; index += 1) {
      const current = input.actualEvents[index];
      const next = input.actualEvents[index + 1];
      const expectedUnits = input.expectedRhythm.units[index];
      const actualMs = next.startMs - current.startMs;

      if (expectedUnits > 0 && actualMs > 0) {
        bodyRatios.push(actualMs / expectedUnits);
      }
    }

    if (bodyRatios.length === 0) {
      return emptyRhythmAnalysisOutput();
    }

    const tempoMsPerUnit = getTempoMsPerUnit(bodyRatios);
    const windows: RhythmAnalysisWindow[] = [];

    for (let index = 0; index < comparableCount; index += 1) {
      const event = input.actualEvents[index];
      const expectedUnits = input.expectedRhythm.units[index];
      const isFinal = index === comparableCount - 1;
      const actualMs = isFinal
        ? Math.max(0, event.endMs - event.startMs)
        : Math.max(0, input.actualEvents[index + 1].startMs - event.startMs);
      const expectedMs = expectedUnits * tempoMsPerUnit;

      if (expectedUnits <= 0 || expectedMs <= 0 || actualMs <= 0) {
        continue;
      }

      windows.push(buildWindow(index, expectedUnits, actualMs, expectedMs, isFinal));
    }

    const findings = windows.map(buildFinding);
    const tailAnomalyIndices = getTailAnomalyIndices(windows);
    const windowWeights = windows.map((window) =>
      getWindowWeight(window, tailAnomalyIndices),
    );
    const bodyFindings = findings.filter((_, index) => !windows[index].isFinal);
    const finalFindings = findings.filter((_, index) => windows[index].isFinal);
    const bodyRhythmConfidence = clampConfidence(
      average(bodyFindings.map((finding) => finding.confidence)),
    );
    const finalRhythmConfidence = clampConfidence(
      average(finalFindings.map((finding) => finding.confidence)),
    );
    const rhythmConfidence = clampConfidence(
      weightedAverage(
        findings.map((finding) => finding.confidence),
        windowWeights,
      ),
    );
    let isProvisional = false;
    let provisionalReason: string | undefined;

    if (input.melodicStructureReliable === false) {
      isProvisional = true;
      provisionalReason =
        input.melodicStructureReason ??
        "Melodic structure was marked unreliable by the caller.";
    } else if (input.melodicIsReliable === false) {
      isProvisional = true;
      provisionalReason = "Melodic structure was marked unreliable by the caller.";
    } else if (
      input.melodicStructureReliable === undefined &&
      input.melodicConfidence !== undefined &&
      input.melodicConfidence < PROVISIONAL_MELODIC_CONFIDENCE_THRESHOLD
    ) {
      isProvisional = true;
      provisionalReason = `Melodic confidence was below ${PROVISIONAL_MELODIC_CONFIDENCE_THRESHOLD}.`;
    }

    return {
      windows,
      findings,
      rhythmConfidence,
      bodyRhythmConfidence,
      finalRhythmConfidence,
      tailAnomalyIndices,
      windowWeights,
      isProvisional,
      provisionalReason,
    };
  },
};
