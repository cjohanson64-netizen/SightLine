import type {
  ApplyExprNode,
  BindStatementNode,
  BooleanExprNode,
  BooleanValueNode,
  ComposeExprNode,
  GraphControlExprNode,
  GraphInteractionDefinitionNode,
  GraphPipelineNode,
  GraphPipelineStepNode,
  GraphProjectionNode,
  IfExprNode,
  ProgramNode,
  PruneEdgesExprNode,
  PruneNodesExprNode,
  QueryStatementNode,
  SeedBlockNode,
  SeedEdgeEntryNode,
  StatementNode,
  SystemRelationNode,
  ValueBindingNode,
  WhenExprNode,
} from "../ast/nodeTypes";
import {
  addHistoryEntry,
  addNode,
  addBranch,
  addProgress,
  clearEdgeContext,
  cloneGraph,
  createGraph,
  graphToDebugObject,
  removeBranch,
  removeNode,
  removeNodeMeta,
  removeNodeState,
  setEdgeContext,
  setNodeMeta,
  setNodeState,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphValue,
} from "./graph";
import {
  classifyBindValue,
  evaluateBindExpr,
  type BindValue,
} from "./bindUtils";
import {
  createRuntimeBindings,
  evaluateNodeCapture,
  evaluateValueExpr,
  registerNodeBinding,
  registerValueBinding,
  type RuntimeBindings,
} from "./evaluateNodeCapture";
import { executeQuery, type QueryExecutionResult } from "./executeQuery";
import { executeAction } from "./executeAction";
import {
  createActionRegistry,
  registerAction,
  type ActionRegistry,
} from "./actionRegistry";
import {
  REACTIVE_TRIGGER_SAFETY_CAP,
  evaluateGraphControlExpr,
} from "./evaluateGraphControl";
import { projectGraphResult } from "./projection";
import {
  graphInteractionFromAst,
  type GraphInteraction,
  type GraphInteractionHistoryEntry,
  type GraphWorkspace,
} from "./executeGraphInteraction";

export type RuntimeAssetKind =
  | "node"
  | "fragment"
  | "graph"
  | "projection"
  | "program"
  | "interaction";

export interface ExecutedSystemRelation {
  left: string;
  relation: string | null;
  right: string;
}

export interface ExecutedQuery {
  query: QueryStatementNode;
  graphName: string;
  result: QueryExecutionResult;
}

export interface ReactiveTriggerRegistration {
  id: string;
  event: GraphControlExprNode;
  pipeline: GraphPipelineStepNode[];
}

interface ReactiveCycleState {
  triggerStates: Map<string, boolean>;
  fireCount: number;
}

export interface RuntimeState {
  bindings: RuntimeBindings;
  actions: ActionRegistry;
  assetKinds: Map<string, RuntimeAssetKind>;
  seed: SeedBlockNode | null;
  seedGraph: Graph | null;
  graphs: Map<string, Graph>;
  projections: Map<string, unknown>;
  graphInteractions: Map<string, GraphInteraction>;
  anonymousGraphInteractions: GraphInteraction[];
  interactionHistory: GraphInteractionHistoryEntry[];
  systemRelations: ExecutedSystemRelation[];
  queries: QueryStatementNode[];
  queryResults: ExecutedQuery[];
  whenTriggers: ReactiveTriggerRegistration[];
  lastGraphName: string | null;
  terminalProjectReached: boolean;
}

export interface ExecuteProgramResult {
  state: RuntimeState;
}

export interface ExecuteProgramOptions {
  initialState?: Partial<RuntimeState>;
}

export function executeProgram(
  program: ProgramNode,
  options?: ExecuteProgramOptions,
): ExecuteProgramResult {
  const initialState = options?.initialState;

  const state: RuntimeState = {
    bindings: initialState?.bindings ?? createRuntimeBindings(),
    actions: initialState?.actions ?? createActionRegistry(),
    assetKinds: initialState?.assetKinds ?? new Map<string, RuntimeAssetKind>(),
    seed: initialState?.seed ?? null,
    seedGraph: initialState?.seedGraph ?? null,
    graphs: initialState?.graphs ?? new Map<string, Graph>(),
    projections: initialState?.projections ?? new Map<string, unknown>(),
    graphInteractions:
      initialState?.graphInteractions ?? new Map<string, GraphInteraction>(),
    anonymousGraphInteractions: initialState?.anonymousGraphInteractions ?? [],
    interactionHistory: initialState?.interactionHistory ?? [],
    systemRelations: initialState?.systemRelations ?? [],
    queries: initialState?.queries ?? [],
    queryResults: initialState?.queryResults ?? [],
    whenTriggers: initialState?.whenTriggers ?? [],
    lastGraphName: initialState?.lastGraphName ?? null,
    terminalProjectReached: initialState?.terminalProjectReached ?? false,
  };

  for (const statement of program.body) {
    executeStatement(statement, state);
  }

  return { state };
}

function executeStatement(statement: StatementNode, state: RuntimeState): void {
  switch (statement.type) {
    case "ImportDeclaration":
    case "ExportDeclaration":
      return;

    case "ValueBinding":
      executeValueBinding(statement, state);
      return;

    case "BindStatement":
      ensureProjectNotTerminal(state, "@bind");
      executeBindStatement(statement, state);
      return;

    case "OperatorBinding":
      executeOperatorBinding(statement, state);
      return;

    case "SeedBlock":
      state.seed = statement;
      state.seedGraph = buildSeedGraph(statement, state.bindings);
      return;

    case "GraphPipeline":
      executeGraphPipeline(statement, state);
      return;

    case "GraphProjection":
      executeGraphProjection(statement, state);
      return;

    case "WhenExpr":
      executeWhenExpr(statement, state);
      return;

    case "GraphInteractionDefinition":
      executeGraphInteractionDefinition(statement, state);
      return;

    case "SystemRelation":
      executeSystemRelation(statement, state);
      return;

    case "QueryStatement":
      executeQueryStatement(statement, state);
      return;

    default: {
      const _exhaustive: never = statement;
      throw new Error(
        `Unsupported statement type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function executeValueBinding(
  statement: ValueBindingNode,
  state: RuntimeState,
): void {
  const name = statement.name.name;

  if (statement.value.type === "NodeCapture") {
    const evaluated = evaluateNodeCapture(
      name,
      statement.value,
      state.bindings,
      state.actions,
    );
    registerNodeBinding(state.bindings, name, evaluated.node);
    state.assetKinds.set(name, "node");
    return;
  }

  const value = evaluateValueExpr(
    statement.value,
    state.bindings,
    state.actions,
  );
  registerValueBinding(state.bindings, name, value);
}

function executeBindStatement(
  statement: BindStatementNode,
  state: RuntimeState,
): void {
  const graph = getCurrentGraph(state);
  const value = evaluateBindExpr(
    statement.expression,
    state.bindings,
    state.actions,
    graph,
  );

  if (statement.entity) {
    const kind = classifyBindValue(value);

    if (kind !== "empty" && kind !== statement.entity) {
      throw new Error(
        `@bind.${statement.layer ?? "ctx"}.${statement.entity} expected ${statement.entity} result, got ${kind}`,
      );
    }
  }

  const layer = statement.layer ?? "ctx";

  switch (layer) {
    case "ctx":
      writeBindToContext(state, statement.name.name, value);
      return;

    case "state": {
      const target = requireCurrentGraph(state, "@bind.state");
      target.state[statement.name.name] = deepCloneBindValue(
        value,
      ) as unknown as GraphValue;
      return;
    }

    case "meta": {
      const target = requireCurrentGraph(state, "@bind.meta");
      target.meta[statement.name.name] = deepCloneBindValue(
        value,
      ) as unknown as GraphValue;
      return;
    }

    default: {
      const _exhaustive: never = layer;
      throw new Error(
        `Unsupported @bind layer: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function executeOperatorBinding(
  statement: Extract<StatementNode, { type: "OperatorBinding" }>,
  state: RuntimeState,
): void {
  const name = statement.name.name;

  switch (statement.value.type) {
    case "ActionExpr":
      registerAction(state.actions, {
        bindingName: name,
        guard: statement.value.guard,
        pipeline: statement.value.pipeline,
        project: statement.value.project,
      });
      state.assetKinds.set(name, "program");
      return;

    case "CtxExpr":
      return;

    case "ProjectExpr":
      return;

    default: {
      const _exhaustive: never = statement.value;
      throw new Error(
        `Unsupported operator binding type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function buildSeedGraph(seed: SeedBlockNode, bindings: RuntimeBindings): Graph {
  const stateValue = evaluateValueExpr(
    seed.state,
    bindings,
    createActionRegistry(),
  );
  const metaValue = evaluateValueExpr(
    seed.meta,
    bindings,
    createActionRegistry(),
  );

  if (!isRecordValue(stateValue)) {
    throw new Error(`@seed state must resolve to an object`);
  }

  if (!isRecordValue(metaValue)) {
    throw new Error(`@seed meta must resolve to an object`);
  }

  const graph = createGraph(seed.root.name, stateValue, metaValue);

  for (const nodeRef of seed.nodes) {
    const node = bindings.nodes.get(nodeRef.ref.name);

    if (!node) {
      throw new Error(
        `Seed references unknown node binding "${nodeRef.ref.name}"`,
      );
    }

    addNode(graph, cloneRuntimeNode(node));
  }

  for (const edge of seed.edges) {
    const entry = materializeSeedEdgeEntry(edge);
    const before = graph.edges.length;
    addBranch(graph, entry.subject, entry.relation, entry.object);

    if (entry.id && graph.edges.length > before) {
      graph.edges[graph.edges.length - 1].id = entry.id;
    }
  }

  return graph;
}

function materializeSeedEdgeEntry(entry: SeedEdgeEntryNode): {
  id: string | null;
  subject: string;
  relation: string;
  object: string;
} {
  if (entry.type === "SeedEdgeBinding") {
    return {
      id: entry.name.name,
      subject: entry.edge.left.name,
      relation: entry.edge.relation.value,
      object: entry.edge.right.name,
    };
  }

  return {
    id: null,
    subject: entry.left.name,
    relation: entry.relation.value,
    object: entry.right.name,
  };
}

function executeGraphPipeline(
  pipeline: GraphPipelineNode,
  state: RuntimeState,
): void {
  const graph = materializeGraphSource(pipeline.source, state);
  const reactive = createReactiveCycleState(graph, state);

  for (const mutation of pipeline.mutations) {
    executeGraphPipelineStep(graph, mutation, state, reactive);
  }

  state.graphs.set(pipeline.name.name, graph);
  state.assetKinds.set(pipeline.name.name, "graph");
  state.projections.set(
    pipeline.name.name,
    projectGraphResult(graph, pipeline.projection, state),
  );
  state.lastGraphName = pipeline.name.name;

  if (pipeline.projection) {
    state.terminalProjectReached = true;
  }
}

function executeGraphProjection(
  statement: GraphProjectionNode,
  state: RuntimeState,
): void {
  const graphName = statement.source.name;
  const graph = state.graphs.get(graphName);

  if (!graph) {
    throw new Error(
      `@project source "${graphName}" is not a graph value — ensure it is declared before this projection`,
    );
  }

  const result = projectGraphResult(graph, statement.projection, state);
  state.projections.set(statement.name.name, result);
  state.assetKinds.set(statement.name.name, "projection");
}

function executeWhenExpr(statement: WhenExprNode, state: RuntimeState): void {
  if (!statement.event) {
    throw new Error("@when requires an event");
  }

  if (!statement.pipeline.length) {
    throw new Error("@when requires a pipeline");
  }

  state.whenTriggers.push({
    id: `when_${state.whenTriggers.length}`,
    event: statement.event,
    pipeline: statement.pipeline,
  });
}

function createReactiveCycleState(
  graph: Graph,
  state: RuntimeState,
): ReactiveCycleState {
  const triggerStates = new Map<string, boolean>();

  for (const trigger of state.whenTriggers) {
    triggerStates.set(
      trigger.id,
      evaluateGraphControlExpr(graph, trigger.event, {
        bindings: state.bindings,
        actions: state.actions,
      }),
    );
  }

  return {
    triggerStates,
    fireCount: 0,
  };
}

function executeGraphPipelineStep(
  graph: Graph,
  step: GraphPipelineStepNode,
  state: RuntimeState,
  reactive: ReactiveCycleState,
): void {
  if (step.type === "IfExpr") {
    executeGraphIfExpr(graph, step, state, reactive);
    return;
  }

  if (step.type === "WhenExpr") {
    executeInlineWhenExpr(graph, step, state, reactive);
    return;
  }

  executeGraphMutationStep(graph, step, state, reactive);
}

function executeInlineWhenExpr(
  graph: Graph,
  step: WhenExprNode,
  state: RuntimeState,
  reactive: ReactiveCycleState,
): void {
  if (!step.event) {
    throw new Error("@when requires an event");
  }

  if (!step.pipeline.length) {
    throw new Error("@when requires a pipeline");
  }

  const id = `when_${state.whenTriggers.length}`;
  const current = evaluateGraphControlExpr(graph, step.event, {
    bindings: state.bindings,
    actions: state.actions,
  });

  state.whenTriggers.push({
    id,
    event: step.event,
    pipeline: step.pipeline,
  });

  reactive.triggerStates.set(id, current);
}

function executeGraphIfExpr(
  graph: Graph,
  step: IfExprNode,
  state: RuntimeState,
  reactive: ReactiveCycleState,
): void {
  if (!step.condition) {
    throw new Error("@if requires a condition");
  }

  if (!step.then.length) {
    throw new Error("@if requires a then pipeline");
  }

  const branch = evaluateGraphControlExpr(graph, step.condition, {
    bindings: state.bindings,
    actions: state.actions,
  })
    ? step.then
    : step.else;

  if (!branch) {
    return;
  }

  for (const branchStep of branch) {
    executeGraphPipelineStep(graph, branchStep, state, reactive);
  }
}

function executeGraphMutationStep(
  graph: Graph,
  mutation: Exclude<GraphPipelineStepNode, IfExprNode | WhenExprNode>,
  state: RuntimeState,
  reactive: ReactiveCycleState,
): void {
  switch (mutation.type) {
    case "GraftBranchExpr":
      addBranch(
        graph,
        mutation.subject.name,
        mutation.relation.value,
        mutation.object.name,
      );
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "GraftStateExpr": {
      const value = evaluateValueExpr(
        mutation.value,
        state.bindings,
        state.actions,
      );
      setNodeState(graph, mutation.node.name, mutation.key.value, value);
      flushReactiveTriggers(graph, state, reactive);
      return;
    }

    case "GraftMetaExpr": {
      const value = evaluateValueExpr(
        mutation.value,
        state.bindings,
        state.actions,
      );
      setNodeMeta(graph, mutation.node.name, mutation.key.value, value);
      flushReactiveTriggers(graph, state, reactive);
      return;
    }

    case "GraftProgressExpr":
      addProgress(
        graph,
        mutation.from.name,
        mutation.relation.value,
        mutation.to.name,
      );
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "PruneBranchExpr":
      removeBranch(
        graph,
        mutation.subject.name,
        mutation.relation.value,
        mutation.object.name,
      );
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "PruneStateExpr":
      removeNodeState(graph, mutation.node.name, mutation.key.value);
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "PruneMetaExpr":
      removeNodeMeta(graph, mutation.node.name, mutation.key.value);
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "PruneNodesExpr":
      executePruneNodesExpr(graph, mutation, state);
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "PruneEdgesExpr":
      executePruneEdgesExpr(graph, mutation, state);
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "CtxSetExpr": {
      const context = evaluateValueExpr(
        mutation.context,
        state.bindings,
        state.actions,
      );
      setEdgeContext(graph, mutation.edge.name, context);
      flushReactiveTriggers(graph, state, reactive);
      return;
    }

    case "CtxClearExpr":
      clearEdgeContext(graph, mutation.edge.name);
      flushReactiveTriggers(graph, state, reactive);
      return;

    case "ApplyExpr":
      executeApplyExpr(graph, mutation, state, reactive);
      return;

    default: {
      const _exhaustive: never = mutation;
      throw new Error(
        `Unsupported mutation type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function flushReactiveTriggers(
  graph: Graph,
  state: RuntimeState,
  reactive: ReactiveCycleState,
): void {
  if (state.whenTriggers.length === 0) {
    return;
  }

  while (true) {
    let fired = false;

    for (const trigger of state.whenTriggers) {
      const current = evaluateGraphControlExpr(graph, trigger.event, {
        bindings: state.bindings,
        actions: state.actions,
      });
      const previous = reactive.triggerStates.get(trigger.id) ?? false;

      if (!current) {
        reactive.triggerStates.set(trigger.id, false);
        continue;
      }

      if (previous) {
        continue;
      }

      reactive.triggerStates.set(trigger.id, true);
      reactive.fireCount += 1;

      if (reactive.fireCount > REACTIVE_TRIGGER_SAFETY_CAP) {
        throw new Error(
          `@when exceeded reactive safety cap of ${REACTIVE_TRIGGER_SAFETY_CAP} firings in a single execution cycle`,
        );
      }

      for (const step of trigger.pipeline) {
        executeGraphPipelineStep(graph, step, state, reactive);
      }

      fired = true;
      break;
    }

    if (!fired) {
      return;
    }
  }
}

function executeGraphInteractionDefinition(
  statement: GraphInteractionDefinitionNode,
  state: RuntimeState,
): void {
  const fallbackId = `__interaction_${state.anonymousGraphInteractions.length}`;
  const interaction = graphInteractionFromAst(statement, fallbackId);

  if (statement.name) {
    state.graphInteractions.set(statement.name.name, interaction);
    state.assetKinds.set(statement.name.name, "interaction");
    return;
  }

  state.anonymousGraphInteractions.push(interaction);
}

function materializeGraphSource(
  source: GraphPipelineNode["source"],
  state: RuntimeState,
): Graph {
  if (source.type === "SeedSource") {
    if (!state.seedGraph) {
      throw new Error(
        `Cannot execute graph pipeline from @seed before @seed is defined`,
      );
    }
    return cloneGraph(state.seedGraph);
  }

  return executeComposeSource(source, state);
}

function executeComposeSource(
  compose: ComposeExprNode,
  state: RuntimeState,
): Graph {
  const mergeSymbol = compose.merge.name;
  const mergeNodeId = resolveMergeNodeId(mergeSymbol, state);
  const out = createGraph(mergeNodeId);

  for (const asset of compose.assets) {
    const assetName = asset.name;
    const kind = state.assetKinds.get(assetName);
    if (!kind) {
      throw new Error(`@compose input "${assetName}" is unresolved`);
    }
    if (kind !== "graph" && kind !== "fragment") {
      throw new Error(
        `Invalid @compose input kind for "${assetName}": expected graph or fragment, got ${kind}`,
      );
    }

    const sourceGraph = state.graphs.get(assetName);
    if (!sourceGraph) {
      throw new Error(`@compose input "${assetName}" is not a graph value`);
    }

    const sourceMergeNode = sourceGraph.nodes.get(mergeNodeId);
    if (!sourceMergeNode) {
      throw new Error(
        `Missing merge anchor "${mergeNodeId}" in composed asset "${assetName}"`,
      );
    }

    if (!out.nodes.has(mergeNodeId)) {
      addNode(out, cloneRuntimeNode(sourceMergeNode));
    }

    for (const [nodeId, node] of sourceGraph.nodes.entries()) {
      if (nodeId === mergeNodeId) {
        continue;
      }
      if (out.nodes.has(nodeId)) {
        throw new Error(
          `Duplicate non-merge node id "${nodeId}" during @compose`,
        );
      }
      addNode(out, cloneRuntimeNode(node));
    }

    for (const edge of sourceGraph.edges) {
      out.edges.push({ ...edge });
    }

    for (const entry of sourceGraph.history) {
      out.history.push({
        id: entry.id,
        op: entry.op,
        payload: deepCloneRecord(entry.payload),
      });
    }
  }

  out.root = mergeNodeId;
  return out;
}

function resolveMergeNodeId(mergeSymbol: string, state: RuntimeState): string {
  if (state.bindings.nodes.has(mergeSymbol)) {
    return state.bindings.nodes.get(mergeSymbol)!.id;
  }

  if (state.bindings.values.has(mergeSymbol)) {
    const resolved = state.bindings.values.get(mergeSymbol);
    if (typeof resolved === "string") {
      return resolved;
    }
  }

  throw new Error(
    `Invalid merge symbol "${mergeSymbol}": expected an in-scope node symbol`,
  );
}

function executePruneNodesExpr(
  graph: Graph,
  mutation: PruneNodesExprNode,
  state: RuntimeState,
): void {
  const targets = Array.from(graph.nodes.values())
    .filter((node) =>
      evaluatePruneWhereNode(mutation.where.expression, node, state.bindings),
    )
    .map((node) => node.id);

  for (const nodeId of targets) {
    removeNode(graph, nodeId);
  }
}

function executePruneEdgesExpr(
  graph: Graph,
  mutation: PruneEdgesExprNode,
  state: RuntimeState,
): void {
  const removeIds = new Set(
    graph.edges
      .filter((edge) =>
        evaluatePruneWhereEdge(mutation.where.expression, edge, state.bindings),
      )
      .map((edge) => edge.id),
  );

  graph.edges = graph.edges.filter((edge) => !removeIds.has(edge.id));
}

function executeApplyExpr(
  graph: Graph,
  mutation: ApplyExprNode,
  state: RuntimeState,
  reactive?: ReactiveCycleState,
): void {
  const targetValue = evaluateValueExpr(
    mutation.target,
    state.bindings,
    state.actions,
  );

  if (!isRecordValue(targetValue) || targetValue.kind !== "traversal") {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  const steps = targetValue.steps;

  if (!Array.isArray(steps)) {
    throw new Error(`@apply target must resolve to a traversal value`);
  }

  if (steps.length === 0) {
    throw new Error(`@apply traversal must contain at least one step`);
  }

  const firstStep = steps[0];

  if (!isRecordValue(firstStep) || typeof firstStep.binding !== "string") {
    throw new Error(`@apply traversal step is missing an action binding`);
  }

  if (typeof firstStep.fromRef !== "string") {
    throw new Error(`@apply traversal step is missing fromRef`);
  }

  if (typeof firstStep.toRef !== "string") {
    throw new Error(`@apply traversal step is missing toRef`);
  }

  const action = state.actions.get(firstStep.binding);

  if (!action) {
    throw new Error(`@apply could not find action "${firstStep.binding}"`);
  }

  const applyEvent = addHistoryEntry(graph, {
    op: "@apply",
    payload: {
      from: firstStep.fromRef,
      action: firstStep.binding,
      to: firstStep.toRef,
    },
  });

  executeAction(
    graph,
    action,
    {
      from: firstStep.fromRef,
      to: firstStep.toRef,
    },
    state.actions,
    reactive
      ? {
          causedBy: applyEvent.id,
          onGraphMutation: () => flushReactiveTriggers(graph, state, reactive),
        }
      : { causedBy: applyEvent.id },
  );
}

function executeSystemRelation(
  statement: SystemRelationNode,
  state: RuntimeState,
): void {
  const left = statement.left.name;
  const right = statement.right.name;

  if (!state.graphs.has(left)) {
    throw new Error(`System relation references unknown graph "${left}"`);
  }

  if (!state.graphs.has(right)) {
    throw new Error(`System relation references unknown graph "${right}"`);
  }

  state.systemRelations.push({
    left,
    relation: statement.relation ? statement.relation.value : null,
    right,
  });
}

function executeQueryStatement(
  statement: QueryStatementNode,
  state: RuntimeState,
): void {
  let graph = getCurrentGraph(state);
  let graphName = state.lastGraphName ?? "seed";

  if (!graph) {
    throw new Error(
      `Cannot execute query before @seed or any graph pipeline has run`,
    );
  }

  const result = executeQuery(
    graph,
    statement.expr,
    state.bindings,
    state.actions,
    createQueryWorkspace(state),
  );

  state.queries.push(statement);
  state.queryResults.push({
    query: statement,
    graphName,
    result,
  });
}

function createQueryWorkspace(state: RuntimeState): GraphWorkspace {
  const graphs = new Map(state.graphs);

  if (state.seedGraph && !graphs.has("seed")) {
    graphs.set("seed", state.seedGraph);
  }

  return {
    graphs,
    interactionHistory: state.interactionHistory,
  };
}

function getCurrentGraph(state: RuntimeState): Graph | null {
  if (state.lastGraphName) {
    return state.graphs.get(state.lastGraphName) ?? null;
  }

  return state.seedGraph;
}

function ensureProjectNotTerminal(state: RuntimeState, opName: string): void {
  if (state.terminalProjectReached) {
    throw new Error(`${opName} cannot execute after terminal @project(...)`);
  }
}

function requireCurrentGraph(state: RuntimeState, opName: string): Graph {
  const graph = getCurrentGraph(state);

  if (!graph) {
    throw new Error(
      `${opName} requires an active graph from @seed or a graph pipeline`,
    );
  }

  return graph;
}

function writeBindToContext(
  state: RuntimeState,
  name: string,
  value: BindValue,
): void {
  if (isGraphNodeLike(value)) {
    registerNodeBinding(state.bindings, name, value);
    return;
  }

  registerValueBinding(
    state.bindings,
    name,
    deepCloneBindValue(value) as GraphValue,
  );
}

function isGraphNodeLike(value: BindValue): value is GraphNode {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as GraphNode).id === "string" &&
    "value" in (value as GraphNode) &&
    "state" in (value as GraphNode) &&
    "meta" in (value as GraphNode)
  );
}

function deepCloneBindValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepCloneBindValue(item)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = deepCloneBindValue(item);
  }
  return out as T;
}

function evaluatePruneWhereNode(
  expr: BooleanExprNode,
  node: GraphNode,
  bindings: RuntimeBindings,
): boolean {
  return evaluatePruneExpr(expr, "node", node, bindings);
}

function evaluatePruneWhereEdge(
  expr: BooleanExprNode,
  edge: GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  return evaluatePruneExpr(expr, "edge", edge, bindings);
}

function evaluatePruneExpr(
  expr: BooleanExprNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): boolean {
  switch (expr.type) {
    case "GroupedBooleanExpr":
      return evaluatePruneExpr(expr.expression, context, item, bindings);

    case "BinaryBooleanExpr":
      if (expr.operator === "&&") {
        return (
          evaluatePruneExpr(expr.left, context, item, bindings) &&
          evaluatePruneExpr(expr.right, context, item, bindings)
        );
      }
      if (expr.operator === "||") {
        return (
          evaluatePruneExpr(expr.left, context, item, bindings) ||
          evaluatePruneExpr(expr.right, context, item, bindings)
        );
      }
      throw new Error(
        `Malformed @where predicate syntax: unsupported boolean operator "${expr.operator}"`,
      );

    case "ComparisonExpr": {
      if (expr.operator !== "==" && expr.operator !== "!=") {
        throw new Error(
          `Malformed @where predicate syntax: unsupported comparison operator "${expr.operator}"`,
        );
      }

      const left = resolvePruneValue(expr.left, context, item, bindings);
      const right = resolvePruneValue(expr.right, context, item, bindings);

      const equal = comparePruneValue(left, right);
      return expr.operator === "==" ? equal : !equal;
    }

    default:
      throw new Error(
        `Malformed @where predicate syntax: expected comparisons grouped with && / ||`,
      );
  }
}

function resolvePruneValue(
  value: BooleanValueNode,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue | undefined {
  switch (value.type) {
    case "StringLiteral":
      return value.value;

    case "NumberLiteral":
      return value.value;

    case "BooleanLiteral":
      return value.value;

    case "RegexLiteral":
      throw new Error(
        `Malformed @where predicate syntax: regex is not supported in prune predicates`,
      );

    case "Identifier":
      return resolveIdentifierOperand(value.name, context, item, bindings);

    case "PropertyAccess":
      return resolvePropertyOperand(value, context, item);

    default: {
      const _exhaustive: never = value;
      throw new Error(
        `Malformed @where predicate syntax: unsupported value ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function resolveIdentifierOperand(
  name: string,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
  bindings: RuntimeBindings,
): GraphValue | undefined {
  if (context === "node") {
    const node = item as GraphNode;
    if (name === "id") return node.id;
    if (name === "type") return readObjectField(node.value, "type");
    if (name === "key") return readObjectField(node.value, "key");
    if (name === "value") return node.value;
  }

  if (context === "edge") {
    const edge = item as GraphEdge;
    if (name === "source") return edge.subject;
    if (name === "target") return edge.object;
    if (name === "rel") return edge.relation;
  }

  if (bindings.nodes.has(name)) {
    return bindings.nodes.get(name)!.id;
  }

  if (bindings.values.has(name)) {
    return deepClone(bindings.values.get(name)!);
  }

  if (context === "node") {
    if (name === "source" || name === "target" || name === "rel") {
      throw new Error(`Invalid @where field for node prune: "${name}"`);
    }
  }

  if (context === "edge") {
    if (
      name === "id" ||
      name === "type" ||
      name === "key" ||
      name === "value" ||
      name === "state" ||
      name === "meta"
    ) {
      throw new Error(`Invalid @where field for edge prune: "${name}"`);
    }
  }

  throw new Error(`Unresolved symbol "${name}" in @where predicate`);
}

function resolvePropertyOperand(
  value: Extract<BooleanValueNode, { type: "PropertyAccess" }>,
  context: "node" | "edge",
  item: GraphNode | GraphEdge,
): GraphValue | undefined {
  if (context === "edge") {
    throw new Error(
      `Invalid @where field for edge prune: "${value.object.name}"`,
    );
  }

  const node = item as GraphNode;

  if (value.object.name === "state") {
    return digPruneValue(
      node.state,
      value.chain.map((part) => part.name),
    );
  }

  if (value.object.name === "meta") {
    return digPruneValue(
      node.meta,
      value.chain.map((part) => part.name),
    );
  }

  throw new Error(
    `Invalid @where field for node prune: "${value.object.name}"`,
  );
}

function readObjectField(
  value: GraphValue,
  field: string,
): GraphValue | undefined {
  if (!isRecordValue(value)) return undefined;
  if (!(field in value)) return undefined;
  return value[field];
}

function digPruneValue(
  value: GraphValue,
  path: string[],
): GraphValue | undefined {
  let current: GraphValue = value;
  for (const part of path) {
    if (!isRecordValue(current)) {
      return undefined;
    }
    if (!(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function comparePruneValue(
  a: GraphValue | undefined,
  b: GraphValue | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneRuntimeNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function deepClone<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (typeof value === "object") {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = deepClone(v);
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

function isRecordValue(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
