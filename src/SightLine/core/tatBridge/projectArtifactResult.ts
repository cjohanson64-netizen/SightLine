import { graphToDebugObject } from '@tat/runtime/graph';
import type { ExecuteProgramResult } from '@tat/runtime/executeProgram';
import type { ArtifactGraph, GraphNode, NodeKind } from '@/SightLine/domain/artifact';
import { projectDebugSemantics } from './projectDebugSemantics';

const KNOWN_KINDS = new Set<NodeKind>([
  'artifact',
  'branch',
  'bud',
  'leaf',
  'vine',
  'tonnetzNode',
  'harmonyEvent',
  'melodyEvent',
  'metric'
]);

function resolveKind(value: unknown): NodeKind {
  if (
    value &&
    typeof value === 'object' &&
    'kind' in value &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    KNOWN_KINDS.has((value as { kind: NodeKind }).kind)
  ) {
    return (value as { kind: NodeKind }).kind;
  }
  return 'branch';
}

function resolveLabel(id: string, value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'label' in value &&
    typeof (value as { label?: unknown }).label === 'string'
  ) {
    return (value as { label: string }).label;
  }
  return id;
}

function resolveData(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data?: unknown }).data ?? {};
  }
  return value ?? {};
}

export function projectArtifactResult(
  execution: ExecuteProgramResult,
  graphName = 'exerciseArtifact'
): ArtifactGraph {
  const graph = execution.state.graphs.get(graphName);
  if (!graph) {
    throw new Error(`Expected TAT graph "${graphName}" to exist after execution`);
  }

  const debug = graphToDebugObject(graph);
  const nodes = debug.nodes.map(
    (node): GraphNode => ({
      id: node.id,
      kind: resolveKind(node.value),
      label: resolveLabel(node.id, node.value),
      data: resolveData(node.value)
    })
  );
  const edges = debug.edges.map((edge) => ({
    id: edge.id,
    from: edge.subject,
    to: edge.object,
    kind: edge.relation,
    data: {
      relation: edge.relation,
      graphKind: edge.kind,
      context: edge.context
    }
  }));

  return {
    root: debug.root ?? 'artifact-root',
    nodes,
    edges,
    debugSemantics: projectDebugSemantics({
      root: debug.root ?? 'artifact-root',
      nodes,
      edges
    })
  };
}
