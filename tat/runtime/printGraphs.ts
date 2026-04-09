import type { Graph, GraphEdge, GraphNode, GraphValue } from "./graph";

export function printGraph(graph: Graph, name = "graph"): string {
  const lines: string[] = [];

  lines.push(name);

  lines.push(`  root: ${graph.root ?? "null"}`);

  lines.push("");
  lines.push("  nodes:");
  if (graph.nodes.size === 0) {
    lines.push("    (none)");
  } else {
    for (const node of graph.nodes.values()) {
      lines.push(...printNode(node, 2));
    }
  }

  lines.push("");
  lines.push("  edges:");
  if (graph.edges.length === 0) {
    lines.push("    (none)");
  } else {
    for (const edge of graph.edges) {
      lines.push(`    ${printEdge(edge)}`);
    }
  }

  const stateLines = printNodeState(graph);
  lines.push("");
  lines.push("  state:");
  if (stateLines.length === 0) {
    lines.push("    (none)");
  } else {
    lines.push(...stateLines.map((line) => `    ${line}`));
  }

  const metaLines = printNodeMeta(graph);
  lines.push("");
  lines.push("  meta:");
  if (metaLines.length === 0) {
    lines.push("    (none)");
  } else {
    lines.push(...metaLines.map((line) => `    ${line}`));
  }

  lines.push("");
  lines.push("  history:");
  if (graph.history.length === 0) {
    lines.push("    (none)");
  } else {
    for (const entry of graph.history) {
      lines.push(`    ${entry.op} ${formatInlineValue(entry.payload)}`);
    }
  }

  return lines.join("\n");
}

export function printGraphs(graphs: Map<string, Graph>): string {
  const parts: string[] = [];

  for (const [name, graph] of graphs.entries()) {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(printGraph(graph, name));
  }

  if (parts.length === 0) {
    return "(no graphs)";
  }

  return parts.join("\n");
}

function printNode(node: GraphNode, indent: number): string[] {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  lines.push(`${pad}${node.id}`);
  lines.push(`${pad}  value: ${formatInlineValue(node.value)}`);

  return lines;
}

function printEdge(edge: GraphEdge): string {
  const connector = edge.kind === "progress" ? "~~" : "--";
  return `${edge.subject} ${connector}${edge.relation}${connector}> ${edge.object} [${edge.kind}]`;
}

function printNodeState(graph: Graph): string[] {
  const lines: string[] = Object.entries(graph.state).map(
    ([key, value]) => `${key} = ${formatInlineValue(value)}`,
  );

  for (const node of graph.nodes.values()) {
    for (const [key, value] of Object.entries(node.state)) {
      lines.push(`${node.id}.${key} = ${formatInlineValue(value)}`);
    }
  }

  return lines;
}

function printNodeMeta(graph: Graph): string[] {
  const lines: string[] = Object.entries(graph.meta).map(
    ([key, value]) => `${key} = ${formatInlineValue(value)}`,
  );

  for (const node of graph.nodes.values()) {
    for (const [key, value] of Object.entries(node.meta)) {
      lines.push(`${node.id}.${key} = ${formatInlineValue(value)}`);
    }
  }

  return lines;
}

function formatInlineValue(value: GraphValue): string {
  if (value === null) return "null";

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => formatInlineValue(item)).join(", ")}]`;
  }

  return formatObjectInline(value);
}

function formatObjectInline(value: Record<string, GraphValue>): string {
  const entries = Object.entries(value).map(
    ([key, v]) => `${key}: ${formatInlineValue(v)}`
  );
  return `{ ${entries.join(", ")} }`;
}
