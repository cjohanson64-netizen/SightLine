import type {
  ActionGuardExprNode,
  ActionPipelineStepNode,
  ActionProjectExprNode,
} from "../ast/nodeTypes";

export interface RuntimeAction {
  bindingName: string;
  guard: ActionGuardExprNode | null;
  pipeline: ActionPipelineStepNode[];
  project: ActionProjectExprNode | null;
}

export type ActionRegistry = Map<string, RuntimeAction>;

export function createActionRegistry(): ActionRegistry {
  return new Map<string, RuntimeAction>();
}

export function registerAction(
  registry: ActionRegistry,
  action: RuntimeAction,
): void {
  registry.set(action.bindingName, cloneRuntimeAction(action));
}

export function getAction(
  registry: ActionRegistry,
  bindingName: string,
): RuntimeAction | null {
  const action = registry.get(bindingName);
  return action ? cloneRuntimeAction(action) : null;
}

export function hasAction(
  registry: ActionRegistry,
  bindingName: string,
): boolean {
  return registry.has(bindingName);
}

export function cloneActionRegistry(
  registry: ActionRegistry,
): ActionRegistry {
  const next = createActionRegistry();

  for (const [bindingName, action] of registry.entries()) {
    next.set(bindingName, cloneRuntimeAction(action));
  }

  return next;
}

function cloneRuntimeAction(action: RuntimeAction): RuntimeAction {
  return {
    bindingName: action.bindingName,
    guard: action.guard ? cloneAstNode(action.guard) : null,
    pipeline: action.pipeline.map((step) => cloneAstNode(step)),
    project: action.project ? cloneAstNode(action.project) : null,
  };
}

function cloneAstNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}
