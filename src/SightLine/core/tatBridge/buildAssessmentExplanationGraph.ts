import {
  addBranch,
  addNode,
  addProgress,
  createGraph,
  setNodeMeta,
  setNodeState,
  type Graph,
  type GraphNode,
  type GraphValue
} from '@tat/runtime/graph';
import type { MelodyAssessmentResult, PitchAssessmentNote } from '@/SightLine/domain/assessment';
import type { MelodyEvent } from '@/SightLine/domain/music';
import { buildMelodyNoteNodeId } from './buildTargetMelodyGraph';

const ARTIFACT_ROOT_ID = 'artifactRoot';

export type AssessmentExplanationOutcome =
  | 'correct'
  | 'near_pitch'
  | 'incorrect_pitch'
  | 'ambiguous';

interface BuildAssessmentExplanationGraphInput {
  targetMelody: MelodyEvent[];
  performedMelody?: MelodyEvent[];
  assessment?: MelodyAssessmentResult | null;
}

function makeArtifactNode(
  id: string,
  kind: 'artifact' | 'branch' | 'leaf',
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

function ensureArtifactRoot(graph: Graph): void {
  addNode(graph, makeArtifactNode(ARTIFACT_ROOT_ID, 'artifact', 'Exercise Artifact Root', {}));
}

const OUTCOME_LABELS: Record<AssessmentExplanationOutcome, string> = {
  correct: 'Correct',
  near_pitch: 'Near Pitch',
  incorrect_pitch: 'Incorrect Pitch',
  ambiguous: 'Ambiguous'
};

function ensureOutcomeNodes(graph: Graph): void {
  (Object.keys(OUTCOME_LABELS) as AssessmentExplanationOutcome[]).forEach((outcome) => {
    const outcomeNodeId = `assessment-outcome-${outcome}`;
    addNode(
      graph,
      makeArtifactNode(outcomeNodeId, 'leaf', OUTCOME_LABELS[outcome], {
        outcome
      } as GraphValue)
    );
    addBranch(graph, ARTIFACT_ROOT_ID, 'contains', outcomeNodeId);
  });
}

function toExplanationOutcome(note: PitchAssessmentNote): AssessmentExplanationOutcome {
  if (
    note.displayState === 'correct' ||
    note.intonationBand === 'in_tune' ||
    note.intonationBand === 'tuned' ||
    note.matchKind === 'exact' ||
    note.isCorrect
  ) {
    return 'correct';
  }

  if (
    note.displayState === 'transposed_consistent' ||
    note.intonationBand === 'loose_center' ||
    note.intonationBand === 'poor_center' ||
    note.intonationBand === 'boundary_cross'
  ) {
    return 'near_pitch';
  }

  if (
    note.displayState === 'adjacent_semitone' ||
    note.displayState === 'incorrect' ||
    note.matchKind === 'adjacent_semitone' ||
    note.matchKind === 'incorrect'
  ) {
    return 'incorrect_pitch';
  }

  return 'ambiguous';
}

export function buildAssessmentExplanationGraph(
  input: BuildAssessmentExplanationGraphInput
): Graph {
  const graph = createGraph(ARTIFACT_ROOT_ID);
  ensureArtifactRoot(graph);
  ensureOutcomeNodes(graph);

  const collectionId = 'assessment-explanations';
  const explanationNotes = input.assessment?.notes ?? [];

  addNode(
    graph,
    makeArtifactNode(collectionId, 'branch', 'Assessment Explanations', {
      count: explanationNotes.length
    })
  );
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', collectionId);

  let previousExplanationId: string | null = null;

  explanationNotes.forEach((note, index) => {
    const explanationId = `assessment-explanation-${index + 1}`;
    const outcome = toExplanationOutcome(note);
    const targetEvent = note.target?.sourceEvent ?? input.targetMelody[index];
    const performedEvent = note.performed?.sourceEvent ?? input.performedMelody?.[index];

    addNode(
      graph,
      makeArtifactNode(explanationId, 'branch', `Assessment Note ${index + 1}`, {
        index,
        matchKind: note.matchKind,
        displayState: note.displayState,
        semitoneDelta: note.semitoneDelta,
        absDelta: note.absDelta,
        interpretationReason: note.interpretationReason
      } as GraphValue)
    );
    addBranch(graph, collectionId, 'contains', explanationId);
    addBranch(graph, explanationId, 'hasOutcome', `assessment-outcome-${outcome}`);

    if (targetEvent) {
      addBranch(
        graph,
        explanationId,
        'explainsTarget',
        buildMelodyNoteNodeId(targetEvent, index)
      );
    }

    if (performedEvent) {
      addBranch(
        graph,
        explanationId,
        'explainsPerformed',
        buildMelodyNoteNodeId(performedEvent, index, 'performed-note')
      );
    }

    setNodeState(graph, explanationId, 'index', index);
    setNodeMeta(graph, explanationId, 'outcome', outcome);

    if (previousExplanationId) {
      addProgress(graph, previousExplanationId, 'precedes', explanationId);
    }
    previousExplanationId = explanationId;
  });

  return graph;
}
