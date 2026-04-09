import type {
  GraphQueryExprNode,
  HowExprNode,
  IdentifierNode,
  MatchExprNode,
  PatternAtomNode,
  QueryExprNode,
  RegexLiteralNode,
  RelationPatternNode,
  StringLiteralNode,
  NumberLiteralNode,
  BooleanLiteralNode,
  WildcardNode,
  NodeCaptureNode,
  WhereExprNode,
} from "../ast/nodeTypes";
import type { Graph, GraphEdge, GraphValue } from "./graph";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import { evaluateCapturedShape } from "./evaluateNodeCapture";
import { executePath, type PathResultSet } from "./executePath";
import {
  executeWhere,
  executeWhereQuery,
  type FilteredResultSet,
  type WhereResultSet,
} from "./executeWhere";
import { executeWhy, type ReasonResultSet } from "./executeWhy";
import { getAction, type ActionRegistry } from "./actionRegistry";
import type { GraphWorkspace } from "./executeGraphInteraction";
import { evaluateGraphQuery } from "./evaluateGraphControl";

export interface MatchResult {
  kind: "MatchResult";
  bindings: Record<string, GraphValue>;
  matched: GraphEdge[];
}

export interface MatchResultSet {
  kind: "MatchResultSet";
  pattern: string;
  items: MatchResult[];
}

export interface UnsupportedQueryResult {
  kind: "UnsupportedQueryResult";
  queryType: string;
  message: string;
}

export interface BooleanQueryResult {
  kind: "BooleanQueryResult";
  value: boolean;
}

export interface HowResult {
  kind: "HowResult";
  binding: string;
  fromRef: string | null;
  toRef: string | null;
  from: unknown;
  to: unknown;
  action: unknown;
}

export type QueryExecutionResult =
  | MatchResultSet
  | FilteredResultSet
  | WhereResultSet
  | PathResultSet
  | ReasonResultSet
  | HowResult
  | BooleanQueryResult
  | UnsupportedQueryResult;

export function executeQuery(
  graph: Graph,
  query: QueryExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
  workspace?: GraphWorkspace,
): QueryExecutionResult {
  switch (query.type) {
    case "MatchExpr":
      return executeMatch(graph, query, bindings);

    case "PathExpr":
      return executePath(graph, query);

    case "WhyExpr":
      return executeWhy(graph, query, workspace);

    case "HowExpr":
      return executeHow(query, bindings, actions);

    case "WhereExpr":
      return executeWhereExpr(graph, query, bindings);

    case "GraphQueryExpr":
      return executeGraphQueryExpr(graph, query, bindings, actions);

    default: {
      const _exhaustive: never = query;
      throw new Error(`Unsupported query expression: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function executeGraphQueryExpr(
  graph: Graph,
  query: GraphQueryExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): BooleanQueryResult {
  return {
    kind: "BooleanQueryResult",
    value: evaluateGraphQuery(graph, query, { bindings, actions }),
  };
}

function executeWhereExpr(
  graph: Graph,
  query: WhereExprNode,
  bindings: RuntimeBindings,
): WhereResultSet {
  return executeWhereQuery(graph, query.expression, bindings);
}

function executeHow(
  query: HowExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): HowResult {
  const target = resolveHowTarget(query, bindings, actions);

  if (!isRecord(target) || target.kind !== "traversal") {
    throw new Error(`@how target must resolve to a traversal value`);
  }

  if (!Array.isArray(target.steps)) {
    throw new Error(`@how target must resolve to a traversal value`);
  }

  if (target.steps.length === 0) {
    throw new Error(`@how traversal must contain at least one step`);
  }

  const firstStep = target.steps[0];

  if (!isRecord(firstStep) || typeof firstStep.binding !== "string") {
    throw new Error(`@how traversal step is missing an action binding`);
  }

  const action = getAction(actions, firstStep.binding);
  if (!action) {
    throw new Error(`@how could not find action "${firstStep.binding}"`);
  }

  return {
    kind: "HowResult",
    binding: firstStep.binding,
    fromRef: typeof firstStep.fromRef === "string" ? firstStep.fromRef : null,
    toRef: typeof firstStep.toRef === "string" ? firstStep.toRef : null,
    from: firstStep.from ?? null,
    to: firstStep.to ?? null,
    action,
  };
}

function resolveHowTarget(
  query: HowExprNode,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): GraphValue {
  if (query.target.type === "Identifier") {
    if (bindings.values.has(query.target.name)) {
      return bindings.values.get(query.target.name)!;
    }
    return query.target.name;
  }

  return evaluateCapturedShape(query.target, bindings, actions);
}

export function executeMatch(
  graph: Graph,
  query: MatchExprNode,
  runtimeBindings: RuntimeBindings,
): MatchResultSet | FilteredResultSet {
  const base: MatchResultSet = {
    kind: "MatchResultSet",
    pattern: query.patterns.map(printRelationPattern).join("\n"),
    items: matchPatternBlock(graph, query.patterns, runtimeBindings),
  };

  if (query.where) {
    return executeWhere(graph, base, query.where);
  }

  return base;
}

function matchPatternBlock(
  graph: Graph,
  patterns: RelationPatternNode[],
  runtimeBindings: RuntimeBindings,
): MatchResult[] {
  if (patterns.length === 0) {
    return [];
  }

  let partials: PartialMatch[] = [
    {
      bindings: {},
      matched: [],
    },
  ];

  for (const pattern of patterns) {
    const nextPartials: PartialMatch[] = [];

    for (const partial of partials) {
      for (const edge of graph.edges) {
        const matched = tryMatchRelationPattern(
          pattern,
          edge,
          partial.bindings,
          runtimeBindings,
        );
        if (!matched) continue;

        nextPartials.push({
          bindings: matched,
          matched: [...partial.matched, edge],
        });
      }
    }

    partials = dedupePartials(nextPartials);
  }

  return partials.map<MatchResult>((partial) => ({
    kind: "MatchResult",
    bindings: partial.bindings,
    matched: partial.matched,
  }));
}

interface PartialMatch {
  bindings: Record<string, GraphValue>;
  matched: GraphEdge[];
}

function tryMatchRelationPattern(
  pattern: RelationPatternNode,
  edge: GraphEdge,
  existingBindings: Record<string, GraphValue>,
  runtimeBindings: RuntimeBindings,
): Record<string, GraphValue> | null {
  const leftBindings = tryMatchAtom(
    pattern.left,
    edge.subject,
    existingBindings,
    runtimeBindings,
  );
  if (!leftBindings) return null;

  const relationBindings = tryMatchAtom(
    pattern.relation,
    edge.relation,
    leftBindings,
    runtimeBindings,
  );
  if (!relationBindings) return null;

  const rightBindings = tryMatchAtom(
    pattern.right,
    edge.object,
    relationBindings,
    runtimeBindings,
  );
  if (!rightBindings) return null;

  return rightBindings;
}

function tryMatchAtom(
  atom: PatternAtomNode,
  candidate: GraphValue,
  bindings: Record<string, GraphValue>,
  runtimeBindings: RuntimeBindings,
): Record<string, GraphValue> | null {
  switch (atom.type) {
    case "Wildcard":
      return bindings;

    case "Identifier":
      return matchIdentifierAtom(atom, candidate, bindings, runtimeBindings);

    case "StringLiteral":
      return valuesEqual(atom.value, candidate) ? bindings : null;

    case "NumberLiteral":
      return valuesEqual(atom.value, candidate) ? bindings : null;

    case "BooleanLiteral":
      return valuesEqual(atom.value, candidate) ? bindings : null;

    case "RegexLiteral":
      return regexMatches(atom, candidate) ? bindings : null;

    case "NodeCapture": {
      const printed = printNodeCapture(atom);
      return valuesEqual(printed, candidate) ? bindings : null;
    }

    default: {
      const _exhaustive: never = atom;
      throw new Error(`Unsupported pattern atom: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function matchIdentifierAtom(
  atom: IdentifierNode,
  candidate: GraphValue,
  bindings: Record<string, GraphValue>,
  runtimeBindings: RuntimeBindings,
): Record<string, GraphValue> | null {
  const name = atom.name;

  // Bound runtime node = exact graph node id match
  if (runtimeBindings.nodes.has(name)) {
    return valuesEqual(name, candidate) ? bindings : null;
  }

  // Bound runtime value = exact value match
  if (runtimeBindings.values.has(name)) {
    const exactValue = runtimeBindings.values.get(name)!;
    return valuesEqual(exactValue, candidate) ? bindings : null;
  }

  // Existing query variable = unified match
  if (name in bindings) {
    return valuesEqual(bindings[name], candidate) ? bindings : null;
  }

  // Otherwise treat as a query variable
  return {
    ...bindings,
    [name]: candidate,
  };
}

function regexMatches(atom: RegexLiteralNode, candidate: GraphValue): boolean {
  const text = stringifyComparable(candidate);

  try {
    const regex = new RegExp(atom.pattern, atom.flags);
    return regex.test(text);
  } catch {
    return false;
  }
}

function stringifyComparable(value: GraphValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function valuesEqual(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupePartials(partials: PartialMatch[]): PartialMatch[] {
  const seen = new Set<string>();
  const out: PartialMatch[] = [];

  for (const partial of partials) {
    const key = JSON.stringify({
      bindings: partial.bindings,
      matched: partial.matched.map((edge) => edge.id),
    });

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(partial);
  }

  return out;
}

function printRelationPattern(pattern: RelationPatternNode): string {
  return `${printPatternAtom(pattern.left)} : ${printPatternAtom(pattern.relation)} : ${printPatternAtom(pattern.right)}`;
}

function printPatternAtom(atom: PatternAtomNode): string {
  switch (atom.type) {
    case "Identifier":
      return atom.name;

    case "StringLiteral":
      return atom.raw;

    case "NumberLiteral":
      return atom.raw;

    case "BooleanLiteral":
      return atom.raw;

    case "RegexLiteral":
      return atom.raw;

    case "Wildcard":
      return "_";

    case "NodeCapture":
      return printNodeCapture(atom);

    default: {
      const _exhaustive: never = atom;
      throw new Error(`Unsupported pattern atom for printing: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function printNodeCapture(node: NodeCaptureNode): string {
  switch (node.shape.type) {
    case "Identifier":
      return `<${node.shape.name}>`;

    case "StringLiteral":
      return `<${node.shape.raw}>`;

    case "NumberLiteral":
      return `<${node.shape.raw}>`;

    case "BooleanLiteral":
      return `<${node.shape.raw}>`;

    case "ObjectLiteral":
      return `<${JSON.stringify(objectLiteralToDebug(node.shape))}>`;

    case "TraversalExpr":
      return `<${printTraversal(node.shape)}>`;
  }
}

function objectLiteralToDebug(node: {
  properties: Array<{
    key: string;
    value:
      | StringLiteralNode
      | NumberLiteralNode
      | BooleanLiteralNode
      | IdentifierNode
      | NodeCaptureNode
      | RegexLiteralNode
      | any;
  }>;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const prop of node.properties) {
    out[prop.key] = objectPropertyValueToDebug(prop.value);
  }

  return out;
}

function objectPropertyValueToDebug(value: any): unknown {
  switch (value.type) {
    case "StringLiteral":
      return value.value;
    case "NumberLiteral":
      return value.value;
    case "BooleanLiteral":
      return value.value;
    case "Identifier":
      return value.name;
    case "RegexLiteral":
      return value.raw;
    case "NodeCapture":
      return printNodeCapture(value);
    case "ObjectLiteral":
      return objectLiteralToDebug(value);
    case "ArrayLiteral":
      return value.elements.map(objectPropertyValueToDebug);
    default:
      return `[${value.type}]`;
  }
}

function printTraversal(node: {
  segments: Array<
    | {
        type: "ActionSegment";
        from: any;
        operator: IdentifierNode;
        to: any;
      }
    | {
        type: "ContextLift";
        context: IdentifierNode;
        segment: {
          type: "ActionSegment";
          from: any;
          operator: IdentifierNode;
          to: any;
        };
      }
  >;
}): string {
  const parts: string[] = [];

  for (const segment of node.segments) {
    if (segment.type === "ActionSegment") {
      parts.push(
        `${printTraversalValue(segment.from)}.${segment.operator.name}.${printTraversalValue(segment.to)}`
      );
      continue;
    }

    parts.push(
      `..${segment.context.name}..${printTraversalValue(segment.segment.from)}.${segment.segment.operator.name}.${printTraversalValue(segment.segment.to)}`
    );
  }

  return parts.join("");
}

function printTraversalValue(value: any): string {
  switch (value.type) {
    case "Identifier":
      return value.name;
    case "StringLiteral":
      return value.raw;
    case "NumberLiteral":
      return value.raw;
    case "BooleanLiteral":
      return value.raw;
    case "NodeCapture":
      return printNodeCapture(value);
    case "ObjectLiteral":
      return JSON.stringify(objectLiteralToDebug(value));
    case "ArrayLiteral":
      return `[${value.elements.map(printTraversalValue).join(", ")}]`;
    default:
      return `[${value.type}]`;
  }
}
