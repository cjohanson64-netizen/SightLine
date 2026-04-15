import {
  addBranch,
  addNode,
  createGraph,
  setNodeMeta,
  setNodeState,
  type Graph,
  type GraphValue,
  type GraphNode
} from '@tat/runtime/graph';
import {
  createRuntimeBindings,
  registerValueBinding
} from '@tat/runtime/evaluateNodeCapture';
import type { RuntimeState } from '@tat/runtime/executeProgram';
import type { MelodyAssessmentResult } from '@/SightLine/domain/assessment';
import type {
  AssayMetric,
  ExerciseSpec,
  HarmonyEvent,
  MelodyEvent
} from '@/SightLine/domain/music';
import type { MelodySelectionTrace } from '@/SightLine/core/generator/melody';
import { buildTargetMelodyGraph } from './buildTargetMelodyGraph';
import { buildPerformedMelodyGraph } from './buildPerformedMelodyGraph';
import { buildAssessmentExplanationGraph } from './buildAssessmentExplanationGraph';

const ARTIFACT_ROOT_ID = 'artifactRoot';

function makeArtifactNode(
  id: string,
  kind: 'artifact' | 'branch' | 'bud' | 'leaf',
  label: string,
  data: GraphValue
): GraphNode {
  return {
    id,
    value: {
      kind,
      label,
      data
    },
    state: {},
    meta: {}
  };
}

function createArtifactFragment(): Graph {
  const graph = createGraph(ARTIFACT_ROOT_ID);
  addNode(graph, makeArtifactNode(ARTIFACT_ROOT_ID, 'artifact', 'Exercise Artifact Root', {}));
  return graph;
}

function buildSpecGraph(spec: ExerciseSpec): Graph {
  const graph = createArtifactFragment();
  const specNodeId = 'exercise-spec';
  const phraseConfigId = 'phrase-config';
  const constraintsId = 'constraint-spec';

  addNode(graph, makeArtifactNode(specNodeId, 'branch', 'ExerciseSpec', spec as unknown as GraphValue));
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', specNodeId);

  addNode(
    graph,
    makeArtifactNode(phraseConfigId, 'branch', 'PhraseConfig', {
      phraseLengthMeasures: spec.phraseLengthMeasures,
      count: spec.phrases.length
    })
  );
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', phraseConfigId);

  spec.phrases.forEach((phrase, index) => {
    const phraseId = `phrase-${index + 1}`;
    addNode(graph, makeArtifactNode(phraseId, 'branch', `Phrase ${index + 1}`, phrase as unknown as GraphValue));
    addBranch(graph, phraseConfigId, 'contains', phraseId);
  });

  addNode(
    graph,
    makeArtifactNode(constraintsId, 'branch', 'ConstraintSpec', {
      illegalDegreeCount: spec.illegalDegrees.length,
      illegalIntervalCount: spec.illegalIntervalsSemis.length,
      illegalTransitionCount: spec.illegalTransitions.length
    })
  );
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', constraintsId);

  addNode(
    graph,
    makeArtifactNode('constraint-illegal-degrees', 'leaf', 'illegalDegrees', {
      values: spec.illegalDegrees
    })
  );
  addBranch(graph, constraintsId, 'contains', 'constraint-illegal-degrees');

  addNode(
    graph,
    makeArtifactNode('constraint-illegal-intervals', 'leaf', 'illegalIntervalsSemis', {
      values: spec.illegalIntervalsSemis
    })
  );
  addBranch(graph, constraintsId, 'contains', 'constraint-illegal-intervals');

  addNode(
    graph,
    makeArtifactNode('constraint-illegal-transitions', 'leaf', 'illegalTransitions', {
      values: spec.illegalTransitions as unknown as GraphValue
    })
  );
  addBranch(graph, constraintsId, 'contains', 'constraint-illegal-transitions');

  return graph;
}

function buildHarmonyGraph(harmony: HarmonyEvent[]): Graph {
  const graph = createArtifactFragment();
  const harmonyId = 'harmony-events';

  addNode(graph, makeArtifactNode(harmonyId, 'branch', 'Harmony', { count: harmony.length }));
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', harmonyId);

  harmony.forEach((event) => {
    const id = `harmony-m${event.measure}-b${String(event.beat).replace('.', '_')}`;
    addNode(graph, makeArtifactNode(id, 'leaf', `Harmony m${event.measure} b${event.beat}`, event as unknown as GraphValue));
    addBranch(graph, harmonyId, 'contains', id);
    setNodeMeta(graph, id, 'quality', event.quality);
  });

  return graph;
}

function buildAnalysisGraph(input: {
  metrics: AssayMetric[];
  trace: MelodySelectionTrace[];
  relaxationTier?: number;
  relaxedRules?: string[];
}): Graph {
  const graph = createArtifactFragment();
  const metricsId = 'analysis-metrics';
  const traceId = 'analysis-trace';

  addNode(graph, makeArtifactNode(metricsId, 'branch', 'Metrics', { count: input.metrics.length }));
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', metricsId);

  input.metrics.forEach((metric) => {
    const id = `metric-${metric.name}`;
    addNode(graph, makeArtifactNode(id, 'leaf', metric.name, metric as unknown as GraphValue));
    addBranch(graph, metricsId, 'contains', id);
  });

  addNode(graph, makeArtifactNode(traceId, 'branch', 'SelectionTrace', { count: input.trace.length }));
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', traceId);

  input.trace.forEach((slot, slotIndex) => {
    const slotId = `trace-slot-${slotIndex + 1}`;
    addNode(graph, makeArtifactNode(slotId, 'branch', `m${slot.measure} b${slot.beat}`, {}));
    addBranch(graph, traceId, 'contains', slotId);

    slot.steps.forEach((step, stepIndex) => {
      const stepId = `${slotId}-step-${stepIndex + 1}`;
      addNode(
        graph,
        makeArtifactNode(stepId, 'leaf', String(step.step ?? `step-${stepIndex + 1}`), step as unknown as GraphValue)
      );
      addBranch(graph, slotId, 'contains', stepId);
    });
  });

  if (typeof input.relaxationTier === 'number' && input.relaxationTier > 0) {
    addNode(
      graph,
      makeArtifactNode('artifact-body-relaxation-tier', 'leaf', 'relaxationTier', {
        value: input.relaxationTier
      })
    );
    addBranch(graph, ARTIFACT_ROOT_ID, 'contains', 'artifact-body-relaxation-tier');
  }

  if ((input.relaxedRules?.length ?? 0) > 0) {
    addNode(
      graph,
      makeArtifactNode('artifact-body-relaxed-rules', 'leaf', 'relaxedRules', {
        values: input.relaxedRules
      } as GraphValue)
    );
    addBranch(graph, ARTIFACT_ROOT_ID, 'contains', 'artifact-body-relaxed-rules');
  }

  return graph;
}

export interface BuildAssessmentBindingsInput {
  seed: number;
  spec: ExerciseSpec;
  harmony: HarmonyEvent[];
  melody: MelodyEvent[];
  performedMelody?: MelodyEvent[];
  assessment?: MelodyAssessmentResult | null;
  metrics: AssayMetric[];
  trace: MelodySelectionTrace[];
  relaxationTier?: number;
  relaxedRules?: string[];
}

export function buildAssessmentBindings(
  input: BuildAssessmentBindingsInput
): Partial<RuntimeState> {
  const bindings = createRuntimeBindings();
  registerValueBinding(bindings, 'exerciseSeed', input.seed);
  registerValueBinding(bindings, 'melodyNoteCount', input.melody.length);
  registerValueBinding(bindings, 'performedMelodyNoteCount', input.performedMelody?.length ?? 0);
  registerValueBinding(bindings, 'phraseCount', input.spec.phrases.length);
  registerValueBinding(bindings, 'assessmentStage', input.assessment ? 'assessment' : 'generation');

  const graphs = new Map<string, Graph>();
  const assetKinds = new Map<string, RuntimeState['assetKinds'] extends Map<infer K, infer V> ? V : never>();

  const specGraph = buildSpecGraph(input.spec);
  const harmonyGraph = buildHarmonyGraph(input.harmony);
  const melodyGraph = buildTargetMelodyGraph(input.melody);
  const performedMelodyGraph = buildPerformedMelodyGraph(input.performedMelody ?? []);
  const assessmentExplanationGraph = buildAssessmentExplanationGraph({
    targetMelody: input.melody,
    performedMelody: input.performedMelody,
    assessment: input.assessment
  });
  const analysisGraph = buildAnalysisGraph({
    metrics: input.metrics,
    trace: input.trace,
    relaxationTier: input.relaxationTier,
    relaxedRules: input.relaxedRules
  });

  graphs.set('specGraph', specGraph);
  graphs.set('harmonyGraph', harmonyGraph);
  graphs.set('melodyGraph', melodyGraph);
  graphs.set('performedMelodyGraph', performedMelodyGraph);
  graphs.set('assessmentExplanationGraph', assessmentExplanationGraph);
  graphs.set('analysisGraph', analysisGraph);

  assetKinds.set('specGraph', 'graph');
  assetKinds.set('harmonyGraph', 'graph');
  assetKinds.set('melodyGraph', 'graph');
  assetKinds.set('performedMelodyGraph', 'graph');
  assetKinds.set('assessmentExplanationGraph', 'graph');
  assetKinds.set('analysisGraph', 'graph');

  return {
    bindings,
    graphs,
    assetKinds
  };
}
