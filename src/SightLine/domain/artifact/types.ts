export type NodeKind =
  | 'artifact'
  | 'branch'
  | 'bud'
  | 'leaf'
  | 'vine'
  | 'tonnetzNode'
  | 'harmonyEvent'
  | 'melodyEvent'
  | 'metric';

export interface GraphNode<T = unknown> {
  id: string;
  kind: NodeKind;
  label: string;
  data: T;
}

export interface GraphEdge<T = unknown> {
  id: string;
  from: string;
  to: string;
  kind: string;
  data: T;
}

export type DebugProjectedMelodyFunction =
  | 'climax'
  | 'cadence'
  | 'structural'
  | 'opening'
  | 'release'
  | 'connective_nht';

export interface DebugProjectedTargetNote {
  noteId: string;
  measure: number;
  beat: number;
  pitch: string;
  phraseIndex: number;
  functions: DebugProjectedMelodyFunction[];
}

export interface DebugProjectedAssessmentExplanation {
  explanationId: string;
  targetNoteId: string | null;
  performedNoteId: string | null;
  outcome: 'correct' | 'near_pitch' | 'incorrect_pitch' | 'ambiguous';
}

export interface DebugPhraseSemanticsSummary {
  phraseIndex: number;
  openingPitch: string | null;
  climaxPitch: string | null;
  cadencePitches: string[];
  hasRelease: boolean;
  hasConnectiveNht: boolean;
  summaryText: string;
}

export interface SemanticInsight {
  category:
    | 'climax'
    | 'cadence'
    | 'release'
    | 'connective_motion'
    | 'structural_shape';
  polarity: 'strength' | 'weakness';
  message: string;
  priority: number;
}

export type PracticeFocus =
  | 'climax_release'
  | 'cadence_resolution'
  | 'connective_motion'
  | 'structural_accuracy'
  | 'range_confidence';

export interface PracticeRecommendation {
  focus: PracticeFocus;
  title: string;
  message: string;
}

export interface DebugSemanticsProjection {
  targetNotes: DebugProjectedTargetNote[];
  assessmentExplanations: DebugProjectedAssessmentExplanation[];
  phraseSummaries: DebugPhraseSemanticsSummary[];
  strengths: SemanticInsight[];
  weaknesses: SemanticInsight[];
  recommendation: PracticeRecommendation | null;
}

export interface ArtifactGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  root: string;
  debugSemantics?: DebugSemanticsProjection;
}

export function createEmptyGraph(rootId = 'artifact-root'): ArtifactGraph {
  return {
    nodes: [
      {
        id: rootId,
        kind: 'artifact',
        label: 'Exercise Artifact Root',
        data: {}
      }
    ],
    edges: [],
    root: rootId
  };
}

export function assertGraphInvariant(graph: ArtifactGraph): void {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || typeof graph.root !== 'string') {
    throw new Error('Graph invariant failed: expected { nodes: [], edges: [], root }.');
  }

  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(graph.root)) {
    throw new Error(`Graph invariant failed: root node "${graph.root}" is missing.`);
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`Graph invariant failed: edge "${edge.id}" has dangling endpoints.`);
    }
  }
}
