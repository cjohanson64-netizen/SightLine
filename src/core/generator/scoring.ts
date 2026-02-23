import type { AssayMetric, ExerciseSpec, MelodyEvent } from '../../tat/models/schema';
import { getCadenceTransitionSpec, type CadenceType } from './cadenceVoiceLeading';

export interface CandidateScore {
  score: number;
  metrics: AssayMetric[];
}

function rhythmTargetPercents(spec: ExerciseSpec): { whole: number; half: number; quarter: number; eighth: number } {
  const weights = spec.rhythmWeights;
  if (!weights) {
    return { whole: 0, half: 0, quarter: 0, eighth: 0 };
  }
  const sum = weights.whole + weights.half + weights.quarter + weights.eighth;
  if (sum <= 0) {
    return { whole: 0, half: 0, quarter: 0, eighth: 0 };
  }
  return {
    whole: (weights.whole / sum) * 100,
    half: (weights.half / sum) * 100,
    quarter: (weights.quarter / sum) * 100,
    eighth: (weights.eighth / sum) * 100
  };
}

function rhythmActualPercents(melody: MelodyEvent[]): { whole: number; half: number; quarter: number; eighth: number } {
  const counts = { whole: 0, half: 0, quarter: 0, eighth: 0 };
  for (const event of melody) {
    if (event.duration === 'whole') {
      counts.whole += 1;
    } else if (event.duration === 'half') {
      counts.half += 1;
    } else if (event.duration === 'quarter') {
      counts.quarter += 1;
    } else if (event.duration === 'eighth') {
      counts.eighth += 1;
    }
  }
  const total = counts.whole + counts.half + counts.quarter + counts.eighth;
  if (total <= 0) {
    return { whole: 0, half: 0, quarter: 0, eighth: 0 };
  }
  return {
    whole: (counts.whole / total) * 100,
    half: (counts.half / total) * 100,
    quarter: (counts.quarter / total) * 100,
    eighth: (counts.eighth / total) * 100
  };
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

const KEY_TO_PC: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11
};

function modeScale(mode: 'major' | 'minor'): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function cadenceComplianceForPhraseEnds(melody: MelodyEvent[], spec: ExerciseSpec): number {
  if (melody.length < 2 || spec.phrases.length === 0) {
    return 0.5;
  }

  const keyId = melody[0].keyId;
  const [keyNameRaw, modeRaw] = keyId.split('-');
  const tonicPc = KEY_TO_PC[keyNameRaw] ?? 0;
  const mode = modeRaw === 'minor' ? 'minor' : 'major';
  const keyScale = modeScale(mode).map((step) => (tonicPc + step) % 12);
  const degreeOfMidi = (midi: number): number => {
    const pc = ((midi % 12) + 12) % 12;
    const idx = keyScale.indexOf(pc);
    return idx === -1 ? 1 : idx + 1;
  };

  const phraseLengthMeasures = spec.phraseLengthMeasures;
  let sum = 0;
  let count = 0;

  for (let phraseIndex = 0; phraseIndex < spec.phrases.length; phraseIndex += 1) {
    const cadenceType: CadenceType = spec.phrases[phraseIndex].cadence;
    const phraseEndMeasure = (phraseIndex + 1) * phraseLengthMeasures;
    const phraseEvents = melody.filter((event) => event.measure <= phraseEndMeasure);
    if (phraseEvents.length < 2) {
      continue;
    }

    const final = phraseEvents[phraseEvents.length - 1];
    const penult = phraseEvents[phraseEvents.length - 2];
    if (final.measure !== phraseEndMeasure) {
      continue;
    }

    const fromDegree = degreeOfMidi(penult.midi);
    const toDegree = degreeOfMidi(final.midi);
    const transitionSpec = getCadenceTransitionSpec(cadenceType);
    const options = transitionSpec[fromDegree] ?? [];

    let compliance = 0.5;
    if (options.length > 0) {
      const hardOptions = options.filter((option) => option.hard);
      if (hardOptions.length > 0) {
        compliance = hardOptions.some((option) => option.degree === toDegree) ? 1 : 0;
      } else {
        const matched = options.find((option) => option.degree === toDegree);
        compliance = matched ? Math.max(0, Math.min(1, matched.weight)) : 0;
      }
    }

    sum += compliance;
    count += 1;
  }

  return count === 0 ? 0.5 : sum / count;
}

export function scoreMelody(melody: MelodyEvent[], spec: ExerciseSpec): CandidateScore {
  if (melody.length === 0) {
    return {
      score: Number.NEGATIVE_INFINITY,
      metrics: [
        { name: 'empty_penalty', value: -1000 },
        { name: 'stepwise_ratio', value: 0 },
        { name: 'range_span', value: 0 }
      ]
    };
  }

  const allowedSkips = new Set([3, 4, 5, 7]);

  let stepwiseCount = 0;
  let skipCount = 0;
  let leapPenalty = 0;
  let minMidi = melody[0].midi;
  let maxMidi = melody[0].midi;
  let backtrackCount = 0;
  let contourDirectionChanges = 0;
  let previousDirection = 0;

  const intervals: number[] = [];
  const directions: number[] = [];

  for (let i = 1; i < melody.length; i += 1) {
    const delta = melody[i].midi - melody[i - 1].midi;
    const interval = Math.abs(delta);
    intervals.push(interval);
    directions.push(sign(delta));

    if (interval <= 2) {
      stepwiseCount += 1;
    }
    if (allowedSkips.has(interval)) {
      skipCount += 1;
    }
    if (interval > 7) {
      leapPenalty += interval - 7;
    }
    if (i >= 2 && melody[i].midi === melody[i - 2].midi && melody[i - 1].midi !== melody[i].midi) {
      backtrackCount += 1;
    }

    const direction = sign(delta);
    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) {
      contourDirectionChanges += 1;
    }
    if (direction !== 0) {
      previousDirection = direction;
    }

    minMidi = Math.min(minMidi, melody[i].midi);
    maxMidi = Math.max(maxMidi, melody[i].midi);
  }

  let unrepairedLeapCount = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    if (intervals[i] < 3) {
      continue;
    }

    if (i + 1 >= intervals.length) {
      unrepairedLeapCount += 1;
      continue;
    }

    const repaired = intervals[i + 1] <= 2 && directions[i + 1] !== 0 && directions[i + 1] === -directions[i];
    if (!repaired) {
      unrepairedLeapCount += 1;
    }
  }

  const stepwiseRatio = stepwiseCount / Math.max(1, melody.length - 1);
  const skipRate = skipCount / Math.max(1, melody.length - 1);
  const rangeSpan = maxMidi - minMidi;
  const uniquePitchClasses = new Set(melody.map((event) => ((event.midi % 12) + 12) % 12)).size;
  const uniqueMidi = new Set(melody.map((event) => event.midi)).size;
  const varietyRatio = uniqueMidi / melody.length;
  const peakProminence = maxMidi - (melody[0].midi + melody[melody.length - 1].midi) / 2;

  let strongBeatCount = 0;
  let strongBeatChordToneCount = 0;
  for (const event of melody) {
    if (event.beat === 1 || event.beat === 3) {
      strongBeatCount += 1;
      if (event.role === 'ChordTone') {
        strongBeatChordToneCount += 1;
      }
    }
  }
  const strongBeatChordToneRate = strongBeatCount === 0 ? 1 : strongBeatChordToneCount / strongBeatCount;

  const nhtIndices = melody
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.role === 'NonHarmonicTone')
    .map(({ index }) => index);
  let resolvedNhtCount = 0;
  for (const index of nhtIndices) {
    let resolved = false;
    for (let j = index + 1; j < melody.length; j += 1) {
      if (melody[j].beat === 1 || melody[j].beat === 3) {
        resolved = melody[j].role === 'ChordTone';
        break;
      }
    }
    if (resolved) {
      resolvedNhtCount += 1;
    }
  }
  const nhtResolutionRate = nhtIndices.length === 0 ? 1 : resolvedNhtCount / nhtIndices.length;

  const contourScore = Math.max(0, 1 - Math.abs(contourDirectionChanges - 2) / 6);
  // Baseline skip density target: enough shape variety without becoming jumpy.
  const skipRateLowPenalty = skipRate < 0.1 ? (0.1 - skipRate) * 140 : 0;
  const skipRateHighPenalty = skipRate > 0.45 ? (skipRate - 0.45) * 120 : 0;
  const skipRateWindowBonus = skipRate >= 0.15 && skipRate <= 0.35 ? 8 : 0;
  const cadenceCompliance = cadenceComplianceForPhraseEnds(melody, spec);
  const rhythmTarget = rhythmTargetPercents(spec);
  const rhythmActual = rhythmActualPercents(melody);
  const rhythmL1 =
    Math.abs(rhythmActual.whole - rhythmTarget.whole) +
    Math.abs(rhythmActual.half - rhythmTarget.half) +
    Math.abs(rhythmActual.quarter - rhythmTarget.quarter) +
    Math.abs(rhythmActual.eighth - rhythmTarget.eighth);
  const rhythmFit = Math.max(0, 1 - rhythmL1 / 200);
  const highEeNoOutputPenalty = rhythmTarget.eighth >= 40 && rhythmActual.eighth === 0 ? 80 : 0;

  const score =
    stepwiseRatio * 20 +
    varietyRatio * 24 +
    strongBeatChordToneRate * 16 +
    nhtResolutionRate * 20 +
    contourScore * 14 +
    cadenceCompliance * 18 +
    rhythmFit * 50 +
    skipRateWindowBonus +
    Math.min(peakProminence, 12) * 0.9 -
    leapPenalty * 4.2 -
    backtrackCount * 5.5 -
    unrepairedLeapCount * 7 -
    skipRateLowPenalty -
    skipRateHighPenalty -
    highEeNoOutputPenalty -
    Math.max(0, rangeSpan - 18) * 1.1;

  return {
    score,
    metrics: [
      { name: 'stepwise_ratio', value: Number(stepwiseRatio.toFixed(3)) },
      { name: 'skip_rate', value: Number(skipRate.toFixed(3)) },
      { name: 'skip_rate_low_penalty', value: Number(skipRateLowPenalty.toFixed(3)) },
      { name: 'skip_rate_high_penalty', value: Number(skipRateHighPenalty.toFixed(3)) },
      { name: 'variety_ratio', value: Number(varietyRatio.toFixed(3)) },
      { name: 'unique_pitch_classes', value: uniquePitchClasses },
      { name: 'backtrack_count', value: backtrackCount },
      { name: 'unrepaired_leap_count', value: unrepairedLeapCount },
      { name: 'contour_direction_changes', value: contourDirectionChanges },
      { name: 'contour_score', value: Number(contourScore.toFixed(3)) },
      { name: 'peak_prominence', value: Number(peakProminence.toFixed(3)) },
      { name: 'strong_beat_chord_tone_rate', value: Number(strongBeatChordToneRate.toFixed(3)) },
      { name: 'nht_resolution_rate', value: Number(nhtResolutionRate.toFixed(3)) },
      { name: 'cadence_compliance', value: Number(cadenceCompliance.toFixed(3)) },
      { name: 'rhythm_fit', value: Number(rhythmFit.toFixed(3)) },
      { name: 'rhythm_target_eighth_pct', value: Number(rhythmTarget.eighth.toFixed(1)) },
      { name: 'rhythm_actual_eighth_pct', value: Number(rhythmActual.eighth.toFixed(1)) },
      { name: 'rhythm_high_ee_no_output_penalty', value: highEeNoOutputPenalty },
      { name: 'leap_penalty', value: leapPenalty },
      { name: 'range_span', value: rangeSpan },
      { name: 'overall_score', value: Number(score.toFixed(3)) }
    ]
  };
}
