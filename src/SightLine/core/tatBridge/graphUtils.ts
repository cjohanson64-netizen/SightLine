import type { ArtifactGraph } from "@/SightLine/domain/artifact";

export function createEmptyGraph(rootId = "artifact-root"): ArtifactGraph {
  return {
    nodes: [
      {
        id: rootId,
        kind: "artifact",
        label: "Exercise Artifact Root",
        data: {},
      },
    ],
    edges: [],
    root: rootId,
  };
}

export function assertGraphInvariant(graph: ArtifactGraph): void {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    typeof graph.root !== "string"
  ) {
    throw new Error(
      "Graph invariant failed: expected { nodes: [], edges: [], root }.",
    );
  }

  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(graph.root)) {
    throw new Error(
      `Graph invariant failed: root node "${graph.root}" is missing.`,
    );
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(
        `Graph invariant failed: edge "${edge.id}" has dangling endpoints.`,
      );
    }
  }
}
