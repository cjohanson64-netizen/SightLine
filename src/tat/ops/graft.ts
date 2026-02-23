import type { ArtifactGraph, GraphEdge, GraphNode, NodeKind } from '../models/schema';

export interface GraftArgs {
  parentId?: string;
  id: string;
  label?: string;
  data?: unknown;
  edgeKind?: string;
}

function hasNode(graph: ArtifactGraph, id: string): boolean {
  return graph.nodes.some((node) => node.id === id);
}

function ensureParent(graph: ArtifactGraph, parentId: string): void {
  if (!hasNode(graph, parentId)) {
    throw new Error(`Cannot graft: parent "${parentId}" does not exist.`);
  }
}

function graftNode(graph: ArtifactGraph, kind: NodeKind, args: GraftArgs): GraphNode {
  const parentId = args.parentId ?? graph.root;
  ensureParent(graph, parentId);

  if (hasNode(graph, args.id)) {
    throw new Error(`Cannot graft: node "${args.id}" already exists.`);
  }

  const node: GraphNode = {
    id: args.id,
    kind,
    label: args.label ?? args.id,
    data: args.data ?? {}
  };

  const edge: GraphEdge = {
    id: `${parentId}->${args.id}:${args.edgeKind ?? kind}`,
    from: parentId,
    to: args.id,
    kind: args.edgeKind ?? kind,
    data: {}
  };

  graph.nodes.push(node);
  graph.edges.push(edge);
  return node;
}

export function graftBranch(graph: ArtifactGraph, args: GraftArgs): GraphNode {
  return graftNode(graph, 'branch', args);
}

export function graftBud(graph: ArtifactGraph, args: GraftArgs): GraphNode {
  return graftNode(graph, 'bud', args);
}

export function graftLeaf(graph: ArtifactGraph, args: GraftArgs): GraphNode {
  return graftNode(graph, 'leaf', args);
}

export function graftVine(graph: ArtifactGraph, args: GraftArgs): GraphNode {
  return graftNode(graph, 'vine', args);
}
