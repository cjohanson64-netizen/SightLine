import programSource from '../src/tat/programs/generateExercise.tat?raw';
import { createRegistry, trellis, createEmptyGraph, type ArtifactGraph, type ExerciseSpec as CoreExerciseSpec } from '../src/tat';
import { toMusicXml } from '../src/core/projection/toMusicXml';
import type { ExerciseSpec as BundleExerciseSpec } from './schema';

export interface GenerateExerciseInput {
  spec: BundleExerciseSpec;
  seed: number;
}

export interface GenerateExerciseOutput {
  artifact: ArtifactGraph;
  musicXml: string;
  logs: string[];
}

function toCoreSpec(spec: BundleExerciseSpec): CoreExerciseSpec {
  const phraseLengthMeasures = Math.max(2, Math.min(4, Math.round(spec.measures || 4))) as 2 | 3 | 4;
  const phraseCount = Math.max(1, Math.ceil(Math.max(1, spec.measures) / phraseLengthMeasures));
  const labels: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
  return {
    title: 'Tonnetz Sight Singing Exercise',
    startingDegree: 1,
    key: spec.key,
    mode: spec.mode,
    clef: spec.clef,
    range: spec.range,
    phraseLengthMeasures,
    phrases: Array.from({ length: phraseCount }, (_, i) => ({
      label: labels[Math.min(i, labels.length - 1)],
      prime: false,
      cadence: spec.cadence
    })),
    timeSig: spec.timeSig,
    chromatic: spec.chromatic,
    illegalDegrees: [],
    illegalIntervalsSemis: [],
    illegalTransitions: []
  };
}

export function generateExercise({ spec, seed }: GenerateExerciseInput): GenerateExerciseOutput {
  const registry = createRegistry();
  const context = {
    graph: createEmptyGraph('artifact-root'),
    inputs: { spec: toCoreSpec(spec), seed },
    state: {},
    logs: [] as string[]
  };

  const result = trellis(programSource, context, registry);
  const musicXml = toMusicXml(result.graph);

  return {
    artifact: result.graph,
    musicXml,
    logs: result.logs
  };
}
