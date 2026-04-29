import programSource from './tatBridge/programs/projectExerciseArtifact.tat?raw';
import type { ArtifactGraph } from '@/SightLine/domain/artifact';
import type { ExerciseSpec } from '@/SightLine/domain/music';
import { buildHarmonySpine } from './generator/harmony';
import {
  createMelodyCandidates,
  type MelodyCandidateResult,
  type MelodySelectionTrace
} from './generator/melody';
import { scoreMelody } from './generator/scoring';
import { toMusicXml } from './projection/toMusicXml';
import { buildTonnetz } from './tonnetz/buildTonnetz';
import { createRng } from '../utils/rng';
import { buildArtifactBindings } from './tatBridge/buildArtifactBindings';
import { projectArtifactResult } from './tatBridge/projectArtifactResult';
import { runTatProgram } from './tatBridge/runTatProgram';

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

interface ScoredCandidate {
  id: string;
  candidate: MelodyCandidateResult;
  score: number;
  metrics: ReturnType<typeof scoreMelody>['metrics'];
}

function formatTraceLogs(trace: MelodySelectionTrace[], candidateId: string): string[] {
  return trace.flatMap((slot) =>
    slot.steps.map(
      (step) =>
        `[${candidateId}] m${slot.measure}b${slot.beat} ${String(step.step)} count=${String(
          step.remainingCandidateCount ?? '?'
        )} reason=${String(step.reason ?? '')}`
    )
  );
}

function selectBestCandidate(
  candidates: MelodyCandidateResult[],
  spec: ExerciseSpec
): ScoredCandidate | null {
  const scored = candidates.map((candidate, index) => {
    const scoreResult = scoreMelody(candidate.melody, spec);

    return {
      id: `candidate-${index + 1}`,
      candidate,
      score: scoreResult.score,
      metrics: scoreResult.metrics
    };
  });

  return scored.sort((a, b) => b.score - a.score)[0] ?? null;
}

export function generateExercise({ spec, seed }: GenerateExerciseInput): GenerateExerciseOutput {
  const logs: string[] = [];

  const tonnetz = buildTonnetz(spec.key);
  const harmony = buildHarmonySpine(spec, tonnetz, createRng(seed + 101));
  const melodies = createMelodyCandidates(spec, harmony, tonnetz, seed + 211);

  if (melodies.status === 'no_solution') {
    logs.push(
      `no_solution reason=${melodies.reasonCode} illegalDegrees=${JSON.stringify(
        melodies.details.illegalDegrees
      )} illegalIntervalsSemis=${JSON.stringify(melodies.details.illegalIntervalsSemis)} illegalTransitions=${JSON.stringify(
        melodies.details.illegalTransitions
      )}`
    );

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
        details: melodies.details
      },
      logs
    };
  }

  const best = selectBestCandidate(melodies.candidates, spec);
  if (!best) {
    return {
      status: 'no_solution',
      error: {
        title: 'We couldn’t build a melody with these settings.',
        message: 'No melody candidates were available after generation.',
        suggestions: ['Try again with a different seed.'],
        details: {
          illegalDegrees: spec.illegalDegrees,
          illegalIntervalsSemis: spec.illegalIntervalsSemis,
          illegalTransitions: spec.illegalTransitions
        }
      },
      logs
    };
  }

  logs.push(`selected=${best.id} score=${best.score.toFixed(3)}`);
  logs.push(...formatTraceLogs(best.candidate.trace, best.id));

  const result = runTatProgram({
    program: programSource,
    initialState: buildArtifactBindings({
      seed,
      spec,
      harmony,
      melody: best.candidate.melody,
      metrics: best.metrics,
      trace: best.candidate.trace,
      relaxationTier: best.candidate.relaxationTier,
      relaxedRules: best.candidate.relaxedRules
    })
  });

  const warnings = result.validation.filter((issue) => issue.severity !== 'error');
  logs.push(...warnings.map((issue) => `tat_${issue.severity}: ${issue.message}`));

  const artifact = projectArtifactResult(result.execution);
  const musicXml = toMusicXml(artifact, seed);
  const relaxationTierNode = artifact.nodes.find((node) => node.id === 'artifact-body-relaxation-tier');
  const relaxedRulesNode = artifact.nodes.find((node) => node.id === 'artifact-body-relaxed-rules');
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
    artifact,
    musicXml,
    logs,
    relaxationTier: relaxationTierValue > 0 ? relaxationTierValue : undefined,
    relaxedRules: relaxedRulesValue.length > 0 ? relaxedRulesValue : undefined
  };
}
