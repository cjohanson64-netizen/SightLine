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
