import type { CandidateExercise, MelodyEvent } from '../models/schema';
import { graftBranch, graftBud, graftLeaf, graftVine } from '../ops/graft';
import { pruneByKind, pruneDisconnected, pruneNode } from '../ops/prune';
import { assayMetric } from '../ops/assay';
import type { TatOp, TrellisRegistry } from './trellis';
import { buildTonnetz } from '../../core/tonnetz/buildTonnetz';
import { traverseTonnetz } from '../../core/tonnetz/traversal';
import { buildHarmonySpine } from '../../core/generator/harmony';
import { createMelodyCandidates } from '../../core/generator/melody';
import { scoreMelody } from '../../core/generator/scoring';
import { createRng } from '../../utils/rng';

class Registry implements TrellisRegistry {
  private readonly ops = new Map<string, TatOp>();

  register(name: string, op: TatOp): void {
    this.ops.set(name, op);
  }

  get(name: string): TatOp | undefined {
    return this.ops.get(name);
  }
}

function asString(value: unknown): string {
  return String(value ?? '');
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

export function createRegistry(): TrellisRegistry {
  const registry = new Registry();

  registry.register('graftBranch', (context, args) => {
    graftBranch(context.graph, {
      parentId: args.parentId as string | undefined,
      id: asString(args.id),
      label: args.label as string | undefined,
      data: (args.data as Record<string, unknown>) ?? {},
      edgeKind: args.edgeKind as string | undefined
    });
  });

  registry.register('graftBud', (context, args) => {
    graftBud(context.graph, {
      parentId: args.parentId as string | undefined,
      id: asString(args.id),
      label: args.label as string | undefined,
      data: (args.data as Record<string, unknown>) ?? {},
      edgeKind: args.edgeKind as string | undefined
    });
  });

  registry.register('graftLeaf', (context, args) => {
    graftLeaf(context.graph, {
      parentId: args.parentId as string | undefined,
      id: asString(args.id),
      label: args.label as string | undefined,
      data: (args.data as Record<string, unknown>) ?? {},
      edgeKind: args.edgeKind as string | undefined
    });
  });

  registry.register('graftVine', (context, args) => {
    graftVine(context.graph, {
      parentId: args.parentId as string | undefined,
      id: asString(args.id),
      label: args.label as string | undefined,
      data: (args.data as Record<string, unknown>) ?? {},
      edgeKind: args.edgeKind as string | undefined
    });
  });

  registry.register('pruneNode', (context, args) => {
    pruneNode(context.graph, { nodeId: asString(args.nodeId) });
  });

  registry.register('pruneByKind', (context, args) => {
    pruneByKind(context.graph, {
      kind: asString(args.kind),
      keepIds: (args.keepIds as string[] | undefined) ?? []
    });
  });

  registry.register('pruneDisconnected', (context) => {
    pruneDisconnected(context.graph);
  });

  registry.register('assay', (context, args) => {
    assayMetric(context.graph, {
      parentId: args.parentId as string | undefined,
      metric: {
        name: asString(args.name),
        value: asNumber(args.value)
      }
    });
  });

  registry.register('buildTonnetz', (context, args) => {
    const tonnetz = buildTonnetz(asString(args.key));
    context.state[asString(args.storeAs)] = tonnetz;

    graftBranch(context.graph, {
      id: asString(args.graphNodeId),
      label: 'Tonnetz',
      data: { root: tonnetz.root, size: tonnetz.nodes.length },
      parentId: context.graph.root
    });
  });

  registry.register('generateHarmony', (context, args) => {
    const tonnetz = context.state[asString(args.tonnetzRef)] as ReturnType<typeof buildTonnetz>;
    const rng = createRng(context.inputs.seed + asNumber(args.seedOffset));
    const harmony = buildHarmonySpine(context.inputs.spec, tonnetz, rng);
    context.state[asString(args.storeAs)] = harmony;

    const parentId = asString(args.parentId);
    for (const event of harmony) {
      graftLeaf(context.graph, {
        parentId,
        id: `harmony-m${event.measure}-b${event.beat}`,
        label: `Harmony m${event.measure} b${event.beat}`,
        data: event,
        edgeKind: 'harmony'
      });
    }
  });

  registry.register('traverseTonnetz', (context, args) => {
    const tonnetz = context.state[asString(args.tonnetzRef)] as ReturnType<typeof buildTonnetz>;
    const length = asNumber(args.length);
    const rng = createRng(context.inputs.seed + asNumber(args.seedOffset));
    const traversal = traverseTonnetz(tonnetz, length, rng);
    context.state[asString(args.storeAs)] = traversal;
  });

  registry.register('generateMelody', (context, args) => {
    const harmony = context.state[asString(args.harmonyRef)] as CandidateExercise['harmony'];
    const tonnetz = context.state[asString(args.tonnetzRef)] as ReturnType<typeof buildTonnetz>;
    const seed = context.inputs.seed + asNumber(args.seedOffset);
    const melodies = createMelodyCandidates(context.inputs.spec, harmony, tonnetz, seed);

    const candidates: CandidateExercise[] = melodies.map((result, index) => ({
      id: `candidate-${index + 1}`,
      harmony,
      melody: result.melody,
      trace: result.trace,
      metrics: [],
      score: Number.NEGATIVE_INFINITY
    }));

    context.state[asString(args.storeAs)] = candidates;

    const parentId = asString(args.parentId);
    for (const candidate of candidates) {
      graftBud(context.graph, {
        parentId,
        id: candidate.id,
        label: candidate.id,
        data: { score: candidate.score, traceCount: candidate.trace?.length ?? 0 },
        edgeKind: 'candidate'
      });

      const traceBranchId = `${candidate.id}-selection-trace`;
      graftBranch(context.graph, {
        parentId: candidate.id,
        id: traceBranchId,
        label: 'SelectionTrace',
        data: {},
        edgeKind: 'trace'
      });

      const trace = (candidate.trace ?? []) as Array<{ measure: number; beat: number; steps: Array<Record<string, unknown>> }>;
      trace.forEach((slot, slotIndex) => {
        const slotId = `${traceBranchId}-m${slot.measure}-b${slot.beat}`;
        graftBranch(context.graph, {
          parentId: traceBranchId,
          id: slotId,
          label: `m${slot.measure} b${slot.beat}`,
          data: {},
          edgeKind: 'slot'
        });

        slot.steps.forEach((step, stepIndex) => {
          graftLeaf(context.graph, {
            parentId: slotId,
            id: `${slotId}-s${stepIndex + 1}`,
            label: String(step.step ?? `step-${stepIndex + 1}`),
            data: step,
            edgeKind: 'prune-step'
          });

          context.logs.push(
            `[${candidate.id}] m${slot.measure}b${slot.beat} ${String(step.step)} count=${String(
              step.remainingCandidateCount ?? '?'
            )} reason=${String(step.reason ?? '')}`
          );
        });
      });

      candidate.melody
        .filter((event) => event.role === 'NonHarmonicTone')
        .forEach((event) => {
          graftBud(context.graph, {
            parentId: candidate.id,
            id: `${candidate.id}-nht-m${event.measure}-b${event.beat}`,
            label: `NHT m${event.measure} b${event.beat}`,
            data: {
              pitch: event.pitch,
              requiresResolution: true
            },
            edgeKind: 'nht-resolution'
          });
        });
    }
  });

  registry.register('scoreCandidates', (context, args) => {
    const candidates = context.state[asString(args.candidatesRef)] as CandidateExercise[];

    for (const candidate of candidates) {
      const result = scoreMelody(candidate.melody);
      candidate.metrics = result.metrics;
      candidate.score = result.score;

      const node = context.graph.nodes.find((entry) => entry.id === candidate.id);
      if (node) {
        const currentData = node.data && typeof node.data === 'object' ? node.data : {};
        node.data = { ...currentData, score: candidate.score };
      }
    }

    context.state[asString(args.storeAs)] = candidates;
  });

  registry.register('selectBestCandidate', (context, args) => {
    const candidates = context.state[asString(args.candidatesRef)] as CandidateExercise[];
    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    if (!best) {
      return;
    }

    context.state[asString(args.storeAs)] = best;
    context.state.keepCandidateIds = [best.id];

    assayMetric(context.graph, {
      parentId: asString(args.parentId),
      metric: {
        name: 'best_score',
        value: Number(best.score.toFixed(3))
      }
    });
  });

  registry.register('commitBestCandidate', (context, args) => {
    const best = context.state[asString(args.bestRef)] as CandidateExercise;
    const parentId = asString(args.parentId);

    const melodyBranchId = `${parentId}-melody`;
    graftBranch(context.graph, {
      parentId,
      id: melodyBranchId,
      label: 'Melody',
      data: { noteCount: best.melody.length },
      edgeKind: 'melody'
    });

    for (const event of best.melody as MelodyEvent[]) {
      graftLeaf(context.graph, {
        parentId: melodyBranchId,
        id: `note-m${event.measure}-b${event.beat}`,
        label: `m${event.measure} b${event.beat}`,
        data: event,
        edgeKind: 'melody-event'
      });
    }

    const metricsBranchId = `${parentId}-metrics`;
    graftBranch(context.graph, {
      parentId,
      id: metricsBranchId,
      label: 'Metrics',
      data: {},
      edgeKind: 'metrics'
    });

    for (const metric of best.metrics) {
      assayMetric(context.graph, {
        parentId: metricsBranchId,
        metric
      });
    }
  });

  return registry;
}
