import type {
  ActionGuardExprNode,
  ActionPipelineStepNode,
  ActionProjectExprNode,
  ArrayLiteralNode,
  BooleanValueNode,
  GraphControlExprNode,
  NodeCaptureNode,
  ObjectLiteralNode,
  PropertyAccessNode,
  ValueExprNode,
} from "../ast/nodeTypes";
import type { ActionRegistry, RuntimeAction } from "./actionRegistry";
import type { Graph, GraphValue } from "./graph";
import {
  addHistoryEntry,
  addBranch,
  addProgress,
  clearEdgeContext,
  setNodeMeta,
  setNodeState,
  setEdgeContext,
  removeBranch,
  removeNodeMeta,
  removeNodeState,
} from "./graph";
import {
  evaluateGraphControlExpr,
  evaluateGraphQuery,
  evaluateLoopCount,
  LOOP_SAFETY_CAP,
} from "./evaluateGraphControl";
import { getAction } from "./actionRegistry";

export interface ActionScope {
  from: string;
  to: string;
}

export interface ActionExecutionResult {
  graph: Graph;
  didRun: boolean;
  project: GraphValue | null;
}

export interface ActionExecutionHooks {
  onGraphMutation?: () => void;
  causedBy?: string;
}

export function executeAction(
  graph: Graph,
  action: RuntimeAction,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): ActionExecutionResult {
  if (action.guard) {
    const passes = evaluateActionGuard(action.guard, graph, scope);
    if (!passes) {
      return {
        graph,
        didRun: false,
        project: null,
      };
    }
  }

  for (const step of action.pipeline) {
    executeActionStep(graph, step, scope, actions, hooks);
  }

  const project = action.project
    ? evaluateActionProjectExpr(action.project, graph, scope)
    : null;

  return {
    graph,
    didRun: true,
    project,
  };
}

function executeActionStep(
  graph: Graph,
  step: ActionPipelineStepNode,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (step.type === "LoopExpr") {
    executeLoopExpr(graph, step, scope, actions, hooks);
    return;
  }

  if (step.type === "IfExpr") {
    executeIfExpr(graph, step.condition, step.then, step.else, scope, actions, hooks);
    return;
  }

  if (step.type === "WhenExpr") {
    throw new Error("@when is not supported inside @action pipelines");
  }

  switch (step.type) {
    case "GraftBranchExpr":
      addBranch(
        graph,
        resolveScopedIdentifier(step.subject.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.object.name, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "GraftStateExpr":
      setNodeState(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        evaluateActionProjectExpr(step.value, graph, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "GraftMetaExpr":
      setNodeMeta(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        evaluateActionProjectExpr(step.value, graph, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "GraftProgressExpr":
      addProgress(
        graph,
        resolveScopedIdentifier(step.from.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.to.name, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "PruneBranchExpr":
      removeBranch(
        graph,
        resolveScopedIdentifier(step.subject.name, scope),
        step.relation.value,
        resolveScopedIdentifier(step.object.name, scope),
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "PruneStateExpr":
      removeNodeState(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "PruneMetaExpr":
      removeNodeMeta(
        graph,
        resolveScopedIdentifier(step.node.name, scope),
        step.key.value,
        { causedBy: hooks?.causedBy },
      );
      hooks?.onGraphMutation?.();
      return;

    case "CtxSetExpr":
      setEdgeContext(graph, resolveScopedIdentifier(step.edge.name, scope), evaluateActionProjectExpr(step.context, graph, scope), {
        causedBy: hooks?.causedBy,
      });
      hooks?.onGraphMutation?.();
      return;

    case "CtxClearExpr":
      clearEdgeContext(graph, resolveScopedIdentifier(step.edge.name, scope), {
        causedBy: hooks?.causedBy,
      });
      hooks?.onGraphMutation?.();
      return;

    case "ApplyExpr":
      executeActionApply(graph, step, scope, actions, hooks);
      return;

    case "PruneNodesExpr":
    case "PruneEdgesExpr":
      throw new Error(`${step.name} is not supported inside @action pipelines`);
  }
}

function executeIfExpr(
  graph: Graph,
  condition: GraphControlExprNode | null,
  thenPipeline: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>["pipeline"] | ActionPipelineStepNode[],
  elsePipeline: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>["pipeline"] | ActionPipelineStepNode[] | null,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (!condition) {
    throw new Error("@if requires a condition");
  }

  if (!thenPipeline.length) {
    throw new Error("@if requires a then pipeline");
  }

  const branch = evaluateGraphControlExpr(graph, condition, { scope })
    ? thenPipeline
    : elsePipeline;

  if (!branch) {
    return;
  }

  for (const step of branch) {
    executeActionStep(graph, step, scope, actions, hooks);
  }
}

export function evaluateActionGuard(
  expr: ActionGuardExprNode,
  graph: Graph,
  scope: ActionScope,
): boolean {
  if (expr.type === "GraphQueryExpr") {
    return evaluateGraphQuery(graph, expr, { scope });
  }

  switch (expr.type) {
    case "BinaryBooleanExpr":
      if (expr.operator === "&&") {
        return (
          evaluateActionGuard(expr.left, graph, scope) &&
          evaluateActionGuard(expr.right, graph, scope)
        );
      }
      return (
        evaluateActionGuard(expr.left, graph, scope) ||
        evaluateActionGuard(expr.right, graph, scope)
      );

    case "UnaryBooleanExpr":
      return !evaluateActionGuard(expr.argument, graph, scope);

    case "GroupedBooleanExpr":
      return evaluateActionGuard(expr.expression, graph, scope);

    case "ComparisonExpr": {
      const left = evaluateBooleanValue(expr.left, graph, scope);
      const right = evaluateBooleanValue(expr.right, graph, scope);

      switch (expr.operator) {
        case "==":
          return compareCaseInsensitive(left, right);
        case "===":
          return compareStrict(left, right);
        case "!=":
          return !compareCaseInsensitive(left, right);
        case "!==":
          return !compareStrict(left, right);
      }
    }

    case "Identifier":
      return truthy(resolveIdentifierValue(expr.name, graph, scope));

    case "PropertyAccess":
      return truthy(resolvePropertyAccess(expr, graph, scope));

    case "StringLiteral":
      return truthy(expr.value);

    case "NumberLiteral":
      return truthy(expr.value);

    case "BooleanLiteral":
      return expr.value;

    case "RegexLiteral":
      return truthy(expr.raw);
    default:
      return exhaustiveNever(expr);
  }
}

function executeLoopExpr(
  graph: Graph,
  loop: Extract<ActionPipelineStepNode, { type: "LoopExpr" }>,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  if (!loop.pipeline.length) {
    throw new Error("@loop requires a pipeline section");
  }

  if (!loop.until && !loop.count) {
    throw new Error("@loop requires at least one of count or until");
  }

  const count = loop.count
    ? evaluateLoopCount(graph, loop.count, { scope })
    : null;

  let iterations = 0;

  while (true) {
    if (loop.until && evaluateGraphQuery(graph, loop.until, { scope })) {
      return;
    }

    if (count !== null && iterations >= count) {
      return;
    }

    if (iterations >= LOOP_SAFETY_CAP) {
      throw new Error(`@loop exceeded safety cap of ${LOOP_SAFETY_CAP} iterations`);
    }

    for (const step of loop.pipeline) {
      executeActionStep(graph, step, scope, actions, hooks);
    }

    iterations += 1;
  }
}

function executeActionApply(
  graph: Graph,
  mutation: Extract<ActionPipelineStepNode, { type: "ApplyExpr" }>,
  scope: ActionScope,
  actions: ActionRegistry,
  hooks?: ActionExecutionHooks,
): void {
  const targetValue = evaluateActionApplyTarget(mutation.target, scope, actions);

  if (!isRecord(targetValue) || targetValue.kind !== "traversal") {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  if (!Array.isArray(targetValue.steps)) {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  if (targetValue.steps.length === 0) {
    throw new Error(`@apply traversal must contain at least one step`);
  }

  const firstStep = targetValue.steps[0];

  if (!isRecord(firstStep) || typeof firstStep.binding !== "string") {
    throw new Error(`@apply traversal step is missing an action binding`);
  }

  if (typeof firstStep.fromRef !== "string") {
    throw new Error(`@apply traversal step is missing fromRef`);
  }

  if (typeof firstStep.toRef !== "string") {
    throw new Error(`@apply traversal step is missing toRef`);
  }

  const action = getAction(actions, firstStep.binding);

  if (!action) {
    throw new Error(`@apply could not find action "${firstStep.binding}"`);
  }

  const applyEvent = addHistoryEntry(
    graph,
    {
      op: "@apply",
      payload: {
        from: firstStep.fromRef,
        action: firstStep.binding,
        to: firstStep.toRef,
      },
    },
    { causedBy: hooks?.causedBy },
  );

  executeAction(
    graph,
    action,
    { from: firstStep.fromRef, to: firstStep.toRef },
    actions,
    {
      ...hooks,
      causedBy: applyEvent.id,
    },
  );
}

function evaluateBooleanValue(
  value: BooleanValueNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  switch (value.type) {
    case "Identifier":
      return resolveIdentifierValue(value.name, graph, scope);
    case "PropertyAccess":
      return resolvePropertyAccess(value, graph, scope);
    case "StringLiteral":
      return value.value;
    case "NumberLiteral":
      return value.value;
    case "BooleanLiteral":
      return value.value;
    case "RegexLiteral":
      return value.raw;
    default:
      return exhaustiveNever(value);
  }
}

function evaluateActionProjectExpr(
  expr: ActionProjectExprNode | ValueExprNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "Identifier":
      return resolveScopedIdentifier(expr.name, scope);

    case "StringLiteral":
      return expr.value;

    case "NumberLiteral":
      return expr.value;

    case "BooleanLiteral":
      return expr.value;

    case "NodeCapture":
      return printNodeCapture(expr);

    case "ObjectLiteral":
      return evaluateObjectLiteralProject(expr, graph, scope);

    case "ArrayLiteral":
      return evaluateArrayLiteralProject(expr, graph, scope);

    case "WhereExpr":
      throw new Error(`@where is not supported inside @action project expressions`);

    default:
      return exhaustiveNever(expr);
  }
}

function evaluateArrayLiteralProject(
  expr: ArrayLiteralNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  return expr.elements.map((el) => evaluateActionProjectExpr(el, graph, scope));
}

function evaluateObjectLiteralProject(
  expr: ObjectLiteralNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  const out: Record<string, GraphValue> = {};

  for (const prop of expr.properties) {
    out[prop.key] = evaluateActionProjectExpr(prop.value, graph, scope);
  }

  return out;
}

function resolveIdentifierValue(
  name: string,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  const resolved = resolveScopedIdentifier(name, scope);
  return resolved;
}

function resolveScopedIdentifier(name: string, scope: ActionScope): string {
  if (name === "from") return scope.from;
  if (name === "to") return scope.to;
  return name;
}

function resolvePropertyAccess(
  access: PropertyAccessNode,
  graph: Graph,
  scope: ActionScope,
): GraphValue {
  const base = resolveIdentifierValue(access.object.name, graph, scope);

  if (typeof base === "string" && graph.nodes.has(base)) {
    const node = graph.nodes.get(base)!;
    const first = access.chain[0]?.name;
    if (!first) return null;

    if (first === "state") {
      return dig(node.state, access.chain.slice(1).map((p) => p.name));
    }

    if (first === "meta") {
      return dig(node.meta, access.chain.slice(1).map((p) => p.name));
    }

    if (first === "value") {
      return dig(node.value, access.chain.slice(1).map((p) => p.name));
    }

    if (first in node.state) {
      return dig(node.state, access.chain.map((p) => p.name));
    }

    if (first in node.meta) {
      return dig(node.meta, access.chain.map((p) => p.name));
    }

    if (isRecord(node.value) && first in node.value) {
      return dig(node.value, access.chain.map((p) => p.name));
    }
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

function evaluateActionApplyTarget(
  target: Extract<ActionPipelineStepNode, { type: "ApplyExpr" }>["target"],
  scope: ActionScope,
  actions: ActionRegistry,
): GraphValue {
  if (target.type === "Identifier") {
    return resolveScopedIdentifier(target.name, scope);
  }

  if (target.shape.type !== "TraversalExpr") {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  return {
    kind: "traversal",
    source: printScopedTraversal(target.shape, scope),
    steps: target.shape.segments.map((segment) => {
      const actionSegment =
        segment.type === "ActionSegment" ? segment : segment.segment;
      const binding = actionSegment.operator.name;
      const action = getAction(actions, binding);
      const fromRef = resolveTraversalRef(actionSegment.from, scope);
      const toRef = resolveTraversalRef(actionSegment.to, scope);

      return {
        kind: segment.type === "ActionSegment" ? "action" : "context",
        ...(segment.type === "ContextLift" ? { context: segment.context.name } : {}),
        binding,
        callee: action ? action.bindingName : binding,
        fromRef,
        toRef,
        from: evaluateScopedActionValue(actionSegment.from, scope),
        to: evaluateScopedActionValue(actionSegment.to, scope),
        action: action ? runtimeActionToValue(action) : null,
      };
    }),
  };
}

function evaluateScopedActionValue(
  expr: ValueExprNode,
  scope: ActionScope,
): GraphValue {
  switch (expr.type) {
    case "Identifier":
      return resolveScopedIdentifier(expr.name, scope);
    case "StringLiteral":
      return expr.value;
    case "NumberLiteral":
      return expr.value;
    case "BooleanLiteral":
      return expr.value;
    case "NodeCapture":
      return printNodeCapture(expr);
    case "ObjectLiteral": {
      const out: Record<string, GraphValue> = {};
      for (const prop of expr.properties) {
        out[prop.key] = evaluateScopedActionValue(prop.value, scope);
      }
      return out;
    }
    case "ArrayLiteral":
      return expr.elements.map((item) => evaluateScopedActionValue(item, scope));
    case "WhereExpr":
      throw new Error(`@where is not supported inside @apply traversal values`);
    default:
      return exhaustiveNever(expr);
  }
}

function resolveTraversalRef(expr: ValueExprNode, scope: ActionScope): string | null {
  if (expr.type === "Identifier") {
    return resolveScopedIdentifier(expr.name, scope);
  }

  return null;
}

function printScopedTraversal(
  expr: NodeCaptureNode["shape"] & { type: "TraversalExpr" },
  scope: ActionScope,
): string {
  return expr.segments
    .map((segment) => {
      const actionSegment =
        segment.type === "ActionSegment" ? segment : segment.segment;
      const chunk = `${printScopedTraversalValue(actionSegment.from, scope)}.${actionSegment.operator.name}.${printScopedTraversalValue(actionSegment.to, scope)}`;

      if (segment.type === "ContextLift") {
        return `..${segment.context.name}..${chunk}`;
      }

      return chunk;
    })
    .join("");
}

function printScopedTraversalValue(expr: ValueExprNode, scope: ActionScope): string {
  switch (expr.type) {
    case "Identifier":
      return resolveScopedIdentifier(expr.name, scope);
    case "StringLiteral":
      return expr.raw;
    case "NumberLiteral":
      return expr.raw;
    case "BooleanLiteral":
      return expr.raw;
    case "NodeCapture":
      return printNodeCapture(expr);
    case "ObjectLiteral":
      return "<{...}>";
    case "ArrayLiteral":
      return "[...]";
    case "WhereExpr":
      return "@where(...)";
    default:
      return exhaustiveNever(expr);
  }
}

function runtimeActionToValue(action: RuntimeAction): GraphValue {
  return {
    bindingName: action.bindingName,
    guard: action.guard ? astNodeToValue(action.guard) : null,
    pipeline: action.pipeline.map((step) => astNodeToValue(step)),
    project: action.project ? astNodeToValue(action.project) : null,
  };
}

function astNodeToValue(node: unknown): GraphValue {
  if (node === null) return null;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => astNodeToValue(item));
  }
  if (typeof node !== "object") {
    return null;
  }

  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "span") continue;
    out[key] = astNodeToValue(value);
  }
  return out;
}

function compareStrict(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compareCaseInsensitive(a: GraphValue, b: GraphValue): boolean {
  return JSON.stringify(normalizeCaseInsensitive(a)) === JSON.stringify(normalizeCaseInsensitive(b));
}

function normalizeCaseInsensitive(value: GraphValue): GraphValue {
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map((item) => normalizeCaseInsensitive(item));
  if (isRecord(value)) {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeCaseInsensitive(v);
    }
    return out;
  }
  return value;
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
      return "<{...}>";
    case "TraversalExpr":
      return "<traversal>";
    default:
      return exhaustiveNever(node.shape);
  }
}

function exhaustiveNever(value: never): never {
  throw new Error(`Unexpected node shape: ${String(value)}`);
}
