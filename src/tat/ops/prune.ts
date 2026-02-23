import type { ArtifactGraph } from '../models/schema';

export interface PruneNodeArgs {
  nodeId: string;
}

export interface PruneByKindArgs {
  kind: string;
  keepIds?: string[];
}

function pruneNodeInternal(graph: ArtifactGraph, nodeId: string): void {
  if (nodeId === graph.root) {
    return;
  }

  graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
  graph.edges = graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
}

export function pruneNode(graph: ArtifactGraph, args: PruneNodeArgs): void {
  pruneNodeInternal(graph, args.nodeId);
}

export function pruneByKind(graph: ArtifactGraph, args: PruneByKindArgs): void {
  const keep = new Set(args.keepIds ?? []);
  const removeIds = graph.nodes
    .filter((node) => node.kind === args.kind && !keep.has(node.id))
    .map((node) => node.id);

  for (const nodeId of removeIds) {
    pruneNodeInternal(graph, nodeId);
  }
}

export function pruneDisconnected(graph: ArtifactGraph): void {
  const reachable = new Set<string>();
  const stack = [graph.root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);
    const outgoing = graph.edges.filter((edge) => edge.from === current).map((edge) => edge.to);
    stack.push(...outgoing);
  }

  graph.nodes = graph.nodes.filter((node) => reachable.has(node.id));
  graph.edges = graph.edges.filter((edge) => reachable.has(edge.from) && reachable.has(edge.to));
}
