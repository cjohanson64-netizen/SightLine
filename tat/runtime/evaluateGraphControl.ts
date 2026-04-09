import type {
  DeriveMetaExprNode,
  DeriveStateExprNode,
  GraphControlExprNode,
  GraphQueryExprNode,
  LoopCountExprNode,
  ValueExprNode,
} from "../ast/nodeTypes";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import type { Graph, GraphValue } from "./graph";
import { getNode, hasEdge } from "./graph";
import { evaluateValueExpr } from "./evaluateNodeCapture";
import type { ActionRegistry } from "./actionRegistry";

export const LOOP_SAFETY_CAP = 1000;
export const REACTIVE_TRIGGER_SAFETY_CAP = 1000;

export interface GraphControlScope {
  from?: string;
  to?: string;
}

export function evaluateGraphQuery(
  graph: Graph,
  query: GraphQueryExprNode,
  options?: {
    scope?: GraphControlScope;
    bindings?: RuntimeBindings;
    actions?: ActionRegistry;
  },
): boolean {
  const scope = options?.scope;
  const bindings = options?.bindings;
  const actions = options?.actions;

  const usesEdgeMode =
    query.subject !== null || query.relation !== null || query.object !== null;
  const usesStateMode = query.state !== null;
  const usesMetaMode = query.meta !== null;
  const modeCount = Number(usesEdgeMode) + Number(usesStateMode) + Number(usesMetaMode);

  if (modeCount !== 1) {
    throw new Error(
      "@query must use exactly one mode: edge existence, state query, or meta query",
    );
  }

  if (usesEdgeMode) {
    if (!query.subject || !query.relation || !query.object) {
      throw new Error("@query edge existence requires subject, relation, and object");
    }

    if (query.equals) {
      throw new Error('@query edge existence does not support an "equals" field');
    }

    const subject = resolveNodeRef(query.subject.name, scope, bindings);
    const object = resolveNodeRef(query.object.name, scope, bindings);
    return hasEdge(graph, subject, query.relation.value, object);
  }

  if (!query.node) {
    throw new Error("@query state/meta mode requires a node field");
  }

  const nodeId = resolveNodeRef(query.node.name, scope, bindings);
  const node = getNode(graph, nodeId);

  if (query.state) {
    if (query.meta) {
      throw new Error('@query cannot combine "state" and "meta" fields');
    }

    const hasKey = Object.prototype.hasOwnProperty.call(node.state, query.state.value);
    if (!hasKey) {
      return false;
    }

    if (!query.equals) {
      return true;
    }

    const expected = evaluateGraphValue(query.equals, bindings, actions);
    return graphValueEquals(node.state[query.state.value], expected);
  }

  if (query.meta) {
    const hasKey = Object.prototype.hasOwnProperty.call(node.meta, query.meta.value);
    if (!hasKey) {
      return false;
    }

    if (!query.equals) {
      return true;
    }

    const expected = evaluateGraphValue(query.equals, bindings, actions);
    return graphValueEquals(node.meta[query.meta.value], expected);
  }

  throw new Error('@query state/meta mode requires either a "state" or "meta" field');
}

export function evaluateGraphControlExpr(
  graph: Graph,
  expr: GraphControlExprNode,
  options?: {
    scope?: GraphControlScope;
    bindings?: RuntimeBindings;
    actions?: ActionRegistry;
  },
): boolean {
  if (expr.type === "BooleanLiteral") {
    return expr.value;
  }

  return evaluateGraphQuery(graph, expr, options);
}

export function evaluateLoopCount(
  graph: Graph,
  countExpr: LoopCountExprNode,
  options?: {
    scope?: GraphControlScope;
    bindings?: RuntimeBindings;
  },
): number {
  const value =
    countExpr.type === "NumberLiteral"
      ? countExpr.value
      : countExpr.type === "DeriveStateExpr"
        ? evaluateDeriveState(graph, countExpr, options)
        : evaluateDeriveMeta(graph, countExpr, options);

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("@loop count must resolve to a number");
  }

  if (!Number.isInteger(value)) {
    throw new Error("@loop count must resolve to a non-negative integer");
  }

  if (value < 0) {
    throw new Error("@loop count cannot be negative");
  }

  return value;
}

export function evaluateDeriveState(
  graph: Graph,
  expr: DeriveStateExprNode,
  options?: {
    scope?: GraphControlScope;
    bindings?: RuntimeBindings;
  },
): GraphValue {
  if (!expr.node) {
    throw new Error("@derive.state requires a node field");
  }

  if (!expr.key) {
    throw new Error("@derive.state requires a key field");
  }

  const nodeId = resolveNodeRef(expr.node.name, options?.scope, options?.bindings);
  const node = getNode(graph, nodeId);

  if (!Object.prototype.hasOwnProperty.call(node.state, expr.key.value)) {
    throw new Error(
      `@derive.state could not find state key "${expr.key.value}" on node "${nodeId}"`,
    );
  }

  return node.state[expr.key.value];
}

export function evaluateDeriveMeta(
  graph: Graph,
  expr: DeriveMetaExprNode,
  options?: {
    scope?: GraphControlScope;
    bindings?: RuntimeBindings;
  },
): GraphValue {
  if (!expr.node) {
    throw new Error("@derive.meta requires a node field");
  }

  if (!expr.key) {
    throw new Error("@derive.meta requires a key field");
  }

  const nodeId = resolveNodeRef(expr.node.name, options?.scope, options?.bindings);
  const node = getNode(graph, nodeId);

  if (!Object.prototype.hasOwnProperty.call(node.meta, expr.key.value)) {
    throw new Error(
      `@derive.meta could not find meta key "${expr.key.value}" on node "${nodeId}"`,
    );
  }

  return node.meta[expr.key.value];
}

function resolveNodeRef(
  name: string,
  scope?: GraphControlScope,
  bindings?: RuntimeBindings,
): string {
  if (name === "from" && scope?.from) return scope.from;
  if (name === "to" && scope?.to) return scope.to;
  if (bindings?.nodes.has(name)) return bindings.nodes.get(name)!.id;

  const boundValue = bindings?.values.get(name);
  if (typeof boundValue === "string") {
    return boundValue;
  }

  return name;
}

function evaluateGraphValue(
  value: ValueExprNode,
  bindings?: RuntimeBindings,
  actions?: ActionRegistry,
): GraphValue {
  if (!bindings || !actions) {
    if (value.type === "Identifier") {
      return value.name;
    }
  }

  return evaluateValueExpr(
    value,
    bindings ?? { values: new Map(), nodes: new Map() },
    actions ?? new Map(),
  );
}

function graphValueEquals(left: GraphValue, right: GraphValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
