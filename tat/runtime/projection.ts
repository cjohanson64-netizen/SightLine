import type { ProjectExprNode, ValueExprNode } from "../ast/nodeTypes";
import type { RuntimeState } from "./executeProgram";
import type { RuntimeBindings } from "./evaluateNodeCapture";
import type { ActionRegistry } from "./actionRegistry";
import type { Graph, GraphEdge, GraphHistoryEntry, GraphNode, GraphValue } from "./graph";
import { evaluateValueExpr } from "./evaluateNodeCapture";
import {
  cloneGraphValue,
  getNode,
  getOutgoingEdges,
} from "./graph";
import { evaluateActionGuard } from "./executeAction";
import { getAction } from "./actionRegistry";

export const PROJECT_FORMATS = [
  "graph",
  "detail",
  "menu",
  "list",
  "tree",
  "timeline",
  "trace",
  "summary",
] as const;

export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const PROJECT_INCLUDE_KEYS = [
  "id",
  "step",
  "from",
  "to",
  "raw",
  "label",
  "type",
  "value",
  "state",
  "meta",
  "relationships",
  "children",
  "events",
  "actions",
  "action",
  "target",
  "event",
  "status",
] as const;

export type ProjectIncludeKey = (typeof PROJECT_INCLUDE_KEYS)[number];

type ProjectContractKey = "nodes" | "node" | "items" | "tree" | "events" | "data";

interface ProjectFormatRule {
  core: ProjectIncludeKey[];
  allowed: ProjectIncludeKey[];
  contractKey: ProjectContractKey;
}

export const PROJECT_FORMAT_RULES: Record<ProjectFormat, ProjectFormatRule> = {
  graph: {
    core: ["id", "type", "value", "state", "meta", "relationships"],
    allowed: ["label", "status"],
    contractKey: "nodes",
  },
  detail: {
    core: ["id", "label", "type", "state", "meta"],
    allowed: ["value", "relationships", "actions", "status", "events"],
    contractKey: "node",
  },
  menu: {
    core: ["label", "action", "target"],
    allowed: ["id", "status", "meta"],
    contractKey: "items",
  },
  list: {
    core: ["id", "label"],
    allowed: ["type", "status", "state", "meta", "action", "target", "event"],
    contractKey: "items",
  },
  tree: {
    core: ["label", "children"],
    allowed: ["id", "type", "value", "state", "status", "meta"],
    contractKey: "tree",
  },
  timeline: {
    core: ["events"],
    allowed: [
      "id",
      "step",
      "from",
      "event",
      "action",
      "target",
      "label",
      "status",
      "state",
      "meta",
      "raw",
    ],
    contractKey: "events",
  },
  trace: {
    core: ["events"],
    allowed: [
      "id",
      "step",
      "from",
      "to",
      "event",
      "action",
      "target",
      "status",
      "state",
      "meta",
      "label",
      "raw",
    ],
    contractKey: "events",
  },
  summary: {
    core: ["label", "status"],
    allowed: ["id", "state", "meta", "actions"],
    contractKey: "data",
  },
};

interface ProjectSpec {
  format: ProjectFormat;
  focus: string;
  include: ProjectIncludeKey[];
}

interface ProjectFieldContext {
  graph: Graph;
  focus: string;
  bindings: RuntimeBindings;
  actions: ActionRegistry;
}

interface ResolvedActionCandidate {
  id: string;
  label: string;
  bindingName: string;
  sourceNode: GraphNode | null;
}

interface MenuPair {
  action: ResolvedActionCandidate;
  target: GraphNode;
}

interface NormalizedEventRecord {
  id: string;
  step?: number;
  from?: string;
  to?: string;
  raw?: string;
  label: string;
  event?: string;
  target?: GraphValue;
  action?: GraphValue;
  status?: string;
  state?: Record<string, GraphValue>;
  meta?: Record<string, GraphValue>;
}

export function projectGraphResult(
  graph: Graph,
  projection: ProjectExprNode | null,
  state: RuntimeState,
): unknown {
  const spec = resolveProjectSpec(graph, projection, state);
  const context: ProjectFieldContext = {
    graph,
    focus: spec.focus,
    bindings: state.bindings,
    actions: state.actions,
  };

  switch (spec.format) {
    case "graph":
      return projectGraphFormat(context, spec);
    case "detail":
      return {
        format: "detail",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        node: selectNodeFields(getNode(graph, spec.focus), spec.include, context),
      };
    case "menu":
      return {
        format: "menu",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        items: buildMenuPairs(context).map((pair, index) =>
          selectMenuFields(pair, spec.include, context, index),
        ),
      };
    case "list":
      return {
        format: "list",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        items: getOutgoingEdges(graph, spec.focus)
          .filter((edge) => edge.kind === "branch" && edge.relation === "contains")
          .map((edge, index) =>
            selectListFields(getNode(graph, edge.object), spec.include, context, index),
          ),
      };
    case "tree":
      return {
        format: "tree",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        tree: buildTreeNode(spec.focus, spec.include, context, new Set<string>()),
      };
    case "timeline":
      return {
        format: "timeline",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        events: buildTimelineEvents(context).map((event) =>
          selectEventFields(event, spec.include),
        ),
      };
    case "trace":
      return {
        format: "trace",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        steps: buildTraceEvents(context).map((event) =>
          selectEventFields(event, spec.include),
        ),
      };
    case "summary":
      return {
        format: "summary",
        focus: projectNodeReference(getNode(graph, spec.focus)),
        data: selectSummaryFields(getNode(graph, spec.focus), spec.include, context),
      };
  }
}

export function resolveProjectSpec(
  graph: Graph,
  projection: ProjectExprNode | null,
  state: Pick<RuntimeState, "bindings" | "actions">,
): ProjectSpec {
  if (!projection) {
    if (!graph.root) {
      throw new Error(`@project could not determine a focus node because the graph has no root`);
    }

    return {
      format: "graph",
      focus: graph.root,
      include: fullIncludeSet("graph"),
    };
  }

  const formatArg = getProjectArgument(projection, "format");
  if (!formatArg) {
    throw new Error(`@project requires a format field`);
  }

  const formatValue = evaluateValueExpr(formatArg.value, state.bindings, state.actions);
  if (typeof formatValue !== "string") {
    throw new Error(`@project format must resolve to a string`);
  }
  if (!isProjectFormat(formatValue)) {
    throw new Error(`Invalid @project format "${formatValue}"`);
  }

  const focusArg = getProjectArgument(projection, "focus");
  const includeArg = getProjectArgument(projection, "include");

  if (projection.syntax === "block") {
    if (!focusArg) {
      throw new Error(`@project requires a focus field`);
    }
    if (!includeArg) {
      throw new Error(`@project requires an include field`);
    }
  }

  const focus = focusArg
    ? resolveFocusNodeId(focusArg.value, graph, state.bindings, state.actions)
    : graph.root;

  if (!focus) {
    throw new Error(`@project could not determine a focus node`);
  }

  if (!graph.nodes.has(focus)) {
    throw new Error(`@project focus "${focus}" does not resolve to a node in the graph`);
  }

  const include = includeArg
    ? resolveProjectInclude(includeArg.value, formatValue, state.bindings, state.actions)
    : fullIncludeSet(formatValue);

  return {
    format: formatValue,
    focus,
    include,
  };
}

export function getProjectArgument(
  projection: ProjectExprNode,
  key: string,
): { key: ProjectExprNode["args"][number]["key"]; value: ValueExprNode } | null {
  return (
    projection.args.find((arg) => arg.key && arg.key.name === key) ?? null
  );
}

export function isProjectFormat(value: string): value is ProjectFormat {
  return (PROJECT_FORMATS as readonly string[]).includes(value);
}

export function isProjectIncludeKey(value: string): value is ProjectIncludeKey {
  return (PROJECT_INCLUDE_KEYS as readonly string[]).includes(value);
}

export function fullIncludeSet(format: ProjectFormat): ProjectIncludeKey[] {
  const rule = PROJECT_FORMAT_RULES[format];
  return [...rule.core, ...rule.allowed];
}

function resolveProjectInclude(
  expr: ValueExprNode,
  format: ProjectFormat,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): ProjectIncludeKey[] {
  const value = evaluateValueExpr(expr, bindings, actions);
  if (!Array.isArray(value)) {
    throw new Error(`@project include must resolve to an array`);
  }

  const include: ProjectIncludeKey[] = [];
  const seen = new Set<ProjectIncludeKey>();
  const rule = PROJECT_FORMAT_RULES[format];
  const allowed = new Set<ProjectIncludeKey>([...rule.core, ...rule.allowed]);

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error(`@project include entries must resolve to strings`);
    }
    if (!isProjectIncludeKey(entry)) {
      throw new Error(`Invalid @project include key "${entry}"`);
    }
    if (!allowed.has(entry)) {
      throw new Error(
        `@project format "${format}" does not allow include key "${entry}"`,
      );
    }
    if (!seen.has(entry)) {
      include.push(entry);
      seen.add(entry);
    }
  }

  for (const required of rule.core) {
    if (!seen.has(required)) {
      throw new Error(
        `@project format "${format}" requires include key "${required}"`,
      );
    }
  }

  return include;
}

function resolveFocusNodeId(
  expr: ValueExprNode,
  graph: Graph,
  bindings: RuntimeBindings,
  actions: ActionRegistry,
): string {
  if (expr.type === "Identifier" && bindings.nodes.has(expr.name)) {
    return bindings.nodes.get(expr.name)!.id;
  }

  const value = evaluateValueExpr(expr, bindings, actions);
  if (typeof value !== "string") {
    throw new Error(`@project focus must resolve to a node reference`);
  }

  if (bindings.nodes.has(value)) {
    return bindings.nodes.get(value)!.id;
  }

  if (!graph.nodes.has(value)) {
    throw new Error(`@project focus "${value}" does not resolve to a node in the graph`);
  }

  return value;
}

function projectGraphFormat(
  context: ProjectFieldContext,
  spec: ProjectSpec,
): {
  format: "graph";
  focus: string;
  nodes: Array<Record<string, GraphValue>>;
  edges: Array<Record<string, GraphValue>>;
} {
  const focusNode = getNode(context.graph, spec.focus);
  const reachableEdges = getOutgoingEdges(context.graph, spec.focus);
  const reachableIds = new Set<string>([
    spec.focus,
    ...reachableEdges.map((edge) => edge.object),
  ]);

  return {
    format: "graph",
    focus: spec.focus,
    nodes: Array.from(reachableIds).map((nodeId) =>
      selectNodeFields(getNode(context.graph, nodeId), spec.include, context),
    ),
    edges: reachableEdges.map((edge) => ({
      id: edge.id,
      relation: edge.relation,
      source: edge.subject,
      target: edge.object,
      kind: edge.kind,
      context: edge.context === null ? null : cloneGraphValue(edge.context),
      focus: focusNode.id,
    })),
  };
}

function selectNodeFields(
  node: GraphNode,
  include: ProjectIncludeKey[],
  context: ProjectFieldContext,
): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = node.id;
        break;
      case "label":
        out.label = computeNodeLabel(node);
        break;
      case "type": {
        const type = computeNodeType(node);
        if (type !== null) out.type = type;
        break;
      }
      case "value":
        out.value = cloneGraphValue(node.value);
        break;
      case "state":
        out.state = cloneRecord(node.state);
        break;
      case "meta":
        out.meta = cloneRecord(node.meta);
        break;
      case "relationships":
        out.relationships = getOutgoingEdges(context.graph, node.id)
          .filter((edge) => edge.kind === "branch")
          .map((edge) => ({
            relation: edge.relation,
            target: edge.object,
          }));
        break;
      case "actions":
        out.actions = buildAvailableActions(node.id, context).map((action) => ({
          id: action.id,
          label: action.label,
        }));
        break;
      case "events":
        out.events = buildTimelineEvents({ ...context, focus: node.id }).map((event) =>
          selectEventFields(event, ["id", "event", "label", "target", "action", "status"]),
        );
        break;
      case "status":
        out.status = computeNodeStatus(node);
        break;
      case "action":
      case "target":
      case "event":
      case "children":
        break;
    }
  }

  return out;
}

function selectMenuFields(
  pair: MenuPair,
  include: ProjectIncludeKey[],
  context: ProjectFieldContext,
  _index: number,
): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};
  const actionId = resolveMenuActionId(pair);

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = `${context.focus}.${actionId}.${pair.target.id}`;
        break;
      case "label":
        out.label = `${pair.action.label} ${computeNodeLabel(pair.target)}`;
        break;
      case "action":
        out.action = projectActionReference(pair.action, actionId);
        break;
      case "target":
        out.target = projectNodeReference(pair.target);
        break;
      case "status":
        out.status = "available";
        break;
      case "meta":
        out.meta = cloneRecord(pair.target.meta);
        break;
      default:
        break;
    }
  }

  return out;
}

function resolveMenuActionId(pair: MenuPair): string {
  // Prefer binding name when it differs from node id (e.g. value.binding = "attack")
  if (pair.action.bindingName !== pair.action.id) {
    return pair.action.bindingName;
  }
  // Strip trailing "Node" suffix (e.g. "attackNode" → "attack")
  if (pair.action.id.endsWith("Node")) {
    return pair.action.id.slice(0, -"Node".length);
  }
  return pair.action.id;
}

function selectListFields(
  node: GraphNode,
  include: ProjectIncludeKey[],
  context: ProjectFieldContext,
  index: number,
): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = node.id;
        break;
      case "label":
        out.label = computeNodeLabel(node);
        break;
      case "type": {
        const type = computeNodeType(node);
        if (type !== null) out.type = type;
        break;
      }
      case "status":
        out.status = computeNodeStatus(node);
        break;
      case "state":
        out.state = cloneRecord(node.state);
        break;
      case "meta":
        out.meta = cloneRecord(node.meta);
        break;
      case "action": {
        const action = buildAvailableActions(context.focus, context)[index] ?? null;
        if (action) {
          out.action = projectActionReference(action, resolveActionId(action));
        }
        break;
      }
      case "target":
        out.target = projectNodeReference(node);
        break;
      case "event":
        out.event = "contains";
        break;
      default:
        break;
    }
  }

  return out;
}

function buildTreeNode(
  nodeId: string,
  include: ProjectIncludeKey[],
  context: ProjectFieldContext,
  visited: Set<string>,
): Record<string, GraphValue> {
  const node = getNode(context.graph, nodeId);
  const out: Record<string, GraphValue> = {};
  visited.add(nodeId);

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = node.id;
        break;
      case "label":
        out.label = computeNodeLabel(node);
        break;
      case "type": {
        const type = computeNodeType(node);
        if (type !== null) out.type = type;
        break;
      }
      case "value":
        out.value = cloneGraphValue(node.value);
        break;
      case "state":
        out.state = cloneRecord(node.state);
        break;
      case "status":
        out.status = computeNodeStatus(node);
        break;
      case "meta":
        out.meta = cloneRecord(node.meta);
        break;
      case "children":
        out.children = getPreferredTreeEdges(context.graph, nodeId)
          .filter((edge) => !visited.has(edge.object))
          .map((edge) =>
            buildTreeNode(edge.object, include, context, new Set<string>(visited)),
          );
        break;
      default:
        break;
    }
  }

  return out;
}

function buildTimelineEvents(context: ProjectFieldContext): NormalizedEventRecord[] {
  const applyEvents = getApplyHistoryEntries(context.graph.history, context.focus);

  return applyEvents.map((entry, index) =>
    normalizeApplyTimelineEvent(entry, context, index),
  );
}

function buildTraceEvents(context: ProjectFieldContext): NormalizedEventRecord[] {
  const applyEvents = getApplyHistoryEntries(context.graph.history, context.focus);

  return applyEvents.map((entry, index) =>
    normalizeApplyTraceEvent(entry, context, index),
  );
}

function getApplyHistoryEntries(
  history: GraphHistoryEntry[],
  focus: string,
): GraphHistoryEntry[] {
  return history.filter(
    (entry) => entry.op === "@apply" && historyEntryTouchesFocus(entry, focus),
  );
}

function normalizeApplyTimelineEvent(
  entry: GraphHistoryEntry,
  context: ProjectFieldContext,
  index: number,
): NormalizedEventRecord {
  const from = readStringField(entry.payload, ["from"]);
  const action = readStringField(entry.payload, ["action"]);
  const to = readStringField(entry.payload, ["to"]);
  const sourceNode = from && context.graph.nodes.has(from) ? getNode(context.graph, from) : null;
  const targetNode = to && context.graph.nodes.has(to) ? getNode(context.graph, to) : null;
  const actionCandidate = resolveActionCandidateFromEvent(context, from, action);
  const actionNode = actionCandidate?.sourceNode ?? null;

  return {
    id: entry.id || `${context.focus}:timeline:${index}`,
    step: index + 1,
    from: from ?? undefined,
    raw: buildApplyRaw(from, action, to),
    label:
      sourceNode && action && targetNode
        ? `${computeNodeLabel(sourceNode)} targeted ${computeNodeLabel(targetNode)} with ${computeActionLabel(actionNode, action)}`
        : formatTraceLabel(entry, context, targetNode),
    event: action ?? "apply",
    action: actionCandidate ? projectActionReference(actionCandidate) : action,
    target: targetNode ? projectNodeReference(targetNode) : to ?? undefined,
    status: targetNode ? computeNodeStatus(targetNode) : "resolved",
    state:
      targetNode && Object.keys(targetNode.state).length > 0
        ? cloneRecord(targetNode.state)
        : undefined,
    meta:
      targetNode && Object.keys(targetNode.meta).length > 0
        ? cloneRecord(targetNode.meta)
        : undefined,
  };
}

function normalizeApplyTraceEvent(
  entry: GraphHistoryEntry,
  context: ProjectFieldContext,
  index: number,
): NormalizedEventRecord {
  const from = readStringField(entry.payload, ["from"]);
  const action = readStringField(entry.payload, ["action"]);
  const to = readStringField(entry.payload, ["to"]);
  const sourceNode = from && context.graph.nodes.has(from) ? getNode(context.graph, from) : null;
  const targetNode = to && context.graph.nodes.has(to) ? getNode(context.graph, to) : null;
  const actionCandidate = resolveActionCandidateFromEvent(context, from, action);
  const actionNode = actionCandidate?.sourceNode ?? null;

  return {
    id: entry.id || `${context.focus}:trace:${index}`,
    step: index + 1,
    from: from ?? undefined,
    to: to ?? undefined,
    raw: buildApplyRaw(from, action, to),
    label:
      sourceNode && action && targetNode
        ? `${computeNodeLabel(sourceNode)} targeted ${computeNodeLabel(targetNode)} with ${computeActionLabel(actionNode, action)}`
        : formatTraceLabel(entry, context, targetNode),
    event: "@apply",
    action: actionCandidate ? projectActionReference(actionCandidate) : action,
    target: targetNode ? projectNodeReference(targetNode) : to ?? undefined,
    status: targetNode ? computeNodeStatus(targetNode) : "resolved",
    state:
      targetNode && Object.keys(targetNode.state).length > 0
        ? cloneRecord(targetNode.state)
        : undefined,
    meta:
      targetNode && Object.keys(targetNode.meta).length > 0
        ? cloneRecord(targetNode.meta)
        : undefined,
  };
}

function selectEventFields(
  event: NormalizedEventRecord,
  include: ProjectIncludeKey[],
): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = event.id;
        break;
      case "step":
        if (typeof event.step === "number") out.step = event.step;
        break;
      case "from":
        if (event.from) out.from = event.from;
        break;
      case "to":
        if (event.to) out.to = event.to;
        break;
      case "label":
        out.label = event.label;
        break;
      case "raw":
        if (event.raw) out.raw = event.raw;
        break;
      case "event":
        if (event.event) out.event = event.event;
        break;
      case "target":
        if (event.target) out.target = event.target;
        break;
      case "action":
        if (event.action) out.action = event.action;
        break;
      case "status":
        if (event.status) out.status = event.status;
        break;
      case "state":
        if (event.state) out.state = event.state;
        break;
      case "meta":
        if (event.meta) out.meta = event.meta;
        break;
      case "events":
      case "actions":
      case "children":
      case "relationships":
      case "type":
      case "value":
        break;
    }
  }

  return out;
}

function selectSummaryFields(
  node: GraphNode,
  include: ProjectIncludeKey[],
  context: ProjectFieldContext,
): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};

  for (const key of include) {
    switch (key) {
      case "id":
        out.id = node.id;
        break;
      case "label":
        out.label = computeNodeLabel(node);
        break;
      case "status":
        out.status = computeNodeStatus(node);
        break;
      case "state":
        out.state = cloneRecord(node.state);
        break;
      case "meta":
        out.meta = cloneRecord(node.meta);
        break;
      case "actions":
        out.actions = buildAvailableActions(node.id, context).map((action) => ({
          id: action.id,
          label: action.label,
        }));
        break;
      default:
        break;
    }
  }

  return out;
}

function buildAvailableActions(
  focus: string,
  context: ProjectFieldContext,
): ResolvedActionCandidate[] {
  const menuPairs = buildMenuPairs({ ...context, focus });
  const seen = new Set<string>();
  const actions: ResolvedActionCandidate[] = [];

  for (const pair of menuPairs) {
    if (seen.has(pair.action.id)) continue;
    seen.add(pair.action.id);
    actions.push(pair.action);
  }

  return actions;
}

function getPreferredTreeEdges(graph: Graph, nodeId: string): GraphEdge[] {
  const relationPriority = ["unlocks", "contains", "targets", "can"];
  const outgoingEdges = getOutgoingEdges(graph, nodeId).filter(
    (edge) => edge.kind === "branch",
  );

  for (const relation of relationPriority) {
    const matches = outgoingEdges.filter((edge) => edge.relation === relation);
    if (matches.length > 0) {
      return matches;
    }
  }

  return outgoingEdges;
}

// Guard-aware menu pair derivation.
// For each can-reachable action × targets-reachable target pair, the action guard
// (if any) is evaluated with from=focus, to=target. Pairs that fail the guard are
// omitted. Actions with no guard are treated as always available.
function buildMenuPairs(context: ProjectFieldContext): MenuPair[] {
  const actionCandidates = getOutgoingEdges(context.graph, context.focus)
    .filter((edge) => edge.kind === "branch" && edge.relation === "can")
    .map((edge) => resolveActionCandidate(edge.object, context));

  const targetCandidates = getOutgoingEdges(context.graph, context.focus)
    .filter((edge) => edge.kind === "branch" && edge.relation === "targets")
    .map((edge) => getNode(context.graph, edge.object));

  const pairs: MenuPair[] = [];

  for (const action of actionCandidates) {
    const runtimeAction = getAction(context.actions, action.bindingName);

    for (const target of targetCandidates) {
      if (runtimeAction?.guard) {
        const scope = { from: context.focus, to: target.id };
        const passes = evaluateActionGuard(runtimeAction.guard, context.graph, scope);
        if (!passes) continue;
      }
      pairs.push({ action, target });
    }
  }

  return pairs;
}

// V1: returns a candidate for every can-edge target, whether or not a
// registered @action exists. bindingName is used for action id derivation
// and as a fallback for registered-action lookups elsewhere (e.g. detail/summary).
function resolveActionCandidate(
  nodeId: string,
  context: ProjectFieldContext,
): ResolvedActionCandidate {
  const node = context.graph.nodes.get(nodeId);

  if (!node) {
    return {
      id: nodeId,
      label: titleCase(nodeId),
      bindingName: nodeId,
      sourceNode: null,
    };
  }

  const directBinding = context.actions.has(node.id) ? node.id : null;
  const metaBinding =
    typeof node.meta.actionBinding === "string" && context.actions.has(node.meta.actionBinding)
      ? node.meta.actionBinding
      : typeof node.meta.action === "string" && context.actions.has(node.meta.action)
        ? node.meta.action
        : null;
  const valueBinding =
    isRecord(node.value) &&
    typeof node.value.binding === "string" &&
    context.actions.has(node.value.binding)
      ? node.value.binding
      : isRecord(node.value) &&
          typeof node.value.action === "string" &&
          context.actions.has(node.value.action)
        ? node.value.action
        : null;
  // Try value.id as a binding name (e.g. node value { id: "attack", type: "action", name: "Attack" })
  const valueIdBinding =
    isRecord(node.value) &&
    typeof node.value.id === "string" &&
    context.actions.has(node.value.id)
      ? node.value.id
      : null;
  // Strip trailing "Node" suffix from node id (e.g. "attackNode" → "attack").
  // Matches the output convention in resolveMenuActionId so guard lookup stays consistent.
  const strippedNodeId = node.id.endsWith("Node") ? node.id.slice(0, -"Node".length) : null;
  const strippedBinding =
    strippedNodeId !== null && context.actions.has(strippedNodeId) ? strippedNodeId : null;

  // Priority: explicit bindings > value.id > node-suffix stripping > raw node id (no guard)
  const bindingName =
    directBinding ?? metaBinding ?? valueBinding ?? valueIdBinding ?? strippedBinding ?? node.id;

  return {
    id: node.id,
    label: computeNodeLabel(node),
    bindingName,
    sourceNode: node,
  };
}

function resolveActionId(action: ResolvedActionCandidate): string {
  if (action.bindingName !== action.id) {
    return action.bindingName;
  }
  if (action.id.endsWith("Node")) {
    return action.id.slice(0, -"Node".length);
  }
  return action.id;
}

function resolveActionCandidateFromEvent(
  context: ProjectFieldContext,
  from: string | undefined,
  action: string | undefined,
): ResolvedActionCandidate | null {
  if (!from || !action || !context.graph.nodes.has(from)) {
    return null;
  }

  const candidates = buildAvailableActions(from, { ...context, focus: from });
  return candidates.find(
    (candidate) =>
      resolveActionId(candidate) === action ||
      candidate.bindingName === action ||
      candidate.id === action,
  ) ?? null;
}

function projectNodeReference(node: GraphNode): Record<string, GraphValue> {
  return {
    id: node.id,
    label: computeNodeLabel(node),
    value: cloneGraphValue(node.value),
    state: cloneRecord(node.state),
    meta: cloneRecord(node.meta),
    status: computeNodeStatus(node),
  };
}

function projectActionReference(
  action: ResolvedActionCandidate,
  actionId = resolveActionId(action),
): GraphValue {
  if (!action.sourceNode) {
    return {
      id: actionId,
      label: action.label,
      value: {},
      state: {},
      meta: {},
    };
  }

  return {
    ...projectNodeReference(action.sourceNode),
    id: actionId,
  };
}

function computeActionLabel(actionNode: GraphNode | null, fallback: string | undefined): string {
  if (actionNode) {
    return computeNodeLabel(actionNode);
  }

  return fallback ?? "Apply";
}

function buildApplyRaw(
  from: string | undefined,
  action: string | undefined,
  to: string | undefined,
): string | undefined {
  if (!from || !action || !to) {
    return undefined;
  }

  return `@apply(<${from}.${action}.${to}>)`;
}

function computeNodeLabel(node: GraphNode): string {
  if (isRecord(node.value) && typeof node.value.name === "string") {
    return node.value.name;
  }
  if (typeof node.meta.label === "string") {
    return node.meta.label;
  }
  return node.id;
}

function computeNodeType(node: GraphNode): string | null {
  if (isRecord(node.value) && typeof node.value.type === "string") {
    return node.value.type;
  }
  return null;
}

function computeNodeStatus(node: GraphNode): string {
  if (typeof node.state.status === "string") return node.state.status;
  if (typeof node.meta.status === "string") return node.meta.status;
  if (node.state.defeated === true) return "defeated";
  if (node.state.active === true) return "active";
  if (node.state.resolved === true) return "resolved";
  if (node.state.ready === true) return "ready";
  return "ready";
}

function historyEntryTouchesFocus(entry: GraphHistoryEntry, focus: string): boolean {
  return Object.values(entry.payload).some((value) => value === focus);
}

function readStringField(
  payload: Record<string, GraphValue>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof payload[key] === "string") {
      return payload[key] as string;
    }
  }
  return undefined;
}

function formatTraceLabel(
  entry: GraphHistoryEntry,
  context: ProjectFieldContext,
  targetNode: GraphNode | null,
): string {
  const subject = readStringField(entry.payload, ["subject", "from", "nodeId"]);
  const relation = readStringField(entry.payload, ["relation"]);
  const object = readStringField(entry.payload, ["object", "to"]);

  if (relation && object && targetNode) {
    const sourceLabel =
      subject && context.graph.nodes.has(subject)
        ? computeNodeLabel(getNode(context.graph, subject))
        : context.focus;
    return `${sourceLabel} ${relation} ${computeNodeLabel(targetNode)}`;
  }

  return `${entry.op} ${targetNode ? computeNodeLabel(targetNode) : context.focus}`.trim();
}

function cloneRecord(record: Record<string, GraphValue>): Record<string, GraphValue> {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = cloneGraphValue(value);
  }
  return out;
}

function isRecord(value: GraphValue): value is Record<string, GraphValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleCase(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}
