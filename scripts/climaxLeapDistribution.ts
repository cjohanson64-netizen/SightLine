import { buildTonnetz } from '../src/core/tonnetz/buildTonnetz';
import { buildHarmonySpine } from '../src/core/generator/harmony';
import { createMelodyCandidates } from '../src/core/generator/melody';
import { createRng } from '../src/utils/rng';
import type { ExerciseSpec } from '../src/tat/models/schema';

type Bucket = 'leap' | 'step' | 'other';

function classifyInterval(interval: number): Bucket {
  const abs = Math.abs(interval);
  if (abs >= 3) {
    return 'leap';
  }
  if (abs <= 2 && abs > 0) {
    return 'step';
  }
  return 'other';
}

const defaultSpec: ExerciseSpec = {
  title: 'Climax Leap Distribution Debug',
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

const samples = 50;
const tonnetz = buildTonnetz(defaultSpec.key);

const into = { leap: 0, step: 0, other: 0 };
const out = { leap: 0, step: 0, other: 0 };
let outDownStepwise = 0;
let measured = 0;

for (let i = 0; i < samples; i += 1) {
  const seed = 20260220 + i * 97;
  const harmony = buildHarmonySpine(defaultSpec, tonnetz, createRng(seed));
  const generated = createMelodyCandidates(defaultSpec, harmony, tonnetz, seed);
  if (generated.status !== 'ok' || generated.candidates.length === 0) {
    continue;
  }

  const melody = generated.candidates[0].melody;
  if (melody.length < 3) {
    continue;
  }

  const maxMidi = melody.reduce((max, event) => Math.max(max, event.midi), Number.NEGATIVE_INFINITY);
  const climaxIndex = melody.findIndex((event) => event.midi === maxMidi);
  if (climaxIndex <= 0 || climaxIndex >= melody.length - 1) {
    continue;
  }

  const intoInterval = melody[climaxIndex].midi - melody[climaxIndex - 1].midi;
  const outInterval = melody[climaxIndex + 1].midi - melody[climaxIndex].midi;
  into[classifyInterval(intoInterval)] += 1;
  out[classifyInterval(outInterval)] += 1;
  if (outInterval < 0 && Math.abs(outInterval) <= 2) {
    outDownStepwise += 1;
  }
  measured += 1;
}

console.log(
  JSON.stringify(
    {
      samplesRequested: samples,
      samplesMeasured: measured,
      intoClimax: into,
      outOfClimax: out,
      outOfClimaxStepwiseDownCount: outDownStepwise
    },
    null,
    2
  )
);
