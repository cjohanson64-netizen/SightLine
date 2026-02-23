import { buildTonnetz } from '../src/core/tonnetz/buildTonnetz';
import { buildHarmonySpine } from '../src/core/generator/harmony';
import { createMelodyCandidates } from '../src/core/generator/melody';
import { createRng } from '../src/utils/rng';
import type { ExerciseSpec } from '../src/tat/models/schema';

type Bucket = '1' | '5' | 'other';
type LeapBucket = 'leap' | 'step' | 'other';

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

function modeScale(mode: ExerciseSpec['mode']): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}

function midiToDegree(midi: number, keyScale: number[]): number {
  const pc = ((midi % 12) + 12) % 12;
  const idx = keyScale.indexOf(pc);
  return idx === -1 ? -1 : idx + 1;
}

function classifyDegree(degree: number): Bucket {
  if (degree === 1) {
    return '1';
  }
  if (degree === 5) {
    return '5';
  }
  return 'other';
}

function classifyInterval(interval: number): LeapBucket {
  const abs = Math.abs(interval);
  if (abs >= 3) {
    return 'leap';
  }
  if (abs <= 2 && abs > 0) {
    return 'step';
  }
  return 'other';
}

const spec: ExerciseSpec = {
  title: 'Generator Debug Report',
  startingDegree: 1,
  key: 'C',
  mode: 'major',
  clef: 'treble',
  range: {
    lowDegree: 1,
    highDegree: 1,
    lowOctave: 4,
    highOctave: 5
  },
  phraseLengthMeasures: 4,
  phrases: [{ label: 'A', prime: false, cadence: 'authentic' }],
  timeSig: '4/4',
  chromatic: false,
  illegalDegrees: [],
  illegalIntervalsSemis: [],
  illegalTransitions: []
};

const samples = 50;
const starts: Record<Bucket, number> = { '1': 0, '5': 0, other: 0 };
const ends: Record<Bucket, number> = { '1': 0, '5': 0, other: 0 };
const intoClimax: Record<LeapBucket, number> = { leap: 0, step: 0, other: 0 };
const outOfClimax: Record<LeapBucket, number> = { leap: 0, step: 0, other: 0 };
let outStepwiseDown = 0;
let tieMergedCount = 0;
let smoothingUsedCount = 0;
let measured = 0;

const tonicPc = KEY_TO_PC[spec.key] ?? 0;
const keyScale = modeScale(spec.mode).map((step) => (tonicPc + step) % 12);
const tonnetz = buildTonnetz(spec.key);

for (let i = 0; i < samples; i += 1) {
  const seed = 20260220 + i * 97;
  const harmony = buildHarmonySpine(spec, tonnetz, createRng(seed));
  const generated = createMelodyCandidates(spec, harmony, tonnetz, seed);
  if (generated.status !== 'ok' || generated.candidates.length === 0) {
    continue;
  }

  const melody = generated.candidates[0].melody;
  if (melody.length < 3) {
    continue;
  }
  measured += 1;

  starts[classifyDegree(midiToDegree(melody[0].midi, keyScale))] += 1;
  ends[classifyDegree(midiToDegree(melody[melody.length - 1].midi, keyScale))] += 1;

  const maxMidi = melody.reduce((max, event) => Math.max(max, event.midi), Number.NEGATIVE_INFINITY);
  const climaxIndex = melody.findIndex((event) => event.midi === maxMidi);
  if (climaxIndex > 0 && climaxIndex < melody.length - 1) {
    const into = melody[climaxIndex].midi - melody[climaxIndex - 1].midi;
    const out = melody[climaxIndex + 1].midi - melody[climaxIndex].midi;
    intoClimax[classifyInterval(into)] += 1;
    outOfClimax[classifyInterval(out)] += 1;
    if (out < 0 && Math.abs(out) <= 2) {
      outStepwiseDown += 1;
    }
  }

  tieMergedCount += melody.filter((event) => event.tieStart === true || event.reason.includes('tieMerge')).length;
  smoothingUsedCount += melody.filter((event) => (event.durationBeats ?? 0) === 0.5).length;
}

console.log(
  JSON.stringify(
    {
      samplesRequested: samples,
      samplesMeasured: measured,
      startDegreeDistribution: starts,
      endDegreeDistribution: ends,
      intoClimaxIntervals: intoClimax,
      outOfClimaxIntervals: outOfClimax,
      outOfClimaxStepwiseDownCount: outStepwiseDown,
      rhythmStats: {
        tieMergeEvents: tieMergedCount,
        smoothingEighthEvents: smoothingUsedCount,
        eePairsApprox: Math.floor(smoothingUsedCount / 2)
      }
    },
    null,
    2
  )
);
