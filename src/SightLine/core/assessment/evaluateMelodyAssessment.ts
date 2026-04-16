import type { MelodyEvent } from '@/SightLine/domain/music';
import { KEY_TO_PC, midiToPc } from '@/SightLine/core/midi';
import type {
  AssessmentMelodyNote,
  AssessmentComparisonMode,
  ContourAssessmentSpan,
  ContourDirection,
  EvaluateMelodyAssessmentInput,
  FirstDivergencePoint,
  GlobalOffsetCorrectionAnalysis,
  GlobalRelationshipAnalysis,
  GlobalRelationshipKind,
  IntervalAssessmentSpan,
  MelodyAssessmentResult,
  PitchMatchKind,
  PitchAssessmentNote,
  RecoveryAssessment,
  RecoveryKind,
  RhythmAssessment,
  RhythmAccuracyKind,
  RhythmSpanAssessment,
  FlowQualityKind,
  RhythmRelationshipKind,
  TonalStateAssessment,
  TonalStateKind,
  TonalWindowAssessment,
  TonalWindowKind,
} from '@/SightLine/domain/assessment';

function normalizeAssessmentMelody(melody: MelodyEvent[]): AssessmentMelodyNote[] {
  return melody
    .filter((event) => event.isAttack !== false)
    .sort(
      (a, b) =>
        a.measure - b.measure ||
        (a.onsetBeat ?? a.beat) - (b.onsetBeat ?? b.beat)
    )
    .map((event, index) => ({
      index,
      midi: event.midi,
      pitch: event.pitch,
      measure: event.measure,
      beat: event.beat,
      onsetBeat: event.onsetBeat ?? event.beat,
      sourceEvent: event,
    }));
}

function contourDirection(from: AssessmentMelodyNote, to: AssessmentMelodyNote): ContourDirection {
  if (to.midi > from.midi) {
    return 'up';
  }
  if (to.midi < from.midi) {
    return 'down';
  }
  return 'same';
}

function modeScale(mode: 'major' | 'minor'): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundFit(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const INTERVAL_RECOVERY_CONFIG = {
  lookaheadNotes: 4,
  maxRescuedNotes: 3,
  maxClusterSize: 3,
  minimumComparableIntervals: 2,
  minimumDirectionMatchRatio: 0.66,
  minimumIntervalCloseness: 0.62,
  minimumWindowScore: 0.72,
  baseCreditPerNote: 0.3,
  maxCreditPerNote: 0.6,
} as const;

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function normalizePitchClassDelta(value: number): number {
  return ((value % 12) + 12) % 12;
}

function rhythmRelationshipKind(ratio: number): RhythmRelationshipKind {
  if (ratio >= 1.25) {
    return 'longer';
  }
  if (ratio <= 0.8) {
    return 'shorter';
  }
  return 'equal';
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  if (average === 0) {
    return null;
  }
  return Math.sqrt(variance(values)) / average;
}

const RHYTHM_RATIO_TIGHT_THRESHOLD = Math.log(1.22);
const RHYTHM_RATIO_MEDIUM_THRESHOLD = Math.log(1.45);
const RHYTHM_RATIO_LOOSE_THRESHOLD = Math.log(1.8);

function gradedRhythmSpanScore(ratioError: number | null): number | null {
  if (ratioError === null) {
    return null;
  }
  if (ratioError <= RHYTHM_RATIO_TIGHT_THRESHOLD) {
    return 1;
  }
  if (ratioError <= RHYTHM_RATIO_MEDIUM_THRESHOLD) {
    return 0.75;
  }
  if (ratioError <= RHYTHM_RATIO_LOOSE_THRESHOLD) {
    return 0.5;
  }
  return 0.25;
}

function ratioErrorFromValues(a: number | null, b: number | null, targetRatio: number | null): number | null {
  if (!a || !b || !targetRatio) {
    return null;
  }
  const performedRatio = a / b;
  return Math.abs(Math.log(performedRatio / targetRatio));
}

function assessRhythm(
  targetMelody: AssessmentMelodyNote[],
  input: EvaluateMelodyAssessmentInput
): RhythmAssessment {
  const targetDurations = targetMelody.map((note) => note.sourceEvent.durationBeats ?? 1);
  const performedDurations = input.performedDurationsMs ?? [];
  const performedStarts = input.performedStartsMs ?? [];
  const performedEnds = input.performedEndsMs ?? [];
  const performedStatuses = input.performedWindowStatuses ?? [];
  const noteCount = Math.min(
    targetDurations.length,
    performedDurations.length || targetDurations.length
  );
  const performedIoIs = Array.from({ length: noteCount - 1 }, (_, index) => {
    const currentStart = performedStarts[index];
    const nextStart = performedStarts[index + 1];
    return typeof currentStart === 'number' && typeof nextStart === 'number' && nextStart > currentStart
      ? nextStart - currentStart
      : null;
  });

  const spans: RhythmSpanAssessment[] = Array.from({ length: Math.max(0, noteCount - 1) }, (_, index) => {
    const targetA = targetDurations[index] ?? null;
    const targetB = targetDurations[index + 1] ?? null;
    const performedA = performedDurations[index] ?? null;
    const performedB = performedDurations[index + 1] ?? null;
    const performedIoi = performedIoIs[index] ?? null;
    const performedNextIoi = performedIoIs[index + 1] ?? null;
    const targetRatio =
      targetA && targetB ? targetA / targetB : null;
    const performedDurationRatio =
      performedA && performedB ? performedA / performedB : null;
    const performedIoiRatio =
      performedIoi && performedNextIoi ? performedIoi / performedNextIoi : null;
    const ioiRatioError = ratioErrorFromValues(performedIoi, performedNextIoi, targetRatio);
    const durationRatioError = ratioErrorFromValues(performedA, performedB, targetRatio);
    const useIoiAsPrimary = ioiRatioError !== null;
    const useDurationAsSupport = durationRatioError !== null;
    const blendedRatioError =
      useIoiAsPrimary && useDurationAsSupport
        ? ioiRatioError * 0.75 + durationRatioError * 0.25
        : useIoiAsPrimary
          ? ioiRatioError
          : useDurationAsSupport
            ? durationRatioError
            : null;
    const performedRatio =
      performedIoiRatio ?? performedDurationRatio;
    const targetRelationship =
      targetRatio !== null ? rhythmRelationshipKind(targetRatio) : null;
    const performedRelationship =
      performedRatio !== null ? rhythmRelationshipKind(performedRatio) : null;
    const ratioError = blendedRatioError;
    const gradedScore = gradedRhythmSpanScore(ratioError);
    const relationshipPreserved =
      targetRelationship !== null &&
      performedRelationship !== null &&
      (targetRelationship === performedRelationship || (gradedScore ?? 0) >= 0.75);
    const pauseAfterMs =
      typeof performedStarts[index + 1] === 'number' && typeof performedEnds[index] === 'number'
        ? Math.max(0, performedStarts[index + 1]! - performedEnds[index]!)
        : null;
    const localDurationReference = median(
      [performedA ?? 0, performedB ?? 0].filter((value) => value > 0)
    );
    const clearPauseThreshold = Math.max(280, localDurationReference * 0.7);
    const briefPauseThreshold = Math.max(140, localDurationReference * 0.35);
    const breathThreshold = Math.max(180, localDurationReference * 0.4);
    const pauseImpact: RhythmSpanAssessment['pauseImpact'] =
      pauseAfterMs === null
        ? 'none'
        : pauseAfterMs >= clearPauseThreshold
          ? 'clear_pause'
          : pauseAfterMs >= briefPauseThreshold
            ? 'brief_pause'
            : 'none';
    const flowOnlyGap =
      pauseAfterMs !== null &&
      pauseAfterMs >= breathThreshold &&
      pauseImpact !== 'clear_pause';
    const durationIsTight =
      durationRatioError !== null && durationRatioError <= RHYTHM_RATIO_TIGHT_THRESHOLD;
    const ioiReducedForBreath =
      flowOnlyGap && durationIsTight && ioiRatioError !== null;
    const durationTrustedOverIoi =
      durationIsTight &&
      (
        ioiReducedForBreath ||
        (ioiRatioError !== null && durationRatioError !== null && ioiRatioError > durationRatioError * 1.5)
      );
    const ioiWeightApplied =
      ioiRatioError === null
        ? 0
        : durationTrustedOverIoi
          ? 0.15
          : durationRatioError === null
            ? 1
            : 0.65;
    const durationWeightApplied =
      durationRatioError === null
        ? 0
        : durationTrustedOverIoi
          ? 0.85
          : ioiRatioError === null
            ? 1
            : 0.35;
    const totalWeight = ioiWeightApplied + durationWeightApplied;
    const patternPreservedBonusApplied =
      relationshipPreserved &&
      targetRelationship !== null &&
      performedRelationship !== null &&
      (gradedScore ?? 0) < 0.75;
    const rhythmSignalUsed: RhythmSpanAssessment['rhythmSignalUsed'] =
      durationTrustedOverIoi
        ? 'duration'
        : useIoiAsPrimary && useDurationAsSupport
        ? 'blended'
        : useIoiAsPrimary
          ? 'ioi'
          : useDurationAsSupport
            ? 'duration'
            : 'none';
    const weightedRatioError =
      totalWeight > 0
        ? (((ioiRatioError ?? 0) * ioiWeightApplied) + ((durationRatioError ?? 0) * durationWeightApplied)) / totalWeight
        : null;
    const effectiveRatioError =
      flowOnlyGap && durationIsTight
        ? durationRatioError
        : weightedRatioError ?? blendedRatioError;
    const effectiveGradedScore = gradedRhythmSpanScore(effectiveRatioError);
    const assignedScore =
      effectiveGradedScore === null
        ? null
        : patternPreservedBonusApplied
          ? Math.max(effectiveGradedScore, targetRelationship === 'equal' ? 0.75 : 0.5)
          : effectiveGradedScore;
    const ratioScore =
      effectiveGradedScore === null || effectiveRatioError === null
        ? null
        : clamp01(
            assignedScore === 1
              ? 1
              : assignedScore === 0.75
                ? Math.max(0.75, 1 - effectiveRatioError / RHYTHM_RATIO_MEDIUM_THRESHOLD)
                : assignedScore === 0.5
                  ? Math.max(0.5, 1 - effectiveRatioError / RHYTHM_RATIO_LOOSE_THRESHOLD)
                  : 0
          );

    return {
      fromIndex: index,
      toIndex: index + 1,
      targetRatio,
      performedRatio,
      performedIoiMs: performedIoi,
      performedNextIoiMs: performedNextIoi,
      performedIoiRatio,
      performedDurationRatio,
      ratioError: effectiveRatioError === null ? null : roundFit(effectiveRatioError),
      ioiRatioError: ioiRatioError === null ? null : roundFit(ioiRatioError),
      durationRatioError: durationRatioError === null ? null : roundFit(durationRatioError),
      rhythmSignalUsed,
      ioiWeightApplied: roundFit(ioiWeightApplied),
      durationWeightApplied: roundFit(durationWeightApplied),
      ioiReducedForBreath,
      durationTrustedOverIoi,
      targetRelationship,
      performedRelationship,
      ratioScore: ratioScore === null ? null : roundFit(ratioScore),
      assignedScore,
      relationshipPreserved,
      patternPreservedBonusApplied,
      pauseAfterMs,
      pauseImpact,
      pausesIgnoredForAccuracy: true,
      gapAffectedFlowOnly: flowOnlyGap,
    };
  });

  const comparableSpans = spans.filter(
    (span) =>
      span.targetRatio !== null &&
      span.performedRatio !== null &&
      performedStatuses[span.fromIndex] !== 'missing' &&
      performedStatuses[span.toIndex] !== 'missing'
  );
  const comparableRatioScores = comparableSpans
    .map((span) => span.assignedScore)
    .filter((score): score is number => typeof score === 'number');
  const preservedSpanCount = comparableSpans.filter((span) => span.relationshipPreserved).length;
  const patternBonusCount = comparableSpans.filter((span) => span.patternPreservedBonusApplied).length;
  const flowOnlySpanCount = comparableSpans.filter((span) => span.gapAffectedFlowOnly).length;
  const rhythmScoreBase =
    comparableRatioScores.length > 0 ? mean(comparableRatioScores) : 0;
  const preservedStructureRatio =
    comparableSpans.length > 0 ? preservedSpanCount / comparableSpans.length : 0;
  const patternPreservedBonus =
    comparableSpans.length > 0 ? (patternBonusCount / comparableSpans.length) * 0.14 : 0;
  const preservedStructureBonus =
    comparableSpans.length > 0
      ? Math.max(0, preservedStructureRatio - 0.35) * 0.24
      : 0;
  const flowOnlyRelief =
    comparableSpans.length > 0 ? (flowOnlySpanCount / comparableSpans.length) * 0.08 : 0;
  const recognizablePatternSafeguard =
    comparableSpans.length >= 3 && preservedStructureRatio >= 0.55
      ? Math.max(0, 0.64 - (rhythmScoreBase + patternPreservedBonus + preservedStructureBonus + flowOnlyRelief))
      : 0;
  const rhythmScore =
    comparableSpans.length > 0
      ? clamp01(
          rhythmScoreBase +
            patternPreservedBonus +
            preservedStructureBonus +
            flowOnlyRelief +
            recognizablePatternSafeguard
        )
      : 0;

  const accuracy =
    comparableSpans.length === 0
      ? {
          applicable: false,
          kind: 'insufficient_data' as const,
          score: 0,
          baseScore: 0,
          patternPreservedBonus: 0,
          preservedStructureBonus: 0,
          recognizablePatternSafeguard: 0,
          flowOnlyRelief: 0,
          noteCount,
          comparableSpanCount: 0,
          preservedSpanCount: 0,
          summary: 'Not enough sung note-length data to assess rhythm yet.',
          spans,
        }
      : {
          applicable: true,
          kind: (
            rhythmScore >= 0.85
              ? 'strong'
              : rhythmScore >= 0.72
                ? 'mostly_correct'
                : rhythmScore >= 0.52
                  ? 'partially_preserved'
                : 'unclear'
          ) as RhythmAccuracyKind,
          score: roundFit(rhythmScore),
          baseScore: roundFit(rhythmScoreBase),
          patternPreservedBonus: roundFit(patternPreservedBonus),
          preservedStructureBonus: roundFit(preservedStructureBonus),
          recognizablePatternSafeguard: roundFit(recognizablePatternSafeguard),
          flowOnlyRelief: roundFit(flowOnlyRelief),
          noteCount,
          comparableSpanCount: comparableSpans.length,
          preservedSpanCount,
          summary:
            rhythmScore >= 0.85
              ? 'Rhythm pattern was mostly preserved.'
              : rhythmScore >= 0.72
                ? 'The long and short note relationships were mostly recognizable.'
                : rhythmScore >= 0.52
                  ? 'Some rhythm structure came through, but parts of the pattern were uneven.'
                : 'The sung note-length pattern was not yet clearly recognizable.',
          spans,
        };

  const detectedDurations = performedDurations.filter(
    (value): value is number => typeof value === 'number' && value > 0
  );
  const detectedBeatRates = performedDurations
    .map((durationMs, index) => {
      const targetBeats = targetDurations[index] ?? 0;
      return typeof durationMs === 'number' && durationMs > 0 && targetBeats > 0
        ? durationMs / targetBeats
        : null;
    })
    .filter((value): value is number => typeof value === 'number' && value > 0);
  const medianDuration = detectedDurations.length > 0 ? median(detectedDurations) : 0;
  const pauses = spans
    .map((span) => span.pauseAfterMs)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  const pauseCount = spans.filter((span) => span.pauseImpact !== 'none').length;
  const longPauseCount = spans.filter((span) => span.pauseImpact === 'clear_pause').length;
  const pausePenalty =
    comparableSpans.length > 0
      ? pauseCount / comparableSpans.length * 0.28 + longPauseCount / comparableSpans.length * 0.3
      : 0;
  const tempoDrift = coefficientOfVariation(detectedBeatRates);
  const tempoPenalty = tempoDrift === null ? 0 : Math.min(0.35, tempoDrift * 0.45);
  const flowScore =
    detectedDurations.length < 2
      ? 0
      : clamp01(1 - pausePenalty - tempoPenalty);

  const flow =
    detectedDurations.length < 2
      ? {
          applicable: false,
          kind: 'insufficient_data' as const,
          score: 0,
          summary: 'Not enough continuous singing data to judge flow yet.',
          averagePauseMs: pauses.length > 0 ? roundFit(mean(pauses)) : null,
          pauseCount,
          longPauseCount,
          tempoDrift: tempoDrift === null ? null : roundFit(tempoDrift),
        }
      : {
          applicable: true,
          kind: (
            flowScore >= 0.82
              ? 'continuous'
              : flowScore >= 0.62
                ? 'mostly_continuous'
                : flowScore >= 0.42
                  ? 'interrupted'
                  : 'fragmented'
          ) as FlowQualityKind,
          score: roundFit(flowScore),
          summary:
            flowScore >= 0.82
              ? 'Flow stayed mostly continuous.'
              : flowScore >= 0.62
                ? 'Flow was usable, with a few hesitations.'
                : flowScore >= 0.42
                  ? 'Flow was interrupted by pauses or uneven pacing.'
                  : 'Flow was quite broken up, even where some rhythm structure remained.',
          averagePauseMs: pauses.length > 0 ? roundFit(mean(pauses)) : null,
          pauseCount,
          longPauseCount,
          tempoDrift: tempoDrift === null ? null : roundFit(tempoDrift),
        };

  return {
    accuracy,
    flow,
  };
}

interface InferredTonalFrame {
  tonicPitchClass: number | null;
  mode: 'major' | 'minor' | null;
}

function inferTargetTonalFrame(targetMelody: AssessmentMelodyNote[]): InferredTonalFrame {
  const keyId = targetMelody[0]?.sourceEvent.keyId;
  if (keyId) {
    const [keyNameRaw, modeRaw] = keyId.split('-');
    const tonicPitchClass = KEY_TO_PC[keyNameRaw] ?? null;
    return {
      tonicPitchClass,
      mode: modeRaw === 'minor' ? 'minor' : 'major',
    };
  }

  if (targetMelody.length === 0) {
    return { tonicPitchClass: null, mode: null };
  }

  const scores = new Map<number, number>();
  for (const note of targetMelody) {
    const pitchClass = midiToPc(note.midi);
    scores.set(pitchClass, (scores.get(pitchClass) ?? 0) + 1);
  }

  const firstPitchClass = midiToPc(targetMelody[0].midi);
  const lastPitchClass = midiToPc(targetMelody[targetMelody.length - 1].midi);
  scores.set(firstPitchClass, (scores.get(firstPitchClass) ?? 0) + 2);
  scores.set(lastPitchClass, (scores.get(lastPitchClass) ?? 0) + 3);

  let tonicPitchClass: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [pitchClass, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      tonicPitchClass = pitchClass;
    }
  }

  return { tonicPitchClass, mode: 'major' };
}

function noteWeight(note: AssessmentMelodyNote, index: number, windowLength: number): number {
  const beats = note.sourceEvent.durationBeats ?? 1;
  const edgeBonus = index === 0 || index === windowLength - 1 ? 0.25 : 0;
  return beats + edgeBonus;
}

function scoreWindowAgainstTonic(
  notes: AssessmentMelodyNote[],
  tonicPitchClass: number,
  mode: 'major' | 'minor'
): number {
  if (notes.length === 0) {
    return 0;
  }

  const scale = new Set(modeScale(mode).map((step) => (tonicPitchClass + step) % 12));
  let score = 0;
  let maxScore = 0;

  notes.forEach((note, index) => {
    const weight = noteWeight(note, index, notes.length);
    const pitchClass = midiToPc(note.midi);
    maxScore += weight * 1.5;

    if (scale.has(pitchClass)) {
      score += weight;
    }
    if (pitchClass === tonicPitchClass) {
      score += weight * 0.5;
    }
  });

  return maxScore > 0 ? clamp01(score / maxScore) : 0;
}

function analyzeTonalWindow(
  label: TonalWindowAssessment['label'],
  melody: AssessmentMelodyNote[],
  startIndex: number,
  endIndex: number | null,
  targetFrame: InferredTonalFrame
): TonalWindowAssessment {
  const boundedEndIndex = endIndex ?? melody.length - 1;
  const windowNotes =
    startIndex <= boundedEndIndex ? melody.slice(startIndex, boundedEndIndex + 1) : [];

  if (
    windowNotes.length === 0 ||
    targetFrame.tonicPitchClass === null ||
    targetFrame.mode === null
  ) {
    return {
      label,
      startIndex,
      endIndex,
      noteCount: windowNotes.length,
      targetFit: null,
      alternateFit: null,
      alternateTonicPitchClass: null,
      classification: 'insufficient_data',
    };
  }

  const targetFit = scoreWindowAgainstTonic(
    windowNotes,
    targetFrame.tonicPitchClass,
    targetFrame.mode
  );

  let alternateFit = Number.NEGATIVE_INFINITY;
  let alternateTonicPitchClass: number | null = null;

  for (let tonic = 0; tonic < 12; tonic += 1) {
    if (tonic === targetFrame.tonicPitchClass) {
      continue;
    }

    const fit = scoreWindowAgainstTonic(windowNotes, tonic, targetFrame.mode);
    if (fit > alternateFit) {
      alternateFit = fit;
      alternateTonicPitchClass = tonic;
    }
  }

  let classification: TonalWindowKind = 'ambiguous';
  if (windowNotes.length < 2) {
    classification = 'insufficient_data';
  } else if (targetFit >= 0.7 && targetFit - alternateFit >= 0.08) {
    classification = 'aligned_target';
  } else if (alternateFit >= 0.74 && alternateFit - targetFit >= 0.08) {
    classification = 'leaning_alternate';
  }

  return {
    label,
    startIndex,
    endIndex,
    noteCount: windowNotes.length,
    targetFit: roundFit(targetFit),
    alternateFit: Number.isFinite(alternateFit) ? roundFit(alternateFit) : null,
    alternateTonicPitchClass,
    classification,
  };
}

function classifyGlobalRelationship(
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[]
): GlobalRelationshipAnalysis {
  if (targetMelody.length === 0 || performedMelody.length === 0) {
    return {
      kind: 'unclassified',
      semitoneDelta: null,
      pitchClassDelta: null,
      phraseOffsetLocked: false,
    };
  }

  if (targetMelody.length !== performedMelody.length) {
    return {
      kind: 'locally_divergent',
      semitoneDelta: null,
      pitchClassDelta: null,
      phraseOffsetLocked: false,
    };
  }

  const deltas = targetMelody.map((target, index) => performedMelody[index].midi - target.midi);
  const pitchClassDeltas = deltas.map(normalizePitchClassDelta);
  const [firstDelta] = deltas;
  const [firstPitchClassDelta] = pitchClassDeltas;
  const exactOffsetLocked = deltas.every((delta) => delta === firstDelta);
  const pitchClassOffsetLocked = pitchClassDeltas.every(
    (delta) => delta === firstPitchClassDelta
  );

  if (deltas.every((delta) => delta === 0)) {
    return {
      kind: 'exact_match',
      semitoneDelta: 0,
      pitchClassDelta: 0,
      phraseOffsetLocked: true,
    };
  }

  if (exactOffsetLocked) {
    if (firstDelta % 12 === 0) {
      return {
        kind: 'octave_shifted',
        semitoneDelta: firstDelta,
        pitchClassDelta: 0,
        phraseOffsetLocked: true,
      };
    }
    return {
      kind: 'globally_transposed',
      semitoneDelta: firstDelta,
      pitchClassDelta: firstPitchClassDelta,
      phraseOffsetLocked: true,
    };
  }

  if (pitchClassOffsetLocked) {
    if (firstPitchClassDelta === 0) {
      return {
        kind: 'octave_shifted',
        semitoneDelta: null,
        pitchClassDelta: 0,
        phraseOffsetLocked: true,
      };
    }

    return {
      kind: 'globally_transposed',
      semitoneDelta: null,
      pitchClassDelta: firstPitchClassDelta,
      phraseOffsetLocked: true,
    };
  }

  return {
    kind: 'locally_divergent',
    semitoneDelta: null,
    pitchClassDelta: null,
    phraseOffsetLocked: false,
  };
}

function findNearestShiftedTargetMidi(
  targetMidi: number,
  performedMidi: number,
  pitchClassDelta: number
): number {
  const shiftedBaseMidi = targetMidi + pitchClassDelta;
  const octaveAdjustment = Math.round((performedMidi - shiftedBaseMidi) / 12);
  return shiftedBaseMidi + octaveAdjustment * 12;
}

function resolveNormalizedExpectedMidi(
  target: AssessmentMelodyNote | null,
  performed: AssessmentMelodyNote | null,
  mode: AssessmentComparisonMode,
  globalRelationship: GlobalRelationshipAnalysis
): number | null {
  if (!target || !performed) {
    return null;
  }

  if (mode === 'literal') {
    return target.midi;
  }

  if (
    mode === 'transposition_aware' &&
    globalRelationship.phraseOffsetLocked &&
    globalRelationship.pitchClassDelta !== null
  ) {
    return findNearestShiftedTargetMidi(
      target.midi,
      performed.midi,
      globalRelationship.pitchClassDelta
    );
  }

  return findNearestShiftedTargetMidi(target.midi, performed.midi, 0);
}

function resolvePitchMatchKind(
  target: AssessmentMelodyNote | null,
  performed: AssessmentMelodyNote | null,
  mode: AssessmentComparisonMode,
  globalRelationship: GlobalRelationshipAnalysis,
  phraseCorrectionOffset = 0
): {
  matchKind: PitchMatchKind;
  semitoneDelta: number | null;
  normalizedExpectedMidi: number | null;
  scoringDelta: number | null;
  absDelta: number | null;
  toleranceApplied: boolean;
  comparisonTargetMidi: number | null;
  comparisonSemitoneDelta: number | null;
  isCorrect: boolean;
} {
  if (!target || !performed) {
    return {
      matchKind: 'missing',
      semitoneDelta: null,
      normalizedExpectedMidi: null,
      scoringDelta: null,
      absDelta: null,
      toleranceApplied: false,
      comparisonTargetMidi: null,
      comparisonSemitoneDelta: null,
      isCorrect: false,
    };
  }

  const semitoneDelta = performed.midi - target.midi;
  const normalizedExpectedMidi = resolveNormalizedExpectedMidi(
    target,
    performed,
    mode,
    globalRelationship
  );
  const correctedExpectedMidi =
    normalizedExpectedMidi !== null ? normalizedExpectedMidi + phraseCorrectionOffset : null;
  const comparisonTargetMidi = normalizedExpectedMidi;
  const comparisonSemitoneDelta =
    normalizedExpectedMidi !== null ? performed.midi - normalizedExpectedMidi : null;
  const scoringDelta =
    correctedExpectedMidi !== null ? performed.midi - correctedExpectedMidi : null;
  const absDelta =
    typeof scoringDelta === 'number' ? Math.abs(scoringDelta) : null;
  const isExact = semitoneDelta === 0;

  if (isExact) {
    return {
      matchKind: 'exact',
      semitoneDelta,
      normalizedExpectedMidi: correctedExpectedMidi,
      scoringDelta,
      absDelta,
      toleranceApplied: false,
      comparisonTargetMidi,
      comparisonSemitoneDelta,
      isCorrect: true,
    };
  }

  if (absDelta === 1) {
    return {
      matchKind: 'near',
      semitoneDelta,
      normalizedExpectedMidi: correctedExpectedMidi,
      scoringDelta,
      absDelta,
      toleranceApplied: true,
      comparisonTargetMidi,
      comparisonSemitoneDelta,
      isCorrect: false,
    };
  }

  return {
    matchKind: 'incorrect',
    semitoneDelta,
    normalizedExpectedMidi: correctedExpectedMidi,
    scoringDelta,
    absDelta,
    toleranceApplied: false,
    comparisonTargetMidi,
    comparisonSemitoneDelta,
    isCorrect: false,
  };
}

function buildPitchAssessments(
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[],
  mode: AssessmentComparisonMode,
  globalRelationship: GlobalRelationshipAnalysis,
  phraseCorrectionOffset = 0,
  rawReferenceNotes?: PitchAssessmentNote[]
): PitchAssessmentNote[] {
  const noteCount = Math.max(targetMelody.length, performedMelody.length);

  return Array.from({ length: noteCount }, (_, index) => {
    const target = targetMelody[index] ?? null;
    const performed = performedMelody[index] ?? null;
    const pitchMatch = resolvePitchMatchKind(
      target,
      performed,
      mode,
      globalRelationship,
      phraseCorrectionOffset
    );
    const rawReference = rawReferenceNotes?.[index];

    return {
      index,
      target,
      performed,
      matchKind: pitchMatch.matchKind,
      semitoneDelta: pitchMatch.semitoneDelta,
      rawNormalizedExpectedMidi:
        rawReference?.normalizedExpectedMidi ?? pitchMatch.normalizedExpectedMidi,
      rawScoringDelta: rawReference?.scoringDelta ?? pitchMatch.scoringDelta,
      normalizedExpectedMidi: pitchMatch.normalizedExpectedMidi,
      scoringDelta: pitchMatch.scoringDelta,
      absDelta: pitchMatch.absDelta,
      toleranceApplied: pitchMatch.toleranceApplied,
      correctnessLocked: pitchMatch.absDelta === 0,
      normalizedScoringUsed:
        pitchMatch.normalizedExpectedMidi !== null &&
        target !== null &&
        pitchMatch.normalizedExpectedMidi !== target.midi,
      comparisonTargetMidi: pitchMatch.comparisonTargetMidi,
      comparisonSemitoneDelta: pitchMatch.comparisonSemitoneDelta,
      isCorrect: pitchMatch.isCorrect,
      displayState:
        pitchMatch.matchKind === 'exact'
          ? 'correct'
          : pitchMatch.matchKind === 'near'
            ? 'near'
            : 'incorrect',
      weakWindowProtectionApplied: false,
      isolatedErrorSoftened: false,
      globalOffsetCorrectionApplied: phraseCorrectionOffset !== 0,
      appliedGlobalOffset: phraseCorrectionOffset !== 0 ? phraseCorrectionOffset : null,
      intervalRecoveryCredit: 0,
      intervalRecoveryApplied: false,
      interpretationReason: null,
    };
  });
}

function scoreTolerancePoints(delta: number | null): number {
  if (delta === null) {
    return 0;
  }
  const absDelta = Math.abs(delta);
  if (absDelta === 0) {
    return 1;
  }
  if (absDelta === 1) {
    return 0.85;
  }
  return 0;
}

function detectDominantGlobalOffset(
  notes: PitchAssessmentNote[],
  input: EvaluateMelodyAssessmentInput
): GlobalOffsetCorrectionAnalysis {
  const eligible = notes.filter(
    (note) => note.target && note.performed && typeof note.scoringDelta === 'number'
  );

  const emptyResult = (
    reason: string,
    rawScore = 0,
    rawAverageScore = 0,
    phraseAlreadyMostlyAcceptable = false,
    sessionPitchBias: GlobalOffsetCorrectionAnalysis['sessionPitchBias'] = {
      offset: null,
      supportCount: 0,
      supportRatio: 0,
      confidence: 0,
      treatedAsBias: false,
      reason: null,
    }
  ): GlobalOffsetCorrectionAnalysis => ({
    candidateOffset: null,
    supportCount: 0,
    supportRatio: 0,
    applied: false,
    calibrationOffsetHint: input.calibrationOffsetHint ?? null,
    calibrationContributed: false,
    calibrationSupportedCandidate: false,
    rawScore: roundFit(rawScore),
    correctedScore: null,
    improvement: 0,
    rawAverageScore: roundFit(rawAverageScore),
    correctedAverageScore: null,
    phraseAlreadyMostlyAcceptable,
    acceptedReason: null,
    rejectedReason: reason,
    sessionPitchBias,
  });

  if (eligible.length < 5) {
    return emptyResult(
      'Not enough eligible notes for phrase-level offset analysis.',
      0,
      0,
      false,
      {
        offset: null,
        supportCount: 0,
        supportRatio: 0,
        confidence: 0,
        treatedAsBias: false,
        reason: 'Not enough eligible notes for session bias estimation.',
      }
    );
  }

  const candidateOffsets = [-12, -1, 1, 12];
  let bestCandidate: {
    offset: number;
    supportCount: number;
    supportRatio: number;
    improvement: number;
    correctedScore: number;
    correctedAverageScore: number;
    calibrationSupportedCandidate: boolean;
    acceptedReason: string;
  } | null = null;

  const rawScore = eligible.reduce(
    (sum, note) => sum + scoreTolerancePoints(note.scoringDelta),
    0
  );
  const rawAverageScore = rawScore / eligible.length;
  const rawAcceptableRatio =
    eligible.filter((note) => scoreTolerancePoints(note.scoringDelta) >= 0.85).length /
    eligible.length;
  const phraseAlreadyMostlyAcceptable =
    rawAverageScore >= 0.8 || rawAcceptableRatio >= 0.7;

  const biasCandidate = [-1, 1]
    .map((offset) => {
      const supportCount = eligible.filter((note) => note.scoringDelta === offset).length;
      return {
        offset,
        supportCount,
        supportRatio: supportCount / eligible.length,
      };
    })
    .sort((a, b) => b.supportRatio - a.supportRatio)[0];

  const sessionPitchBias: GlobalOffsetCorrectionAnalysis['sessionPitchBias'] =
    biasCandidate && biasCandidate.supportRatio >= 0.45
      ? {
          offset: biasCandidate.offset,
          supportCount: biasCandidate.supportCount,
          supportRatio: roundFit(biasCandidate.supportRatio),
          confidence: roundFit(
            Math.min(
              1,
              biasCandidate.supportRatio * (phraseAlreadyMostlyAcceptable ? 1 : 0.8)
            )
          ),
          treatedAsBias:
            phraseAlreadyMostlyAcceptable || biasCandidate.supportRatio < 0.75,
          reason: phraseAlreadyMostlyAcceptable
            ? 'Repeated ±1 semitone offsets look more like session bias because the phrase is already mostly acceptable.'
            : 'Repeated ±1 semitone offsets are being treated as soft session bias until stronger phrase-level evidence appears.',
        }
      : {
          offset: null,
          supportCount: 0,
          supportRatio: 0,
          confidence: 0,
          treatedAsBias: false,
          reason: null,
        };

  let rejectedReason: string | null = null;

  for (const offset of candidateOffsets) {
    const supportCount = eligible.filter(
      (note) => note.scoringDelta === offset
    ).length;
    const supportRatio = supportCount / eligible.length;
    const correctedScore = eligible.reduce(
      (sum, note) => sum + scoreTolerancePoints((note.scoringDelta ?? 0) - offset),
      0
    );
    const improvement = correctedScore - rawScore;
    const correctedAverageScore = correctedScore / eligible.length;
    const correctedAcceptableRatio =
      eligible.filter((note) => scoreTolerancePoints((note.scoringDelta ?? 0) - offset) >= 0.85)
        .length / eligible.length;
    const calibrationSupportedCandidate =
      typeof input.calibrationOffsetHint === 'number' &&
      Math.abs(input.calibrationOffsetHint - offset) <= 0.35 &&
      input.calibrationSignalQuality !== 'poor' &&
      input.calibrationSignalQuality !== null;
    const isSmallOffset = Math.abs(offset) === 1;
    const minimumSupportCount = Math.max(
      isSmallOffset ? 5 : 4,
      Math.ceil(eligible.length * (isSmallOffset ? 0.72 : 0.6))
    );
    const minimumSupportRatio = isSmallOffset ? 0.75 : 0.65;
    const minimumImprovement = isSmallOffset ? 1.75 : 1;
    const minimumAverageGain = isSmallOffset ? 0.14 : 0.09;
    const minimumCorrectedAcceptableRatio = isSmallOffset ? 0.88 : 0.75;
    const needsStrongerEvidenceBecausePhraseIsAcceptable =
      phraseAlreadyMostlyAcceptable &&
      (improvement < (isSmallOffset ? 2.5 : 1.5) ||
        correctedAverageScore - rawAverageScore < (isSmallOffset ? 0.18 : 0.12));

    const qualifies =
      supportCount >= minimumSupportCount &&
      supportRatio >= minimumSupportRatio &&
      improvement >= minimumImprovement &&
      correctedAverageScore - rawAverageScore >= minimumAverageGain &&
      correctedAcceptableRatio >= minimumCorrectedAcceptableRatio &&
      !needsStrongerEvidenceBecausePhraseIsAcceptable;

    if (qualifies) {
      bestCandidate = {
        offset,
        supportCount,
        supportRatio: roundFit(supportRatio),
        improvement: roundFit(improvement),
        correctedScore: roundFit(correctedScore),
        correctedAverageScore: roundFit(correctedAverageScore),
        calibrationSupportedCandidate,
        acceptedReason: isSmallOffset
          ? 'Applied only after strong repeated support and a clearly meaningful improvement beyond the already-acceptable baseline.'
          : 'Applied because the phrase is materially better explained by a strong consistent offset.',
      };
      continue;
    }

    if (!rejectedReason && isSmallOffset && sessionPitchBias.treatedAsBias && sessionPitchBias.offset === offset) {
      rejectedReason = sessionPitchBias.reason;
    } else if (!rejectedReason && needsStrongerEvidenceBecausePhraseIsAcceptable) {
      rejectedReason =
        'Phrase-level correction was rejected because the phrase was already mostly acceptable without it.';
    } else if (!rejectedReason && supportRatio < minimumSupportRatio) {
      rejectedReason = 'Phrase-level correction was rejected because support ratio was too weak.';
    } else if (!rejectedReason && improvement < minimumImprovement) {
      rejectedReason = 'Phrase-level correction was rejected because the improvement over the raw phrase was too small.';
    } else if (!rejectedReason && correctedAcceptableRatio < minimumCorrectedAcceptableRatio) {
      rejectedReason =
        'Phrase-level correction was rejected because the corrected frame still did not resolve enough notes cleanly.';
    }
  }

  if (!bestCandidate) {
    return emptyResult(
      rejectedReason ?? 'No phrase-level offset candidate met the conservative acceptance criteria.',
      rawScore,
      rawAverageScore,
      phraseAlreadyMostlyAcceptable,
      sessionPitchBias
    );
  }

  return {
    candidateOffset: bestCandidate.offset,
    supportCount: bestCandidate.supportCount,
    supportRatio: bestCandidate.supportRatio,
    applied: true,
    calibrationOffsetHint: input.calibrationOffsetHint ?? null,
    calibrationContributed: bestCandidate.calibrationSupportedCandidate,
    calibrationSupportedCandidate: bestCandidate.calibrationSupportedCandidate,
    rawScore: roundFit(rawScore),
    correctedScore: bestCandidate.correctedScore,
    improvement: bestCandidate.improvement,
    rawAverageScore: roundFit(rawAverageScore),
    correctedAverageScore: bestCandidate.correctedAverageScore,
    phraseAlreadyMostlyAcceptable,
    acceptedReason: bestCandidate.acceptedReason,
    rejectedReason: null,
    sessionPitchBias,
  };
}

function buildIntervalAssessments(
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[]
): IntervalAssessmentSpan[] {
  const spanCount = Math.max(
    0,
    Math.max(targetMelody.length - 1, performedMelody.length - 1)
  );

  return Array.from({ length: spanCount }, (_, index) => {
    const expectedSemitones =
      targetMelody[index] && targetMelody[index + 1]
        ? targetMelody[index + 1].midi - targetMelody[index].midi
        : null;
    const performedSemitones =
      performedMelody[index] && performedMelody[index + 1]
        ? performedMelody[index + 1].midi - performedMelody[index].midi
        : null;

    return {
      fromIndex: index,
      toIndex: index + 1,
      expectedSemitones,
      performedSemitones,
      isCorrect:
        expectedSemitones !== null &&
        performedSemitones !== null &&
        expectedSemitones === performedSemitones,
    };
  });
}

function buildContourAssessments(
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[]
): ContourAssessmentSpan[] {
  const spanCount = Math.max(
    0,
    Math.max(targetMelody.length - 1, performedMelody.length - 1)
  );

  return Array.from({ length: spanCount }, (_, index) => {
    const expected =
      targetMelody[index] && targetMelody[index + 1]
        ? contourDirection(targetMelody[index], targetMelody[index + 1])
        : null;
    const performed =
      performedMelody[index] && performedMelody[index + 1]
        ? contourDirection(performedMelody[index], performedMelody[index + 1])
        : null;

    return {
      fromIndex: index,
      toIndex: index + 1,
      expected,
      performed,
      isCorrect: expected !== null && performed !== null && expected === performed,
    };
  });
}

function findFirstDivergence(
  notes: PitchAssessmentNote[],
  intervals: IntervalAssessmentSpan[],
  contours: ContourAssessmentSpan[]
): FirstDivergencePoint | null {
  for (const note of notes) {
    if (note.target && note.performed && note.matchKind === 'incorrect') {
      return {
        noteIndex: note.index,
        reason: 'pitch_mismatch',
        target: note.target,
        performed: note.performed,
      };
    }

    if (note.target && !note.performed) {
      return {
        noteIndex: note.index,
        reason: 'missing_performed_note',
        target: note.target,
        performed: null,
      };
    }

    if (!note.target && note.performed) {
      return {
        noteIndex: note.index,
        reason: 'extra_performed_note',
        target: null,
        performed: note.performed,
      };
    }
  }

  for (const interval of intervals) {
    if (interval.expectedSemitones !== null && interval.performedSemitones !== null && !interval.isCorrect) {
      return {
        noteIndex: interval.toIndex,
        reason: 'interval_mismatch',
        target: null,
        performed: null,
      };
    }
  }

  for (const contour of contours) {
    if (contour.expected !== null && contour.performed !== null && contour.expected !== contour.performed) {
      return {
        noteIndex: contour.toIndex,
        reason: 'contour_mismatch',
        target: null,
        performed: null,
      };
    }
  }

  return null;
}

function findFullRecoveryStartIndex(
  notes: PitchAssessmentNote[],
  intervals: IntervalAssessmentSpan[],
  contours: ContourAssessmentSpan[],
  searchStartIndex: number
): number | null {
  for (let index = searchStartIndex; index < notes.length; index += 1) {
    const tailNotes = notes.slice(index);
    const tailIntervals = intervals.filter((span) => span.fromIndex >= index);
    const tailContours = contours.filter((span) => span.fromIndex >= index);
    const notesRecovered =
      tailNotes.length > 0 &&
      tailNotes.every((note) => note.target && note.performed && note.isCorrect);
    const intervalsRecovered = tailIntervals.every((span) => span.isCorrect);
    const contoursRecovered = tailContours.every((span) => span.isCorrect);

    if (notesRecovered && intervalsRecovered && contoursRecovered) {
      return index;
    }
  }

  return null;
}

function assessRecovery(
  notes: PitchAssessmentNote[],
  intervals: IntervalAssessmentSpan[],
  contours: ContourAssessmentSpan[],
  firstDivergence: FirstDivergencePoint | null,
  globalRelationship: GlobalRelationshipKind
): RecoveryAssessment {
  if (
    !firstDivergence ||
    globalRelationship === 'exact_match' ||
    globalRelationship === 'octave_shifted' ||
    globalRelationship === 'globally_transposed'
  ) {
    return {
      applicable: false,
      kind: null,
      recoveryNoteIndex: null,
      pitchRecoveryIndex: null,
      intervalRecoveryIndex: null,
      contourRecoveryIndex: null,
      recoveredDimensions: {
        pitch: false,
        interval: false,
        contour: false,
      },
      intervalRescue: {
        applicable: false,
        startIndex: null,
        endIndex: null,
        rescuedNoteIndices: [],
        comparableIntervalCount: 0,
        directionMatchRatio: null,
        intervalCloseness: null,
        rejoinedTarget: false,
        creditPerNote: 0,
      },
    };
  }

  const searchStartIndex = firstDivergence.noteIndex + 1;
  const pitchRecovery = notes.find(
    (note) => note.index >= searchStartIndex && note.target && note.performed && note.isCorrect
  );
  const intervalRecovery = intervals.find(
    (span) =>
      span.fromIndex >= searchStartIndex &&
      span.expectedSemitones !== null &&
      span.performedSemitones !== null &&
      span.isCorrect
  );
  const contourRecovery = contours.find(
    (span) =>
      span.fromIndex >= searchStartIndex &&
      span.expected !== null &&
      span.performed !== null &&
      span.isCorrect
  );
  const fullRecoveryStartIndex = findFullRecoveryStartIndex(
    notes,
    intervals,
    contours,
    searchStartIndex
  );

  const recoveredDimensions = {
    pitch: Boolean(pitchRecovery),
    interval: Boolean(intervalRecovery),
    contour: Boolean(contourRecovery),
  };

  if (fullRecoveryStartIndex !== null) {
    return {
      applicable: true,
      kind: 'full_recovery',
      recoveryNoteIndex: fullRecoveryStartIndex,
      pitchRecoveryIndex: pitchRecovery?.index ?? fullRecoveryStartIndex,
      intervalRecoveryIndex: intervalRecovery?.toIndex ?? null,
      contourRecoveryIndex: contourRecovery?.toIndex ?? null,
      recoveredDimensions,
      intervalRescue: {
        applicable: false,
        startIndex: null,
        endIndex: null,
        rescuedNoteIndices: [],
        comparableIntervalCount: 0,
        directionMatchRatio: null,
        intervalCloseness: null,
        rejoinedTarget: false,
        creditPerNote: 0,
      },
    };
  }

  const recoveredDimensionCount = Object.values(recoveredDimensions).filter(Boolean).length;
  let kind: RecoveryKind = 'no_recovery';

  if (recoveredDimensionCount > 1) {
    kind = 'partial_recovery';
  } else if (recoveredDimensions.pitch) {
    kind = 'pitch_recovery';
  } else if (recoveredDimensions.interval) {
    kind = 'interval_recovery';
  } else if (recoveredDimensions.contour) {
    kind = 'contour_recovery';
  }

  return {
    applicable: true,
    kind,
    recoveryNoteIndex:
      pitchRecovery?.index ?? intervalRecovery?.toIndex ?? contourRecovery?.toIndex ?? null,
    pitchRecoveryIndex: pitchRecovery?.index ?? null,
    intervalRecoveryIndex: intervalRecovery?.toIndex ?? null,
    contourRecoveryIndex: contourRecovery?.toIndex ?? null,
    recoveredDimensions,
    intervalRescue: {
      applicable: false,
      startIndex: null,
      endIndex: null,
      rescuedNoteIndices: [],
      comparableIntervalCount: 0,
      directionMatchRatio: null,
      intervalCloseness: null,
      rejoinedTarget: false,
      creditPerNote: 0,
    },
  };
}

function intervalDirection(semitones: number): ContourDirection {
  if (semitones > 0) {
    return 'up';
  }
  if (semitones < 0) {
    return 'down';
  }
  return 'same';
}

function scoreIntervalCloseness(expected: number, performed: number): number {
  const difference = Math.abs(expected - performed);
  if (difference === 0) {
    return 1;
  }
  if (difference === 1) {
    return 0.82;
  }
  if (difference === 2) {
    return 0.58;
  }
  if (difference === 3) {
    return 0.3;
  }
  return 0;
}

// Returns all maximal runs of incorrect notes (with both target and performed present).
// Each cluster is a candidate for interval rescue.
function findMistakeClusters(
  notes: PitchAssessmentNote[],
): Array<{ startIndex: number; endIndex: number }> {
  const clusters: Array<{ startIndex: number; endIndex: number }> = [];
  let clusterStart: number | null = null;

  for (let i = 0; i < notes.length; i += 1) {
    const isIncorrect =
      notes[i].matchKind === 'incorrect' &&
      notes[i].target !== null &&
      notes[i].performed !== null;

    if (isIncorrect) {
      if (clusterStart === null) {
        clusterStart = i;
      }
    } else if (clusterStart !== null) {
      clusters.push({ startIndex: clusterStart, endIndex: i - 1 });
      clusterStart = null;
    }
  }

  if (clusterStart !== null) {
    clusters.push({ startIndex: clusterStart, endIndex: notes.length - 1 });
  }

  return clusters;
}

// Replaces the original single-divergence rescue with a multi-cluster pass.
// Each small cluster of consecutive incorrect notes is evaluated independently.
// Clusters longer than maxClusterSize are skipped — sustained wrong sections
// should not qualify, only local slips with clear recovery.
function applyMultiClusterIntervalRescue(
  notes: PitchAssessmentNote[],
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[],
  firstDivergence: FirstDivergencePoint | null,
  globalRelationship: GlobalRelationshipKind,
  recovery: RecoveryAssessment,
): { notes: PitchAssessmentNote[]; recovery: RecoveryAssessment } {
  if (
    !firstDivergence ||
    globalRelationship === 'exact_match' ||
    globalRelationship === 'octave_shifted' ||
    globalRelationship === 'globally_transposed'
  ) {
    return { notes, recovery };
  }

  const clusters = findMistakeClusters(notes).filter(
    (cluster) =>
      cluster.endIndex - cluster.startIndex + 1 <= INTERVAL_RECOVERY_CONFIG.maxClusterSize,
  );

  if (clusters.length === 0) {
    return { notes, recovery };
  }

  let rescuedNotes = notes;
  const allRescuedIndices: number[] = [];
  // Track the first qualifying cluster for the intervalRescue summary field.
  let firstRescuedCluster: {
    startIndex: number;
    endIndex: number;
    comparableIntervalCount: number;
    directionMatchRatio: number;
    intervalCloseness: number;
    rejoinedTarget: boolean;
    creditPerNote: number;
  } | null = null;

  for (const cluster of clusters) {
    const windowEndIndex = Math.min(
      notes.length - 1,
      cluster.endIndex + INTERVAL_RECOVERY_CONFIG.lookaheadNotes,
    );

    let comparableIntervalCount = 0;
    let directionMatchCount = 0;
    let closenessTotal = 0;

    for (let index = cluster.startIndex; index < windowEndIndex; index += 1) {
      const targetCurrent = targetMelody[index];
      const targetNext = targetMelody[index + 1];
      const performedCurrent = performedMelody[index];
      const performedNext = performedMelody[index + 1];

      if (!targetCurrent || !targetNext || !performedCurrent || !performedNext) {
        continue;
      }

      const expectedInterval = targetNext.midi - targetCurrent.midi;
      const performedInterval = performedNext.midi - performedCurrent.midi;
      comparableIntervalCount += 1;

      if (intervalDirection(expectedInterval) === intervalDirection(performedInterval)) {
        directionMatchCount += 1;
      }
      closenessTotal += scoreIntervalCloseness(expectedInterval, performedInterval);
    }

    const directionMatchRatio =
      comparableIntervalCount > 0 ? directionMatchCount / comparableIntervalCount : 0;
    const intervalCloseness =
      comparableIntervalCount > 0 ? closenessTotal / comparableIntervalCount : 0;
    // Use the original notes array for the rejoined check so earlier rescued clusters
    // do not influence whether a later cluster appears to re-align with the target.
    const rejoinedTarget = notes.some(
      (note, index) =>
        index > cluster.startIndex &&
        index <= windowEndIndex &&
        note.target !== null &&
        note.performed !== null &&
        ((note.absDelta ?? Number.POSITIVE_INFINITY) <= 1 || note.isCorrect),
    );
    const windowScore =
      directionMatchRatio * 0.45 +
      intervalCloseness * 0.4 +
      (rejoinedTarget ? 0.15 : 0);

    const qualifies =
      comparableIntervalCount >= INTERVAL_RECOVERY_CONFIG.minimumComparableIntervals &&
      directionMatchRatio >= INTERVAL_RECOVERY_CONFIG.minimumDirectionMatchRatio &&
      intervalCloseness >= INTERVAL_RECOVERY_CONFIG.minimumIntervalCloseness &&
      windowScore >= INTERVAL_RECOVERY_CONFIG.minimumWindowScore;

    if (!qualifies) {
      continue;
    }

    const creditPerNote = Math.min(
      INTERVAL_RECOVERY_CONFIG.maxCreditPerNote,
      INTERVAL_RECOVERY_CONFIG.baseCreditPerNote +
        Math.max(0, windowScore - INTERVAL_RECOVERY_CONFIG.minimumWindowScore) * 0.5 +
        (rejoinedTarget ? 0.08 : 0),
    );

    const clusterRescuedIndices: number[] = [];
    rescuedNotes = rescuedNotes.map((note, index) => {
      const inCluster = index >= cluster.startIndex && index <= cluster.endIndex;
      const canRescue =
        inCluster &&
        clusterRescuedIndices.length < INTERVAL_RECOVERY_CONFIG.maxRescuedNotes &&
        note.target !== null &&
        note.performed !== null &&
        note.matchKind === 'incorrect' &&
        (note.absDelta ?? Number.POSITIVE_INFINITY) <= 4;

      if (!canRescue) {
        return note;
      }

      clusterRescuedIndices.push(index);
      return {
        ...note,
        intervalRecoveryApplied: true,
        intervalRecoveryCredit: roundFit(creditPerNote),
        interpretationReason:
          'Absolute pitch diverged here, but the next notes preserved a close local interval pattern and showed recovery.',
      };
    });

    allRescuedIndices.push(...clusterRescuedIndices);

    if (firstRescuedCluster === null && clusterRescuedIndices.length > 0) {
      firstRescuedCluster = {
        startIndex: cluster.startIndex,
        endIndex: windowEndIndex,
        comparableIntervalCount,
        directionMatchRatio,
        intervalCloseness,
        rejoinedTarget,
        creditPerNote,
      };
    }
  }

  if (allRescuedIndices.length === 0) {
    return { notes, recovery };
  }

  const s = firstRescuedCluster!;
  return {
    notes: rescuedNotes,
    recovery: {
      ...recovery,
      intervalRescue: {
        applicable: true,
        startIndex: s.startIndex,
        endIndex: s.endIndex,
        rescuedNoteIndices: allRescuedIndices,
        comparableIntervalCount: s.comparableIntervalCount,
        directionMatchRatio: roundFit(s.directionMatchRatio),
        intervalCloseness: roundFit(s.intervalCloseness),
        rejoinedTarget: s.rejoinedTarget,
        creditPerNote: roundFit(s.creditPerNote),
      },
    },
  };
}

function assessTonalState(
  notes: PitchAssessmentNote[],
  intervals: IntervalAssessmentSpan[],
  contours: ContourAssessmentSpan[],
  targetMelody: AssessmentMelodyNote[],
  performedMelody: AssessmentMelodyNote[],
  firstDivergence: FirstDivergencePoint | null,
  recovery: RecoveryAssessment,
  globalRelationship: GlobalRelationshipKind
): TonalStateAssessment {
  const targetFrame = inferTargetTonalFrame(targetMelody);

  if (
    targetMelody.length === 0 ||
    performedMelody.length === 0 ||
    targetFrame.tonicPitchClass === null ||
    targetFrame.mode === null
  ) {
    return {
      applicable: false,
      kind: 'not_applicable',
      targetTonicPitchClass: targetFrame.tonicPitchClass,
      targetMode: targetFrame.mode,
      alternateTonicPitchClass: null,
      alignedWithTargetBeforeDivergence: null,
      returnedToTargetFrameAfterRecovery: null,
      likelyAlternateTonicAfterDivergence: null,
      structuralConsistency: {
        evaluatedStartIndex: null,
        evaluatedEndIndex: null,
        noteCount: 0,
        intervalCount: 0,
        contourCount: 0,
        intervalConsistency: null,
        contourConsistency: null,
        pitchOffsetVariance: null,
        dominantPitchOffset: null,
        dominantPitchOffsetSupport: null,
        stronglyConsistent: false,
      },
      finalSegment: {
        startIndex: null,
        endIndex: null,
        noteCount: 0,
        targetFit: null,
        shiftedFit: null,
        shiftedTonicPitchClass: null,
        betterAlignedWithTargetEnding: null,
      },
      windows: {
        preDivergence: {
          label: 'pre_divergence',
          startIndex: 0,
          endIndex: null,
          noteCount: 0,
          targetFit: null,
          alternateFit: null,
          alternateTonicPitchClass: null,
          classification: 'insufficient_data',
        },
        postDivergence: null,
        postRecovery: null,
      },
    };
  }

  const structuralConsistency = (() => {
    if (!firstDivergence) {
      return {
        evaluatedStartIndex: null,
        evaluatedEndIndex: null,
        noteCount: 0,
        intervalCount: 0,
        contourCount: 0,
        intervalConsistency: null,
        contourConsistency: null,
        pitchOffsetVariance: null,
        dominantPitchOffset: null,
        dominantPitchOffsetSupport: null,
        stronglyConsistent: false,
      };
    }

    const evaluatedStartIndex = firstDivergence.noteIndex;
    const evaluatedEndIndex =
      recovery.recoveryNoteIndex !== null
        ? Math.max(evaluatedStartIndex, recovery.recoveryNoteIndex - 1)
        : notes.length - 1;
    const spanNotes = notes.filter(
      (note) =>
        note.index >= evaluatedStartIndex &&
        note.index <= evaluatedEndIndex &&
        note.target !== null &&
        note.performed !== null &&
        typeof note.semitoneDelta === 'number'
    );
    const spanIntervals = intervals.filter(
      (span) =>
        span.fromIndex >= evaluatedStartIndex &&
        span.toIndex <= evaluatedEndIndex &&
        span.expectedSemitones !== null &&
        span.performedSemitones !== null
    );
    const spanContours = contours.filter(
      (span) =>
        span.fromIndex >= evaluatedStartIndex &&
        span.toIndex <= evaluatedEndIndex &&
        span.expected !== null &&
        span.performed !== null
    );
    const offsets = spanNotes.map((note) => note.semitoneDelta as number);
    const dominantOffsetCounts = new Map<number, number>();
    offsets.forEach((offset) => {
      dominantOffsetCounts.set(offset, (dominantOffsetCounts.get(offset) ?? 0) + 1);
    });
    let dominantPitchOffset: number | null = null;
    let dominantPitchOffsetCount = 0;
    dominantOffsetCounts.forEach((count, offset) => {
      if (count > dominantPitchOffsetCount) {
        dominantPitchOffset = offset;
        dominantPitchOffsetCount = count;
      }
    });
    const intervalConsistency =
      spanIntervals.length > 0
        ? spanIntervals.filter((span) => span.isCorrect).length / spanIntervals.length
        : null;
    const contourConsistency =
      spanContours.length > 0
        ? spanContours.filter((span) => span.isCorrect).length / spanContours.length
        : null;
    const pitchOffsetVariance = offsets.length > 1 ? variance(offsets) : null;
    const dominantPitchOffsetSupport =
      offsets.length > 0 ? dominantPitchOffsetCount / offsets.length : null;
    const averageAbsoluteOffset =
      offsets.length > 0 ? mean(offsets.map((offset) => Math.abs(offset))) : 0;
    const mostlyShifted =
      dominantPitchOffset !== null &&
      Math.abs(dominantPitchOffset) >= 2 &&
      averageAbsoluteOffset >= 1.75;
    const stronglyConsistent =
      spanNotes.length >= 3 &&
      spanIntervals.length >= 2 &&
      spanContours.length >= 2 &&
      mostlyShifted &&
      (intervalConsistency ?? 0) >= 0.8 &&
      (contourConsistency ?? 0) >= 0.8 &&
      (dominantPitchOffsetSupport ?? 0) >= 0.75 &&
      (pitchOffsetVariance ?? Number.POSITIVE_INFINITY) <= 0.75;

    return {
      evaluatedStartIndex,
      evaluatedEndIndex,
      noteCount: spanNotes.length,
      intervalCount: spanIntervals.length,
      contourCount: spanContours.length,
      intervalConsistency:
        intervalConsistency === null ? null : roundFit(intervalConsistency),
      contourConsistency:
        contourConsistency === null ? null : roundFit(contourConsistency),
      pitchOffsetVariance:
        pitchOffsetVariance === null ? null : roundFit(pitchOffsetVariance),
      dominantPitchOffset,
      dominantPitchOffsetSupport:
        dominantPitchOffsetSupport === null ? null : roundFit(dominantPitchOffsetSupport),
      stronglyConsistent,
    };
  })();

  const preDivergenceEndIndex =
    firstDivergence ? Math.max(0, firstDivergence.noteIndex - 1) : performedMelody.length - 1;
  const preDivergence =
    firstDivergence && firstDivergence.noteIndex === 0
      ? {
          label: 'pre_divergence' as const,
          startIndex: 0,
          endIndex: -1,
          noteCount: 0,
          targetFit: null,
          alternateFit: null,
          alternateTonicPitchClass: null,
          classification: 'insufficient_data' as TonalWindowKind,
        }
      : analyzeTonalWindow('pre_divergence', performedMelody, 0, preDivergenceEndIndex, targetFrame);

  const postDivergence = firstDivergence
    ? analyzeTonalWindow(
        'post_divergence',
        performedMelody,
        firstDivergence.noteIndex,
        performedMelody.length - 1,
        targetFrame
      )
    : null;

  const postRecovery =
    recovery.recoveryNoteIndex !== null
      ? analyzeTonalWindow(
          'post_recovery',
          performedMelody,
          recovery.recoveryNoteIndex,
          performedMelody.length - 1,
          targetFrame
        )
      : null;

  const alignedWithTargetBeforeDivergence =
    preDivergence.classification === 'aligned_target'
      ? true
      : preDivergence.classification === 'insufficient_data'
        ? null
        : false;
  const returnedToTargetFrameAfterRecovery =
    postRecovery?.classification === 'aligned_target'
      ? true
      : postRecovery?.classification === 'insufficient_data' || !postRecovery
        ? null
        : false;
  const likelyAlternateTonicAfterDivergence =
    postDivergence?.classification === 'leaning_alternate'
      ? true
      : postDivergence?.classification === 'insufficient_data' || !postDivergence
        ? null
        : false;

  const finalSegment = (() => {
    const dominantPitchOffset = structuralConsistency.dominantPitchOffset;
    if (
      performedMelody.length < 2 ||
      targetFrame.tonicPitchClass === null ||
      targetFrame.mode === null ||
      dominantPitchOffset === null
    ) {
      return {
        startIndex: null,
        endIndex: null,
        noteCount: 0,
        targetFit: null,
        shiftedFit: null,
        shiftedTonicPitchClass: null,
        betterAlignedWithTargetEnding: null,
      };
    }

    const shiftedTonicPitchClass =
      normalizePitchClassDelta(targetFrame.tonicPitchClass + dominantPitchOffset);
    const endIndex = performedMelody.length - 1;
    const startIndex = Math.max(
      firstDivergence?.noteIndex ?? 0,
      performedMelody.length - Math.min(3, performedMelody.length)
    );
    const finalNotes = performedMelody.slice(startIndex, endIndex + 1);

    if (finalNotes.length < 2) {
      return {
        startIndex,
        endIndex,
        noteCount: finalNotes.length,
        targetFit: null,
        shiftedFit: null,
        shiftedTonicPitchClass,
        betterAlignedWithTargetEnding: null,
      };
    }

    const targetFit = scoreWindowAgainstTonic(
      finalNotes,
      targetFrame.tonicPitchClass,
      targetFrame.mode
    );
    const shiftedFit = scoreWindowAgainstTonic(
      finalNotes,
      shiftedTonicPitchClass,
      targetFrame.mode
    );
    const betterAlignedWithTargetEnding =
      targetFit >= 0.68 && targetFit - shiftedFit >= 0.08;

    return {
      startIndex,
      endIndex,
      noteCount: finalNotes.length,
      targetFit: roundFit(targetFit),
      shiftedFit: roundFit(shiftedFit),
      shiftedTonicPitchClass,
      betterAlignedWithTargetEnding,
    };
  })();

  let kind: TonalStateKind = 'unknown';

  if (
    globalRelationship === 'exact_match' ||
    globalRelationship === 'octave_shifted' ||
    (globalRelationship === 'unclassified' && preDivergence.classification === 'aligned_target')
  ) {
    kind = 'stable_target_tonic';
  } else if (
    globalRelationship === 'globally_transposed' &&
    (postDivergence?.classification === 'leaning_alternate' ||
      preDivergence.classification === 'leaning_alternate')
  ) {
    kind = 'recentered_new_tonic';
  } else if (finalSegment.betterAlignedWithTargetEnding) {
    kind = 'recovered_target_tonic';
  } else if (postRecovery?.classification === 'aligned_target') {
    kind = 'recovered_target_tonic';
  } else if (
    structuralConsistency.stronglyConsistent &&
    (postRecovery?.classification === 'leaning_alternate' ||
      postDivergence?.classification === 'leaning_alternate')
  ) {
    kind = 'recentered_new_tonic';
  } else if (recovery.applicable && recovery.kind && recovery.kind !== 'no_recovery') {
    kind = 'structurally_recovered_only';
  } else if (
    preDivergence.classification === 'ambiguous' ||
    postDivergence?.classification === 'ambiguous' ||
    postRecovery?.classification === 'ambiguous'
  ) {
    kind = 'ambiguous';
  }

  return {
    applicable: true,
    kind,
    targetTonicPitchClass: targetFrame.tonicPitchClass,
    targetMode: targetFrame.mode,
    alternateTonicPitchClass:
      postRecovery?.alternateTonicPitchClass ??
      postDivergence?.alternateTonicPitchClass ??
      preDivergence.alternateTonicPitchClass,
    alignedWithTargetBeforeDivergence,
    returnedToTargetFrameAfterRecovery,
    likelyAlternateTonicAfterDivergence,
    structuralConsistency,
    finalSegment,
    windows: {
      preDivergence,
      postDivergence,
      postRecovery,
    },
  };
}

function applyTransposedConsistencyInterpretation(
  notes: PitchAssessmentNote[],
  tonalState: TonalStateAssessment
): PitchAssessmentNote[] {
  if (
    tonalState.kind !== 'recentered_new_tonic' ||
    !tonalState.structuralConsistency.stronglyConsistent ||
    tonalState.structuralConsistency.evaluatedStartIndex === null ||
    tonalState.structuralConsistency.evaluatedEndIndex === null
  ) {
    return notes;
  }

  const { evaluatedStartIndex, evaluatedEndIndex, dominantPitchOffset } =
    tonalState.structuralConsistency;

  return notes.map((note) => {
    const inConsistentShiftSpan =
      note.index >= evaluatedStartIndex && note.index <= evaluatedEndIndex;
    const offsetMatchesShift =
      typeof note.semitoneDelta === 'number' &&
      dominantPitchOffset !== null &&
      Math.abs(note.semitoneDelta - dominantPitchOffset) <= 1;

    if (
      !inConsistentShiftSpan ||
      note.matchKind !== 'incorrect' ||
      !note.target ||
      !note.performed ||
      !offsetMatchesShift
    ) {
      return note;
    }

    return {
      ...note,
      displayState: 'transposed_consistent',
      interpretationReason:
        'You shifted away from the original key, but the phrase stayed interval-consistent in a new tonal center.',
    };
  });
}

export function evaluateMelodyAssessment(
  input: EvaluateMelodyAssessmentInput
): MelodyAssessmentResult {
  const mode = input.mode ?? 'literal';
  const targetMelody = normalizeAssessmentMelody(input.targetMelody);
  const performedMelody = normalizeAssessmentMelody(input.performedMelody);
  const globalRelationship = classifyGlobalRelationship(targetMelody, performedMelody);

  const rawNotes = buildPitchAssessments(
    targetMelody,
    performedMelody,
    mode,
    globalRelationship
  );
  const globalOffsetCorrection = detectDominantGlobalOffset(rawNotes, input);
  const notes = globalOffsetCorrection.applied && globalOffsetCorrection.candidateOffset !== null
    ? buildPitchAssessments(
        targetMelody,
        performedMelody,
        mode,
        globalRelationship,
        globalOffsetCorrection.candidateOffset,
        rawNotes
      )
    : rawNotes;
  const intervals = buildIntervalAssessments(targetMelody, performedMelody);
  const contours = buildContourAssessments(targetMelody, performedMelody);
  const firstDivergence = findFirstDivergence(notes, intervals, contours);
  const recovery = assessRecovery(notes, intervals, contours, firstDivergence, globalRelationship.kind);
  const tonalState = assessTonalState(
    notes,
    intervals,
    contours,
    targetMelody,
    performedMelody,
    firstDivergence,
    recovery,
    globalRelationship.kind
  );
  const rhythm = assessRhythm(targetMelody, input);
  const intervalRecoveryAdjusted = applyMultiClusterIntervalRescue(
    notes,
    targetMelody,
    performedMelody,
    firstDivergence,
    globalRelationship.kind,
    recovery,
  );
  const interpretedNotes = applyTransposedConsistencyInterpretation(
    intervalRecoveryAdjusted.notes,
    tonalState,
  );

  const pitchCorrectCount = interpretedNotes.filter((note) => note.isCorrect).length;
  const pitchIncorrectCount = interpretedNotes.length - pitchCorrectCount;
  const intervalCorrectCount = intervals.filter((span) => span.isCorrect).length;
  const intervalIncorrectCount = intervals.length - intervalCorrectCount;
  const contourCorrectCount = contours.filter((span) => span.isCorrect).length;
  const contourIncorrectCount = contours.length - contourCorrectCount;
  const rhythmScore = Math.round(rhythm.accuracy.score * 100);

  return {
    summary: {
      comparisonMode: mode,
      globalRelationship: globalRelationship.kind,
      recoveryKind: intervalRecoveryAdjusted.recovery.kind,
      tonalStateKind: tonalState.kind,
      transpositionSemitoneOffset: globalRelationship.semitoneDelta,
      transpositionPitchClassOffset: globalRelationship.pitchClassDelta,
      transpositionLockedPhraseWide: globalRelationship.phraseOffsetLocked,
      targetNoteCount: targetMelody.length,
      performedNoteCount: performedMelody.length,
      pitchCorrectCount,
      pitchIncorrectCount,
      intervalCorrectCount,
      intervalIncorrectCount,
      contourCorrectCount,
      contourIncorrectCount,
      firstDivergenceIndex: firstDivergence?.noteIndex ?? null,
      literalPitchFullyCorrect:
        notes.length > 0 &&
        targetMelody.length === performedMelody.length &&
        pitchIncorrectCount === 0,
      contourFullyCorrect:
        contours.length === 0 || contourIncorrectCount === 0,
    },
    notes: interpretedNotes,
    intervals,
    contours,
    firstDivergence,
    recovery: intervalRecoveryAdjusted.recovery,
    tonalState,
    rhythm,
    scores: {
      pitchScore: 0,
      rhythmScore,
      melodicScore: Math.round(rhythmScore / 2),
    },
    validity: {
      isValid: true,
      coverage: 1,
      weakRatio: 0,
      contourRecognizable: true,
      flowScore: rhythm.flow.score,
      comparableRhythmSpanCount: rhythm.accuracy.comparableSpanCount,
      reason: 'Validity is finalized after microphone-run scoring.',
    },
    globalOffsetCorrection,
    future: {
      interval: null,
      tonal: null,
      drift: null,
      recovery: null,
    },
  };
}

export function normalizeAssessmentMelodyEvents(melody: MelodyEvent[]): AssessmentMelodyNote[] {
  return normalizeAssessmentMelody(melody);
}
