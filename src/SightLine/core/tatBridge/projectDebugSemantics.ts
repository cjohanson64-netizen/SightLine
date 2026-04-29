import type {
  ArtifactGraph,
  DebugProjectedMelodyFunction,
  DebugProjectedTargetNote,
  DebugSemanticsProjection,
  GraphNode
} from '@/SightLine/domain/artifact';
import type { MelodyEvent } from '@/SightLine/domain/music';
import { projectPhraseSemanticsSummaries } from './projectPhraseSemanticsSummaries';

function dataAs<T>(node: GraphNode | undefined): T | null {
  if (!node || !node.data || typeof node.data !== 'object') {
    return null;
  }
  return node.data as T;
}

function buildNodeMap(graph: ArtifactGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function relationTargets(
  graph: ArtifactGraph,
  from: string,
  kind: string
): string[] {
  return graph.edges
    .filter((edge) => edge.from === from && edge.kind === kind)
    .map((edge) => edge.to);
}

export function projectDebugSemantics(graph: ArtifactGraph): DebugSemanticsProjection {
  const nodesById = buildNodeMap(graph);

  const targetNotes: DebugProjectedTargetNote[] = relationTargets(graph, 'melody-events', 'contains')
    .map((noteId) => {
      const node = nodesById.get(noteId);
      const event = dataAs<MelodyEvent>(node);
      if (!node || !event) {
        return null;
      }

      const functions = relationTargets(graph, noteId, 'hasFunction')
        .map((functionNodeId) => dataAs<{ function?: string }>(nodesById.get(functionNodeId))?.function ?? null)
        .filter((fn): fn is DebugProjectedMelodyFunction => fn !== null);

      return {
        noteId,
        measure: event.measure,
        beat: event.beat,
        pitch: event.pitch,
        phraseIndex: event.phraseIndex ?? 0,
        functions
      };
    })
    .filter((note): note is DebugProjectedTargetNote => note !== null);

  return {
    targetNotes,
    phraseSummaries: projectPhraseSemanticsSummaries(targetNotes),
    strengths: [],
    weaknesses: [],
    recommendation: null
  };
}
