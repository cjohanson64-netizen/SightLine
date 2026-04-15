import {
  addBranch,
  addNode,
  addProgress,
  createGraph,
  setNodeMeta,
  setNodeState,
  type Graph,
  type GraphValue,
  type GraphNode
} from '@tat/runtime/graph';
import type { MelodyEvent } from '@/SightLine/domain/music';
import {
  deriveMelodyFunctions,
  type MelodyFunction,
} from './deriveMelodyFunctions';

const ARTIFACT_ROOT_ID = 'artifactRoot';

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

interface BuildMelodyGraphOptions {
  collectionId?: string;
  collectionLabel?: string;
  noteIdPrefix?: string;
  includeFunctions?: boolean;
}

export function buildMelodyNoteNodeId(
  event: MelodyEvent,
  index: number,
  noteIdPrefix = 'note'
): string {
  return `${noteIdPrefix}-m${event.measure}-b${String(event.beat).replace('.', '_')}-${index + 1}`;
}

const FUNCTION_LABELS: Record<MelodyFunction, string> = {
  climax: 'Climax',
  cadence: 'Cadence',
  structural: 'Structural',
  opening: 'Opening',
  release: 'Release',
  connective_nht: 'Connective NHT',
};

function ensureFunctionNodes(graph: Graph): void {
  (Object.keys(FUNCTION_LABELS) as MelodyFunction[]).forEach((fn) => {
    const functionNodeId = `function-${fn}`;
    addNode(
      graph,
      makeArtifactNode(functionNodeId, 'leaf', FUNCTION_LABELS[fn], {
        function: fn,
      } as GraphValue),
    );
    addBranch(graph, ARTIFACT_ROOT_ID, 'contains', functionNodeId);
  });
}

export function buildMelodyGraph(melody: MelodyEvent[], options?: BuildMelodyGraphOptions): Graph {
  const collectionId = options?.collectionId ?? 'melody-events';
  const collectionLabel = options?.collectionLabel ?? 'Melody';
  const noteIdPrefix = options?.noteIdPrefix ?? 'note';
  const includeFunctions = options?.includeFunctions ?? true;
  const graph = createGraph(ARTIFACT_ROOT_ID);
  ensureArtifactRoot(graph);
  if (includeFunctions) {
    ensureFunctionNodes(graph);
  }

  const functionsByIndex = deriveMelodyFunctions(melody);

  addNode(
    graph,
    makeArtifactNode(
      collectionId,
      'branch',
      collectionLabel,
      { noteCount: melody.length } as GraphValue
    )
  );
  addBranch(graph, ARTIFACT_ROOT_ID, 'contains', collectionId);

  let previousNoteId: string | null = null;

  melody.forEach((event, index) => {
    const noteId = buildMelodyNoteNodeId(event, index, noteIdPrefix);
    addNode(
      graph,
      makeArtifactNode(noteId, 'leaf', `m${event.measure} b${event.beat}`, event as unknown as GraphValue)
    );
    addBranch(graph, collectionId, 'contains', noteId);

    setNodeState(graph, noteId, 'measure', event.measure);
    setNodeState(graph, noteId, 'beat', event.beat);
    setNodeState(graph, noteId, 'duration', event.duration);
    setNodeMeta(graph, noteId, 'role', event.role);
    setNodeMeta(graph, noteId, 'phraseIndex', event.phraseIndex ?? 0);

    const noteFunctions = includeFunctions ? functionsByIndex.get(index) : null;
    if (noteFunctions) {
      for (const fn of noteFunctions) {
        addBranch(graph, noteId, 'hasFunction', `function-${fn}`);
      }
    }

    if (previousNoteId) {
      addProgress(graph, previousNoteId, 'precedes', noteId);
    }
    previousNoteId = noteId;
  });
  
  return graph;
}


export function buildTargetMelodyGraph(melody: MelodyEvent[]): Graph {
  return buildMelodyGraph(melody, {
    collectionId: 'melody-events',
    collectionLabel: 'Melody',
  });
}
