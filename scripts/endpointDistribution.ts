import { buildTonnetz } from '../src/core/tonnetz/buildTonnetz';
import { buildHarmonySpine } from '../src/core/generator/harmony';
import { createMelodyCandidates } from '../src/core/generator/melody';
import { createRng } from '../src/utils/rng';
import type { ExerciseSpec, MelodyEvent } from '../src/tat/models/schema';

function modeScale(mode: ExerciseSpec['mode']): number[] {
  return mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
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

function midiToDegree(midi: number, keyScale: number[]): number {
  const pc = ((midi % 12) + 12) % 12;
  const idx = keyScale.indexOf(pc);
  return idx === -1 ? -1 : idx + 1;
}

function classify(degree: number): '1' | '5' | 'other' {
  if (degree === 1) {
    return '1';
  }
  if (degree === 5) {
    return '5';
  }
  return 'other';
}

function distributionForSamples(spec: ExerciseSpec, seed: number, samples: number): {
  start: Record<'1' | '5' | 'other', number>;
  end: Record<'1' | '5' | 'other', number>;
} {
  const tonnetz = buildTonnetz(spec.key);
  const tonicPc = KEY_TO_PC[spec.key] ?? 0;
  const keyScale = modeScale(spec.mode).map((step) => (tonicPc + step) % 12);
  const start: Record<'1' | '5' | 'other', number> = { '1': 0, '5': 0, other: 0 };
  const end: Record<'1' | '5' | 'other', number> = { '1': 0, '5': 0, other: 0 };

  for (let i = 0; i < samples; i += 1) {
    const sampleSeed = seed + i * 97;
    const harmony = buildHarmonySpine(spec, tonnetz, createRng(sampleSeed));
    const generated = createMelodyCandidates(spec, harmony, tonnetz, sampleSeed);
    if (generated.status !== 'ok' || generated.candidates.length === 0) {
      continue;
    }

    const melody = generated.candidates[0].melody;
    if (melody.length === 0) {
      continue;
    }

    const startDegree = midiToDegree((melody[0] as MelodyEvent).midi, keyScale);
    const endDegree = midiToDegree((melody[melody.length - 1] as MelodyEvent).midi, keyScale);
    start[classify(startDegree)] += 1;
    end[classify(endDegree)] += 1;
  }

  return { start, end };
}

const defaultSpec: ExerciseSpec = {
  title: 'Endpoint Distribution Debug',
  startingDegree: 1,
  key: 'C',
  mode: 'major',
  clef: 'treble',
  range: {
    lowDegree: 1,
    highDegree: 6,
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

const report = distributionForSamples(defaultSpec, 20260220, 50);
console.log(JSON.stringify(report, null, 2));
