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
  title: string;
  startingDegree: 1 | 3 | 5;
  key: string;
  mode: 'major' | 'minor';
  clef: 'treble' | 'bass';
  range: {
    lowDegree: number;
    highDegree: number;
    lowOctave: number;
    highOctave: number;
  };
  phraseLengthMeasures: 2 | 3 | 4;
  phrases: PhraseSpec[];
  timeSig: string;
  chromatic: boolean;
  illegalDegrees: number[];
  illegalIntervalsSemis: number[];
  illegalTransitions: IllegalTransitionRule[];
  rhythmWeights?: RhythmWeights;
  userConstraints?: UserConstraints;
}

export interface UserConstraints {
  startDegreeLocked?: boolean;
  hardStartDo?: boolean;
  cadenceType?: 'authentic' | 'half';
  endOnDoHard?: boolean;
  maxLeapSemitones?: number;
  maxLargeLeapsPerPhrase?: number;
  minEighthPairsPerPhrase?: number;
  rhythmDist?: { EE: number; Q: number; H: number; W: number };
  allowedNoteValues?: Array<'EE' | 'Q' | 'H' | 'W'>;
}

export interface RhythmWeights {
  whole: number;
  half: number;
  quarter: number;
  eighth: number;
  minEighthPairsPerPhrase?: number;
  preferEighthInPreClimax?: boolean;
}

export interface PhraseSpec {
  label: 'A' | 'B' | 'C' | 'D';
  prime: boolean;
  cadence: 'authentic' | 'plagal' | 'half';
}

export interface IllegalTransitionRule {
  a: number;
  b: number;
  mode: 'adjacent';
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
  phraseIndex?: number;
  role: 'ChordTone' | 'NonHarmonicTone' | 'FallbackTonic';
  reason: string;
  chordId: string;
  keyId: string;
  nonHarmonicTone?: boolean;
  onsetBeat?: number;
  durationBeats?: number;
  isAttack?: boolean;
  tieStart?: boolean;
  tieStop?: boolean;
  functionTags?: Array<'anchor' | 'structural' | 'connective_nht' | 'smoothing_run' | 'climax' | 'cadence'>;
  originalMidi?: number;
  editedMidi?: number;
  editedPitch?: string;
  isEdited?: boolean;
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
  relaxationTier?: number;
  relaxedRules?: string[];
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
