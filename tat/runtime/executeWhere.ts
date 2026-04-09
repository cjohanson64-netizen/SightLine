import type {
  BinaryBooleanExprNode,
  BooleanExprNode,
  BooleanValueNode,
  ComparisonExprNode,
  GroupedBooleanExprNode,
  PropertyAccessNode,
  UnaryBooleanExprNode,
} from "../ast/nodeTypes";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import type { Graph, GraphEdge, GraphNode, GraphValue } from "./graph";
import type { MatchResult, MatchResultSet } from "./executeQuery";

export interface FilteredResultSet {
  kind: "FilteredResultSet";
  sourceKind: "MatchResultSet";
  condition: string;
  items: MatchResult[];
}

export interface WhereResultSet {
  kind: "WhereResultSet";
  sourceKind: "node" | "edge";
  condition: string;
  items: GraphNode[] | GraphEdge[];
}

type WhereReferenceKind = "node" | "edge" | "mixed" | "unknown";

export function executeWhere(
  graph: Graph,
  source: MatchResultSet,
  condition: BooleanExprNode,
): FilteredResultSet {
  const items = source.items.filter((item) =>
    evaluateBooleanExpr(condition, graph, item.bindings),
  );

  return {
    kind: "FilteredResultSet",
    sourceKind: "MatchResultSet",
    condition: printBooleanExpr(condition),
    items,
  };
}

export function executeWhereQuery(
  graph: Graph,
  condition: BooleanExprNode,
  bindings: RuntimeBindings,
): WhereResultSet {
  const sourceKind = inferWhereReferenceKind(condition);

  if (sourceKind === "unknown") {
    throw new Error(`@where must reference either node.* or edge.*`);
  }

  if (sourceKind === "mixed") {
    throw new Error(`@where cannot mix node.* and edge.* references`);
  }

  if (sourceKind === "node") {
    return {
      kind: "WhereResultSet",
      sourceKind,
      condition: printBooleanExpr(condition),
      items: Array.from(graph.nodes.values())
        .filter((node) => evaluateWhereTargetExpr(condition, "node", node, bindings))
        .map(cloneNode),
    };
  }

  return {
    kind: "WhereResultSet",
    sourceKind,
    condition: printBooleanExpr(condition),
    items: graph.edges
      .filter((edge) => evaluateWhereTargetExpr(condition, "edge", edge, bindings))
      .map(cloneEdge),
  };
}

function evaluateBooleanExpr(
  expr: BooleanExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return evaluateBinaryBoolean(expr, graph, bindings);

    case "UnaryBooleanExpr":
      return !evaluateBooleanExpr(expr.argument, graph, bindings);

    case "GroupedBooleanExpr":
      return evaluateBooleanExpr(expr.expression, graph, bindings);

    case "ComparisonExpr":
      return evaluateComparison(expr, graph, bindings);

    case "Identifier": {
      const value = resolveIdentifier(expr.name, bindings);
      return truthy(value);
    }

    case "PropertyAccess": {
      const value = resolvePropertyAccess(expr, graph, bindings);
      return truthy(value);
    }

    case "StringLiteral":
      return truthy(expr.value);

    case "NumberLiteral":
      return truthy(expr.value);

    case "BooleanLiteral":
      return expr.value;

    case "RegexLiteral":
      return truthy(expr.raw);

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function evaluateWhereTargetExpr(
  expr: BooleanExprNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return evaluateWhereBinaryBoolean(expr, context, item, bindings);

    case "UnaryBooleanExpr":
      return !evaluateWhereTargetExpr(expr.argument, context, item, bindings);

    case "GroupedBooleanExpr":
      return evaluateWhereTargetExpr(expr.expression, context, item, bindings);

    case "ComparisonExpr":
      return evaluateWhereComparison(expr, context, item, bindings);

    case "Identifier":
      return truthy(resolveWhereIdentifier(expr.name, context, item, bindings));

    case "PropertyAccess":
      return truthy(resolveWherePropertyAccess(expr, context, item, bindings));

    case "StringLiteral":
      return truthy(expr.value);

    case "NumberLiteral":
      return truthy(expr.value);

    case "BooleanLiteral":
      return expr.value;

    case "RegexLiteral":
      return truthy(expr.raw);

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function evaluateBinaryBoolean(
  expr: BinaryBooleanExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  if (expr.operator === "&&") {
    return (
      evaluateBooleanExpr(expr.left, graph, bindings) &&
      evaluateBooleanExpr(expr.right, graph, bindings)
    );
  }

  if (expr.operator === "||") {
    return (
      evaluateBooleanExpr(expr.left, graph, bindings) ||
      evaluateBooleanExpr(expr.right, graph, bindings)
    );
  }

  throw new Error(`Unsupported boolean operator "${expr.operator}"`);
}

function evaluateWhereBinaryBoolean(
  expr: BinaryBooleanExprNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  if (expr.operator === "&&") {
    return (
      evaluateWhereTargetExpr(expr.left, context, item, bindings) &&
      evaluateWhereTargetExpr(expr.right, context, item, bindings)
    );
  }

  if (expr.operator === "||") {
    return (
      evaluateWhereTargetExpr(expr.left, context, item, bindings) ||
      evaluateWhereTargetExpr(expr.right, context, item, bindings)
    );
  }

  throw new Error(`Unsupported boolean operator "${expr.operator}"`);
}

function evaluateComparison(
  expr: ComparisonExprNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): boolean {
  const left = resolveBooleanValue(expr.left, graph, bindings);
  const right = resolveBooleanValue(expr.right, graph, bindings);
  return applyComparisonOperator(expr.operator, left, right);
}

function evaluateWhereComparison(
  expr: ComparisonExprNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  const left = resolveWhereBooleanValue(expr.left, context, item, bindings);
  const right = resolveWhereBooleanValue(expr.right, context, item, bindings);
  return applyComparisonOperator(expr.operator, left, right);
}

function applyComparisonOperator(
  operator: ComparisonExprNode["operator"],
  left: GraphValue,
  right: GraphValue,
): boolean {
  switch (operator) {
    case "==":
      return compareCaseInsensitive(left, right);

    case "===":
      return compareStrict(left, right);

    case "!=":
      return !compareCaseInsensitive(left, right);

    case "!==":
      return !compareStrict(left, right);

    default: {
      const _exhaustive: never = operator;
      throw new Error(`Unsupported comparison operator "${_exhaustive}"`);
    }
  }
}

function resolveBooleanValue(
  value: BooleanValueNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveIdentifier(value.name, bindings);

    case "PropertyAccess":
      return resolvePropertyAccess(value, graph, bindings);

    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "RegexLiteral":
      return value.raw;

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveWhereBooleanValue(
  value: BooleanValueNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveWhereIdentifier(value.name, context, item, bindings);

    case "PropertyAccess":
      return resolveWherePropertyAccess(value, context, item, bindings);

    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "RegexLiteral":
      return value.raw;

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveIdentifier(
  name: string,
  bindings: Record<string, GraphValue>,
): GraphValue {
  if (name in bindings) {
    return bindings[name];
  }

  return name;
}

function resolveWhereIdentifier(
  name: string,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  if (name === "node") {
    return context === "node" ? whereNodeToValue(item as GraphNode) : null;
  }

  if (name === "edge") {
    return context === "edge" ? whereEdgeToValue(item as GraphEdge) : null;
  }

  if (bindings.values.has(name)) {
    return bindings.values.get(name)!;
  }

  if (bindings.nodes.has(name)) {
    return bindings.nodes.get(name)!.id;
  }

  return name;
}

function resolvePropertyAccess(
  access: PropertyAccessNode,
  graph: Graph,
  bindings: Record<string, GraphValue>,
): GraphValue {
  const base = resolveIdentifier(access.object.name, bindings);

  if (typeof base === "string" && graph.nodes.has(base)) {
    const node = graph.nodes.get(base)!;
    const first = access.chain[0]?.name;
    if (!first) return null;

    if (first === "state") {
      return dig(node.state, access.chain.slice(1).map((part) => part.name));
    }

    if (first === "meta") {
      return dig(node.meta, access.chain.slice(1).map((part) => part.name));
    }

    if (first === "value") {
      return dig(node.value, access.chain.slice(1).map((part) => part.name));
    }

    if (first in node.state) {
      return dig(node.state, access.chain.map((part) => part.name));
    }

    if (first in node.meta) {
      return dig(node.meta, access.chain.map((part) => part.name));
    }

    if (isRecord(node.value) && first in node.value) {
      return dig(node.value, access.chain.map((part) => part.name));
    }

    return null;
  }

  if (isRecord(base)) {
    return dig(base, access.chain.map((part) => part.name));
  }

  return null;
}

function resolveWherePropertyAccess(
  access: PropertyAccessNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue {
  const objectName = access.object.name;
  const path = access.chain.map((part) => part.name);

  if (objectName === "node") {
    if (context !== "node") return null;
    return dig(whereNodeToValue(item as GraphNode), path);
  }

  if (objectName === "edge") {
    if (context !== "edge") return null;
    return dig(whereEdgeToValue(item as GraphEdge), path);
  }

  const base = resolveWhereIdentifier(objectName, context, item, bindings);
  if (isRecord(base)) {
    return dig(base, path);
  }

  return null;
}

function dig(value: GraphValue, path: string[]): GraphValue {
  let current: GraphValue = value;

  for (const key of path) {
    if (!isRecord(current)) return null;
    if (!(key in current)) return null;
    current = current[key];
  }

  return current;
}

function whereNodeToValue(node: GraphNode): Record<string, GraphValue> {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function whereEdgeToValue(edge: GraphEdge): Record<string, GraphValue> {
  return {
    id: edge.id,
    from: edge.subject,
    to: edge.object,
    rel: edge.relation,
    subject: edge.subject,
    object: edge.object,
    relation: edge.relation,
    kind: edge.kind,
    context: edge.context,
  };
}

function compareStrict(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareCaseInsensitive(a: GraphValue, b: GraphValue): boolean {
  const aNorm = normalizeCaseInsensitive(a);
  const bNorm = normalizeCaseInsensitive(b);
  return JSON.stringify(aNorm) === JSON.stringify(bNorm);
}

function normalizeCaseInsensitive(value: GraphValue): GraphValue {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCaseInsensitive(item));
  }

  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeCaseInsensitive(v);
    }
    return out;
  }

  return value;
}

function inferWhereReferenceKind(expr: BooleanExprNode): WhereReferenceKind {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return mergeWhereReferenceKinds(
        inferWhereReferenceKind(expr.left),
        inferWhereReferenceKind(expr.right),
      );

    case "UnaryBooleanExpr":
      return inferWhereReferenceKind(expr.argument);

    case "GroupedBooleanExpr":
      return inferWhereReferenceKind(expr.expression);

    case "ComparisonExpr":
      return mergeWhereReferenceKinds(
        inferWhereValueReferenceKind(expr.left),
        inferWhereValueReferenceKind(expr.right),
      );

    case "Identifier":
      if (expr.name === "node") return "node";
      if (expr.name === "edge") return "edge";
      return "unknown";

    case "PropertyAccess":
      if (expr.object.name === "node") return "node";
      if (expr.object.name === "edge") return "edge";
      return "unknown";

    default:
      return "unknown";
  }
}

function inferWhereValueReferenceKind(value: BooleanValueNode): WhereReferenceKind {
  switch (value.type) {
    case "Identifier":
      if (value.name === "node") return "node";
      if (value.name === "edge") return "edge";
      return "unknown";

    case "PropertyAccess":
      if (value.object.name === "node") return "node";
      if (value.object.name === "edge") return "edge";
      return "unknown";

    default:
      return "unknown";
  }
}

function mergeWhereReferenceKinds(
  left: WhereReferenceKind,
  right: WhereReferenceKind,
): WhereReferenceKind {
  if (left === "mixed" || right === "mixed") {
    return "mixed";
  }

  if (left === "unknown") {
    return right;
  }

  if (right === "unknown") {
    return left;
  }

  if (left !== right) {
    return "mixed";
  }

  return left;
}

function truthy(value: GraphValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return false;
}

function isRecord(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    context: deepClone(edge.context),
  };
}

function deepClone<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepClone(item);
    }
    return out as T;
  }

  return value;
}

function deepCloneRecord<T extends Record<string, GraphValue>>(record: T): T {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = deepClone(value);
  }
  return out as T;
}

function printBooleanExpr(expr: BooleanExprNode): string {
  switch (expr.type) {
    case "BinaryBooleanExpr":
      return `${printBooleanExpr(expr.left)} ${expr.operator} ${printBooleanExpr(expr.right)}`;

    case "UnaryBooleanExpr":
      return `!${printBooleanExpr(expr.argument)}`;

    case "GroupedBooleanExpr":
      return `(${printBooleanExpr(expr.expression)})`;

    case "ComparisonExpr":
      return `${printBooleanValue(expr.left)} ${expr.operator} ${printBooleanValue(expr.right)}`;

    case "PropertyAccess":
      return `${expr.object.name}.${expr.chain.map((c) => c.name).join(".")}`;

    case "Identifier":
      return expr.name;

    case "StringLiteral":
      return expr.raw;

    case "NumberLiteral":
      return expr.raw;

    case "BooleanLiteral":
      return expr.raw;

    case "RegexLiteral":
      return expr.raw;

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unsupported boolean print expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function printBooleanValue(value: BooleanValueNode): string {
  switch (value.type) {
    case "Identifier":
      return value.name;

    case "PropertyAccess":
      return `${value.object.name}.${value.chain.map((c) => c.name).join(".")}`;

    case "StringLiteral":
      return value.raw;

    case "NumberLiteral":
      return value.raw;

    case "BooleanLiteral":
      return value.raw;

    case "RegexLiteral":
      return value.raw;

    default: {
      const _exhaustive: never = value;
      throw new Error(`Unsupported boolean print value: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
