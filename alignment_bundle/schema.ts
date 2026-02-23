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

export interface ArtifactGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  root: string;
}

export interface ExerciseSpec {
  key: string;
  mode: 'major' | 'minor';
  clef: 'treble' | 'bass';
  range: {
    lowDegree: number;
    highDegree: number;
    lowOctave: number;
    highOctave: number;
  };
  measures: number;
  timeSig: string;
  difficulty: 'easy' | 'medium' | 'hard';
  chromatic: boolean;
  cadence: 'authentic' | 'plagal' | 'half';
}

export interface HarmonyEvent {
  measure: number;
  beat: number;
  degree: number;
  rootPc: number;
  chordPcs: number[];
  quality: 'major' | 'minor' | 'diminished';
}

export interface MelodyEvent {
  pitch: string;
  octave: number;
  midi: number;
  duration: string;
  measure: number;
  beat: number;
  role: 'ChordTone' | 'NonHarmonicTone' | 'FallbackTonic';
  reason: string;
  chordId: string;
  keyId: string;
  nonHarmonicTone?: boolean;
}

export interface AssayMetric {
  name: string;
  value: number;
}

export interface GenerationInput {
  spec: ExerciseSpec;
  seed: number;
}

export interface CandidateExercise {
  id: string;
  harmony: HarmonyEvent[];
  melody: MelodyEvent[];
  trace?: unknown[];
  metrics: AssayMetric[];
  score: number;
}

export interface TrellisInput extends GenerationInput {
  graph: ArtifactGraph;
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
