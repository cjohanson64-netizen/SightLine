import type { PathExprNode } from "../ast/nodeTypes";
import type { Graph, GraphEdge, GraphValue } from "./graph";

export interface PathResult {
  kind: "PathResult";
  steps: GraphEdge[];
  length: number;
}

export interface PathResultSet {
  kind: "PathResultSet";
  from: GraphValue;
  to: GraphValue;
  items: PathResult[];
}

export function executePath(graph: Graph, query: PathExprNode): PathResultSet {
  const from = resolvePathEndpoint(query.from);
  const to = resolvePathEndpoint(query.to);

  if (typeof from !== "string" || typeof to !== "string") {
    return {
      kind: "PathResultSet",
      from,
      to,
      items: [],
    };
  }

  const items = findAllPaths(graph, from, to).map<PathResult>((steps) => ({
    kind: "PathResult",
    steps,
    length: steps.length,
  }));

  return {
    kind: "PathResultSet",
    from,
    to,
    items,
  };
}

function resolvePathEndpoint(value: PathExprNode["from"] | PathExprNode["to"]): GraphValue {
  switch (value.type) {
    case "Identifier":
      return value.name;

    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "NodeCapture":
      return "<capture>";

    case "WhereExpr":
      return "@where(...)";

    case "ObjectLiteral":
      return "{object}";

    case "ArrayLiteral":
      return "[array]";

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported path endpoint: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function findAllPaths(graph: Graph, from: string, to: string): GraphEdge[][] {
  const results: GraphEdge[][] = [];
  const visited = new Set<string>([from]);

  dfs(graph, from, to, visited, [], results);

  return dedupePaths(results);
}

function dfs(
  graph: Graph,
  current: string,
  target: string,
  visited: Set<string>,
  path: GraphEdge[],
  results: GraphEdge[][],
): void {
  if (current === target) {
    results.push([...path]);
    return;
  }

  const outgoing = graph.edges.filter((edge) => edge.subject === current);

  for (const edge of outgoing) {
    if (visited.has(edge.object)) {
      continue;
    }

    visited.add(edge.object);
    path.push(edge);

    dfs(graph, edge.object, target, visited, path, results);

    path.pop();
    visited.delete(edge.object);
  }
}

function dedupePaths(paths: GraphEdge[][]): GraphEdge[][] {
  const seen = new Set<string>();
  const out: GraphEdge[][] = [];

  for (const path of paths) {
    const key = path.map((edge) => edge.id).join("->");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }

  return out;
}
