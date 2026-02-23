import programSource from '../tat/programs/generateExercise.tat?raw';
import { createRegistry, trellis, createEmptyGraph, type ArtifactGraph, type ExerciseSpec } from '../tat';
import { toMusicXml } from './projection/toMusicXml';

export interface GenerateExerciseInput {
  spec: ExerciseSpec;
  seed: number;
}

export interface GenerateExerciseOutput {
  artifact: ArtifactGraph;
  musicXml: string;
  logs: string[];
}

export function generateExercise({ spec, seed }: GenerateExerciseInput): GenerateExerciseOutput {
  const registry = createRegistry();
  const context = {
    graph: createEmptyGraph('artifact-root'),
    inputs: { spec, seed },
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
