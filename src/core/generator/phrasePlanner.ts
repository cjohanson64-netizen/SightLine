import type { ExerciseSpec, PhraseSpec } from '../../tat/models/schema';

export type PhraseDirection = 'ascending' | 'descending' | 'arch' | 'invertedArch' | 'wave';

export type PhraseTarget = {
  measure: number;
  beat: number;
  targetDegree: number;
  priority: 'low' | 'medium' | 'high';
};

export type PhrasePlan = {
  direction: PhraseDirection;
  peakMeasure: number;
  peakDegree: number;
  startDegree: number;
  cadenceDegrees: number[];
  targets: PhraseTarget[];
};

interface PhrasePlannerInput {
  measures: number;
  timeSignature: string;
  key: string;
  mode: 'major' | 'minor';
  range: ExerciseSpec['range'];
  difficulty?: number;
  cadence?: PhraseSpec['cadence'];
  startDegree?: 1 | 3 | 5;
  startDegreeLocked?: boolean;
  seed: number;
}

function createSeeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function parseDifficulty(difficulty: PhrasePlannerInput['difficulty']): number {
  return typeof difficulty === 'number' ? Math.max(1, difficulty) : 2;
}

function clampDegree(degree: number, range: ExerciseSpec['range']): number {
  const low = Math.min(range.lowDegree, range.highDegree);
  const high = Math.max(range.lowDegree, range.highDegree);
  return Math.max(low, Math.min(high, degree));
}

function cadenceOptions(cadence: PhraseSpec['cadence']): number[][] {
  if (cadence === 'half') {
    return [
      [2, 5],
      [4, 5]
    ];
  }
  if (cadence === 'plagal') {
    return [[4, 1]];
  }

  return [
    // Default authentic ending targets Do (1); penultimate is Re (2) or Ti (7).
    [2, 1],
    [7, 1]
  ];
}

function pickDefaultStartAnchor(rng: () => number, range: ExerciseSpec['range']): number {
  const options: number[] = [1, 1, 1, 1, 1, 3, 3];
  return clampDegree(pick(rng, options), range);
}

function toDirection(difficulty: number, rng: () => number): PhraseDirection {
  if (difficulty <= 1) {
    return 'arch';
  }
  if (difficulty === 2) {
    return pick(rng, ['arch', 'ascending']);
  }
  if (difficulty === 3) {
    return pick(rng, ['arch', 'ascending', 'descending']);
  }

  return pick(rng, ['arch', 'ascending', 'descending', 'wave', 'invertedArch']);
}

function defaultPeakMeasure(measures: number, rng: () => number): number {
  if (measures === 4) {
    return pick(rng, [2, 3]);
  }
  if (measures === 8) {
    return pick(rng, [4, 5]);
  }

  const a = Math.max(2, Math.floor(measures / 2));
  const b = Math.min(measures - 1, a + 1);
  return pick(rng, [a, b]);
}

function interpolateDegree(
  direction: PhraseDirection,
  measure: number,
  measures: number,
  startDegree: number,
  peakDegree: number,
  cadenceLead: number,
  peakMeasure: number
): number {
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const toInt = (n: number): number => Math.round(n);

  if (direction === 'ascending') {
    const t = (measure - 1) / Math.max(1, measures - 1);
    return toInt(lerp(startDegree, Math.max(peakDegree, cadenceLead), t));
  }

  if (direction === 'descending') {
    const startHigh = Math.max(startDegree, peakDegree);
    const t = (measure - 1) / Math.max(1, measures - 1);
    return toInt(lerp(startHigh, cadenceLead, t));
  }

  if (direction === 'invertedArch') {
    if (measure <= peakMeasure) {
      const t = (measure - 1) / Math.max(1, peakMeasure - 1);
      return toInt(lerp(startDegree, cadenceLead, t));
    }
    const t = (measure - peakMeasure) / Math.max(1, measures - peakMeasure);
    return toInt(lerp(cadenceLead, peakDegree, t));
  }

  if (direction === 'wave') {
    const t = (measure - 1) / Math.max(1, measures - 1);
    const wave = Math.sin(t * Math.PI * 2);
    const mid = (startDegree + cadenceLead) / 2;
    const amp = Math.max(1, Math.abs(peakDegree - mid));
    return toInt(mid + amp * wave);
  }

  if (measure <= peakMeasure) {
    const t = (measure - 1) / Math.max(1, peakMeasure - 1);
    return toInt(lerp(startDegree, peakDegree, t));
  }

  const t = (measure - peakMeasure) / Math.max(1, measures - peakMeasure);
  return toInt(lerp(peakDegree, cadenceLead, t));
}

export function generatePhrasePlan(input: PhrasePlannerInput): PhrasePlan {
  const rng = createSeeded(input.seed);
  const difficulty = parseDifficulty(input.difficulty);
  const beatsPerMeasure = Math.max(1, Number(input.timeSignature.split('/')[0]) || 4);

  const direction = toDirection(difficulty, rng);

  // If caller locks a start degree, that hard boundary overrides defaults.
  const startDegree =
    input.startDegreeLocked && input.startDegree !== undefined
      ? clampDegree(input.startDegree, input.range)
      : pickDefaultStartAnchor(rng, input.range);

  const peakMeasure = defaultPeakMeasure(input.measures, rng);

  const peakDegreeOptions =
    difficulty <= 1 ? [3, 5] : difficulty === 2 ? [5] : [5, 6];
  let peakDegree = clampDegree(pick(rng, peakDegreeOptions), input.range);
  if (peakDegree === startDegree) {
    peakDegree = clampDegree(Math.min(7, peakDegree + 1), input.range);
  }

  const cadenceType = input.cadence ?? 'authentic';
  const cadenceTemplate = pick(rng, cadenceOptions(cadenceType));
  const cadenceDegrees = cadenceTemplate.map((degree) => clampDegree(degree, input.range));

  const targets: PhraseTarget[] = [];

  for (let measure = 1; measure <= input.measures; measure += 1) {
    const degree = clampDegree(
      interpolateDegree(
        direction,
        measure,
        input.measures,
        startDegree,
        peakDegree,
        cadenceDegrees[0] ?? 1,
        peakMeasure
      ),
      input.range
    );

    targets.push({
      measure,
      beat: 1,
      targetDegree: measure === 1 ? startDegree : degree,
      priority: measure === 1 ? 'high' : 'medium'
    });
  }

  targets.push({
    measure: peakMeasure,
    beat: 1,
    targetDegree: peakDegree,
    priority: 'high'
  });

  if (input.measures >= 4) {
    const midMeasure = Math.max(2, Math.min(input.measures - 1, Math.floor((input.measures + 1) / 2)));
    targets.push({
      measure: midMeasure,
      beat: 1,
      targetDegree: clampDegree(Math.round((startDegree + peakDegree) / 2), input.range),
      priority: 'medium'
    });
  }

  const finalMeasure = input.measures;
  const penultBeat = Math.max(1, beatsPerMeasure - 1);
  const finalBeat = beatsPerMeasure;

  targets.push({
    measure: finalMeasure,
    beat: penultBeat,
    targetDegree: cadenceDegrees[0] ?? 1,
    priority: 'high'
  });

  targets.push({
    measure: finalMeasure,
    beat: finalBeat,
    targetDegree: cadenceDegrees[Math.min(1, cadenceDegrees.length - 1)] ?? cadenceDegrees[0] ?? 1,
    priority: 'high'
  });

  const dedup = new Map<string, PhraseTarget>();
  const priorityWeight: Record<PhraseTarget['priority'], number> = { low: 1, medium: 2, high: 3 };

  for (const target of targets) {
    const key = `${target.measure}:${target.beat}`;
    const prev = dedup.get(key);
    if (!prev || priorityWeight[target.priority] >= priorityWeight[prev.priority]) {
      dedup.set(key, {
        ...target,
        targetDegree: clampDegree(target.targetDegree, input.range)
      });
    }
  }

  const sortedTargets = [...dedup.values()].sort((a, b) => a.measure - b.measure || a.beat - b.beat);

  const lowRegister = input.range.lowOctave <= 3;
  const bridgeDegree = clampDegree(rng() < 0.5 ? 2 : 3, input.range);
  if (lowRegister) {
    const upsertBridge = (measure: number, beat: number): void => {
      const key = `${measure}:${beat}`;
      const existing = dedup.get(key);
      if (!existing) {
        dedup.set(key, { measure, beat, targetDegree: bridgeDegree, priority: 'medium' });
        return;
      }

      dedup.set(key, {
        ...existing,
        targetDegree: bridgeDegree,
        priority: existing.priority === 'high' ? 'high' : 'medium'
      });
    };

    for (let i = 1; i < sortedTargets.length; i += 1) {
      const prev = sortedTargets[i - 1];
      const current = sortedTargets[i];

      if (prev.targetDegree !== 1 || current.targetDegree !== 7) {
        continue;
      }

      if (prev.measure < current.measure) {
        const bridgeMeasure = Math.min(current.measure - 1, prev.measure + 1);
        upsertBridge(bridgeMeasure, 1);
      } else if (prev.measure === current.measure && prev.beat + 1 < current.beat) {
        upsertBridge(prev.measure, prev.beat + 1);
      } else {
        const key = `${current.measure}:${current.beat}`;
        dedup.set(key, {
          ...current,
          targetDegree: bridgeDegree
        });
      }
    }
  }

  return {
    direction,
    peakMeasure,
    peakDegree,
    startDegree,
    cadenceDegrees,
    targets: [...dedup.values()].sort((a, b) => a.measure - b.measure || a.beat - b.beat)
  };
}
