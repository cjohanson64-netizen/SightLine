import type { MelodyAssessmentResult } from '@/SightLine/domain/assessment';

export interface MasteryScaleEntry {
  level: number;
  label: string;
  percentage: number;
}

export interface MasteryExplanationSignals {
  pitchMostlyCorrect: boolean;
  rhythmMostlyCorrect: boolean;
  flowMostlySteady: boolean;
  contourRecognizable: boolean;
  tonalDriftButConsistent: boolean;
}

export interface MasteryClassification {
  level: number;
  label: string;
  percentage: number;
  explanation: string;
  explanationSignals: MasteryExplanationSignals;
  explanationUsesRubricTextOnly: boolean;
}

export const MASTERY_SCALE: MasteryScaleEntry[] = [
  { level: 4.0, label: 'Above Mastery', percentage: 85 },
  { level: 3.5, label: 'Approaching Above Mastery', percentage: 80 },
  { level: 3.0, label: 'Mastery', percentage: 75 },
  { level: 2.5, label: 'Approaching Mastery', percentage: 63 },
  { level: 2.0, label: 'Emerging', percentage: 50 },
  { level: 1.5, label: 'Early Emerging', percentage: 38 },
  { level: 1.0, label: 'No Mastery', percentage: 25 },
  { level: 0.5, label: 'Minimal Attempt', percentage: 13 },
  { level: 0.0, label: 'No Attempt', percentage: 0 },
];

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function masteryLevelToLabel(level: number): string {
  const match = MASTERY_SCALE.find((entry) => entry.level === level);
  return match?.label ?? 'Unknown Mastery';
}

export function percentageToMastery(percentage: number): MasteryScaleEntry {
  const normalizedPercentage = clampPercentage(percentage);

  return MASTERY_SCALE.reduce((closestEntry, entry) => {
    const currentDistance = Math.abs(entry.percentage - normalizedPercentage);
    const closestDistance = Math.abs(closestEntry.percentage - normalizedPercentage);

    if (currentDistance < closestDistance) {
      return entry;
    }

    if (currentDistance === closestDistance && entry.level > closestEntry.level) {
      return entry;
    }

    return closestEntry;
  });
}

function buildMasteryExplanationSignals(
  result: MelodyAssessmentResult
): MasteryExplanationSignals {
  const contourAccuracy =
    result.summary.contourCorrectCount + result.summary.contourIncorrectCount > 0
      ? result.summary.contourCorrectCount /
        (result.summary.contourCorrectCount + result.summary.contourIncorrectCount)
      : result.summary.targetNoteCount > 1
        ? 0
        : 1;

  return {
    pitchMostlyCorrect: result.scores.pitchScore >= 78,
    rhythmMostlyCorrect: result.scores.rhythmScore >= 72,
    flowMostlySteady: result.rhythm.flow.score >= 0.62,
    contourRecognizable: contourAccuracy >= 0.6 || result.summary.contourFullyCorrect,
    tonalDriftButConsistent:
      result.tonalState.kind === 'recentered_new_tonic' &&
      result.tonalState.structuralConsistency.stronglyConsistent,
  };
}

function buildMasteryExplanation(
  result: MelodyAssessmentResult,
  signals: MasteryExplanationSignals
): string {
  if (result.summary.performedNoteCount === 0) {
    return 'There was not enough usable sung input to assess this attempt.';
  }

  if (signals.pitchMostlyCorrect && signals.rhythmMostlyCorrect && signals.flowMostlySteady) {
    return 'Your pitches and rhythm were mostly correct, and the flow stayed steady.';
  }

  if (signals.tonalDriftButConsistent) {
    return 'You shifted away from the original key, but stayed musically consistent.';
  }

  if (signals.pitchMostlyCorrect && !signals.rhythmMostlyCorrect) {
    return signals.flowMostlySteady
      ? 'Your pitches were mostly correct, but the rhythm was less steady.'
      : 'Your pitches were mostly correct, but rhythm and flow were interrupted.';
  }

  if (!signals.pitchMostlyCorrect && signals.contourRecognizable) {
    return signals.flowMostlySteady
      ? 'The melody shape was recognizable, but many pitches were not exact yet.'
      : 'The melody shape was recognizable, though pauses interrupted the flow.';
  }

  if (!signals.contourRecognizable) {
    return 'The melody shape was hard to recognize in this attempt.';
  }

  return 'Pitch, rhythm, and flow showed some partial success, but the phrase still needs support.';
}

export function classifyMastery(result: MelodyAssessmentResult): MasteryClassification {
  const melodicPercentage = clampPercentage(result.scores.melodicScore);
  const mastery = percentageToMastery(melodicPercentage);
  const explanationSignals = buildMasteryExplanationSignals(result);

  return {
    level: mastery.level,
    label: mastery.label,
    percentage: mastery.percentage,
    explanation: buildMasteryExplanation(result, explanationSignals),
    explanationSignals,
    explanationUsesRubricTextOnly: true,
  };
}
