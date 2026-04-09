import type {
  ArrayLiteralNode,
  BindEntity,
  IdentifierNode,
  ObjectLiteralNode,
  ValueExprNode,
  WhereExprNode,
} from "../ast/nodeTypes";
import type { ActionRegistry } from "./actionRegistry";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import {
  evaluateCapturedShape,
} from "./evaluateNodeCapture";
import type { Graph, GraphEdge, GraphNode, GraphValue } from "./graph";
import { executeWhereQuery } from "./executeWhere";

export type BindValue =
  | GraphValue
  | GraphNode
  | GraphEdge
  | { [key: string]: BindValue }
  | BindValue[];

export type BindResultKind = BindEntity | "empty" | "value" | "mixed";

export function evaluateBindExpr(
  expr: ValueExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
  graph: Graph | null,
): BindValue {
  switch (expr.type) {
    case "Identifier":
      return evaluateBindIdentifier(expr, bindings, graph);

    case "StringLiteral":
      return expr.value;

    case "NumberLiteral":
      return expr.value;

    case "BooleanLiteral":
      return expr.value;

    case "NodeCapture":
      return evaluateCapturedShape(expr, bindings, actions);

    case "WhereExpr":
      return evaluateBindWhereExpr(expr, bindings, graph);

    case "ObjectLiteral":
      return evaluateBindObject(expr, bindings, actions, graph);

    case "ArrayLiteral":
      return evaluateBindArray(expr, bindings, actions, graph);

    default:
      return exhaustiveNever(expr);
  }
}

function evaluateBindWhereExpr(
  expr: WhereExprNode,
  bindings: RuntimeBindings,
  graph: Graph | null,
): BindValue {
  if (!graph) {
    throw new Error(`@where requires an active graph from @seed or a graph pipeline`);
  }

  return executeWhereQuery(graph, expr.expression, bindings).items as BindValue;
}

export function classifyBindValue(value: BindValue): BindResultKind {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "empty";
    }

    let found: BindEntity | null = null;

    for (const item of value) {
      const kind = classifyBindValue(item);

      if (kind === "empty") {
        continue;
      }

      if (kind !== "node" && kind !== "edge") {
        return "value";
      }

      if (found && found !== kind) {
        return "mixed";
      }

      found = kind;
    }

    return found ?? "empty";
  }

  if (isGraphNode(value)) {
    return "node";
  }

  if (isGraphEdge(value)) {
    return "edge";
  }

  return "value";
}

function evaluateBindIdentifier(
  node: IdentifierNode,
  bindings: RuntimeBindings,
  graph: Graph | null,
): BindValue {
  if (bindings.nodes.has(node.name)) {
    return cloneGraphNode(bindings.nodes.get(node.name)!);
  }

  if (graph) {
    const edge = graph.edges.find((item) => item.id === node.name);
    if (edge) {
      return cloneGraphEdge(edge);
    }
  }

  if (bindings.values.has(node.name)) {
    return deepClone(bindings.values.get(node.name)!);
  }

  return node.name;
}

function evaluateBindObject(
  node: ObjectLiteralNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
  graph: Graph | null,
): Record<string, BindValue> {
  const out: Record<string, BindValue> = {};

  for (const prop of node.properties) {
    out[prop.key] = evaluateBindExpr(prop.value, bindings, actions, graph);
  }

  return out;
}

function evaluateBindArray(
  node: ArrayLiteralNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
  graph: Graph | null,
): BindValue[] {
  return node.elements.map((element) => evaluateBindExpr(element, bindings, actions, graph));
}

function isGraphNode(value: unknown): value is GraphNode {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as GraphNode).id === "string" &&
    "value" in (value as GraphNode) &&
    isRecord((value as GraphNode).state) &&
    isRecord((value as GraphNode).meta)
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as GraphEdge).id === "string" &&
    typeof (value as GraphEdge).subject === "string" &&
    typeof (value as GraphEdge).relation === "string" &&
    typeof (value as GraphEdge).object === "string" &&
    ((value as GraphEdge).kind === "branch" || (value as GraphEdge).kind === "progress")
  );
}

function cloneGraphNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function cloneGraphEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    context: deepClone(edge.context),
  };
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = deepClone(item);
  }
  return out as T;
}

function deepCloneRecord<T extends Record<string, GraphValue>>(record: T): T {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = deepClone(value);
  }
  return out as T;
}

function isRecord(value: unknown): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exhaustiveNever(value: never): never {
  throw new Error(`Unexpected bind expression: ${JSON.stringify(value)}`);
}
