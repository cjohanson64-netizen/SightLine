import programSource from '../tat/programs/generateExercise.tat?raw';
import { createRegistry, trellis, createEmptyGraph, type ArtifactGraph, type ExerciseSpec } from '../tat';
import { toMusicXml } from './projection/toMusicXml';
import { MelodyNoSolutionError } from './generator/melody';

export interface GenerateExerciseInput {
  spec: ExerciseSpec;
  seed: number;
}

export type GenerateExerciseOutput =
  | {
      status: 'ok';
      artifact: ArtifactGraph;
      musicXml: string;
      logs: string[];
      relaxationTier?: number;
      relaxedRules?: string[];
    }
  | {
      status: 'no_solution';
      error: {
        title: string;
        message: string;
        suggestions: string[];
        details: {
          illegalDegrees: number[];
          illegalIntervalsSemis: number[];
          illegalTransitions: ExerciseSpec['illegalTransitions'];
        };
      };
      logs: string[];
    };

export function generateExercise({ spec, seed }: GenerateExerciseInput): GenerateExerciseOutput {
  const registry = createRegistry();
  const context = {
    graph: createEmptyGraph('artifact-root'),
    inputs: { spec, seed },
    state: {},
    logs: [] as string[]
  };

  try {
    const result = trellis(programSource, context, registry);
    const musicXml = toMusicXml(result.graph, seed);
    const relaxationTierNode = result.graph.nodes.find((node) => node.id === 'artifact-body-relaxation-tier');
    const relaxedRulesNode = result.graph.nodes.find((node) => node.id === 'artifact-body-relaxed-rules');
    const relaxationTierValue =
      relaxationTierNode && relaxationTierNode.data && typeof relaxationTierNode.data === 'object'
        ? Number((relaxationTierNode.data as { value?: number }).value ?? 0)
        : 0;
    const relaxedRulesValue =
      relaxedRulesNode && relaxedRulesNode.data && typeof relaxedRulesNode.data === 'object'
        ? (((relaxedRulesNode.data as { values?: string[] }).values ?? []) as string[])
        : [];

    return {
      status: 'ok',
      artifact: result.graph,
      musicXml,
      logs: result.logs,
      relaxationTier: relaxationTierValue > 0 ? relaxationTierValue : undefined,
      relaxedRules: relaxedRulesValue.length > 0 ? relaxedRulesValue : undefined
    };
  } catch (error) {
    if (error instanceof MelodyNoSolutionError) {
      return {
        status: 'no_solution',
        error: {
          title: 'We couldn’t build a melody with these settings.',
          message: 'It looks like the note and interval limits are too tight to create a complete phrase.',
          suggestions: [
            'Allow at least one step up or down',
            'Let the melody use one more note (like Re or Ti)',
            'Remove one of the “no before/after” rules',
            'Expand the range slightly',
            'Then try again.'
          ],
          details: error.details
        },
        logs: context.logs
      };
    }

    throw error;
  }
}
