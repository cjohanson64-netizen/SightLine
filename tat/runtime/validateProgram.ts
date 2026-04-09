import type {
  ActionGuardExprNode,
  ActionPipelineStepNode,
  DeriveExprNode,
  DeriveMetaExprNode,
  DeriveStateExprNode,
  GraphControlExprNode,
  GraphQueryExprNode,
  GraphInteractionDefinitionNode,
  GraphPipelineStepNode,
  GraphProjectionNode,
  IfExprNode,
  LoopExprNode,
  LoopCountExprNode,
  ProgramNode,
  StatementNode,
  ValueBindingNode,
  SeedBlockNode,
  GraphPipelineNode,
  QueryStatementNode,
  ActionExprNode,
  MutationExprNode,
  ProjectExprNode,
  WhenExprNode,
} from "../ast/nodeTypes";
import {
  PROJECT_FORMAT_RULES,
  isProjectFormat,
  isProjectIncludeKey,
} from "./projection";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  span?: { line: number; column: number };
}

interface ValidationState {
  valueBindings: Set<string>;
  nodeBindings: Set<string>;
  operatorBindings: Set<string>;
  actionBindings: Set<string>;
  graphBindings: Set<string>;
  hasSeed: boolean;
  terminalProjectReached: boolean;
  issues: ValidationIssue[];
}

export function validateProgram(program: ProgramNode): ValidationIssue[] {
  const state: ValidationState = {
    valueBindings: new Set(),
    nodeBindings: new Set(),
    operatorBindings: new Set(),
    actionBindings: new Set(),
    graphBindings: new Set(),
    hasSeed: false,
    terminalProjectReached: false,
    issues: [],
  };

  for (const statement of program.body) {
    validateStatement(statement, state);
  }

  return state.issues;
}

function validateStatement(
  statement: StatementNode,
  state: ValidationState,
): void {
  switch (statement.type) {
    case "ImportDeclaration":
    case "ExportDeclaration":
      return;

    case "BindStatement":
      validateStatementAfterTerminalProject(statement.type, state);
      return;

    case "ValueBinding":
      validateValueBinding(statement, state);
      return;

    case "OperatorBinding":
      validateOperatorBinding(statement, state);
      return;

    case "SeedBlock":
      validateSeedBlock(statement, state);
      return;

    case "GraphPipeline":
      validateGraphPipeline(statement, state);
      return;

    case "GraphProjection":
      validateGraphProjection(statement, state);
      return;

    case "WhenExpr":
      validateWhenExpr(statement, state);
      return;

    case "GraphInteractionDefinition":
      validateGraphInteractionDefinition(statement, state);
      return;

    case "QueryStatement":
      validateQueryStatement(statement, state);
      return;

    default:
      return;
  }
}

function validateValueBinding(
  statement: ValueBindingNode,
  state: ValidationState,
): void {
  const name = statement.name.name;

  if (isTopLevelNameTaken(name, state)) {
    pushIssue(
      state,
      "error",
      statement.name.span,
      `Duplicate binding "${name}"`,
    );
    return;
  }

  state.valueBindings.add(name);

  if (statement.value.type === "NodeCapture") {
    state.nodeBindings.add(name);
    validateNodeCapture(statement, state);
  }
}

function validateOperatorBinding(
  statement: Extract<StatementNode, { type: "OperatorBinding" }>,
  state: ValidationState,
): void {
  const name = statement.name.name;

  if (isTopLevelNameTaken(name, state)) {
    pushIssue(
      state,
      "error",
      statement.name.span,
      `Duplicate binding "${name}"`,
    );
    return;
  }

  state.operatorBindings.add(name);

  if (statement.value.type === "ActionExpr") {
    state.actionBindings.add(name);
    validateAction(statement.value, state);
  }
}

function validateSeedBlock(
  statement: SeedBlockNode,
  state: ValidationState,
): void {
  if (state.hasSeed) {
    pushIssue(
      state,
      "error",
      statement.span,
      "Multiple @seed blocks are not allowed",
    );
  }

  state.hasSeed = true;
}

function validateGraphPipeline(
  statement: GraphPipelineNode,
  state: ValidationState,
): void {
  const name = statement.name.name;

  if (isTopLevelNameTaken(name, state)) {
    pushIssue(
      state,
      "error",
      statement.name.span,
      `Duplicate graph name "${name}"`,
    );
    return;
  }

  state.graphBindings.add(name);

  if (statement.projection) {
    validateProjectExpr(statement.projection, state);
    state.terminalProjectReached = true;
  }

  for (const step of statement.mutations) {
    validateGraphPipelineStep(step, state);
  }
}

function validateGraphProjection(
  statement: GraphProjectionNode,
  state: ValidationState,
): void {
  const name = statement.name.name;

  if (isTopLevelNameTaken(name, state)) {
    pushIssue(
      state,
      "error",
      statement.name.span,
      `Duplicate binding "${name}"`,
    );
    return;
  }

  state.valueBindings.add(name);

  if (!state.graphBindings.has(statement.source.name)) {
    pushIssue(
      state,
      "error",
      statement.source.span,
      `@project source "${statement.source.name}" is not a known graph binding`,
    );
  }

  validateProjectExpr(statement.projection, state);
}

function validateProjectExpr(
  projection: ProjectExprNode,
  state: ValidationState,
): void {
  const formatArg = projection.args.find(
    (arg) => arg.key && arg.key.name === "format",
  );
  const focusArg = projection.args.find(
    (arg) => arg.key && arg.key.name === "focus",
  );
  const includeArg = projection.args.find(
    (arg) => arg.key && arg.key.name === "include",
  );

  if (!formatArg) {
    pushIssue(state, "error", projection.span, "@project requires a format field");
    return;
  }

  if (formatArg.value.type !== "StringLiteral") {
    pushIssue(
      state,
      "error",
      formatArg.value.span,
      "@project format must be a string literal",
    );
    return;
  }

  const formatValue = formatArg.value.value;
  if (!isProjectFormat(formatValue)) {
    pushIssue(
      state,
      "error",
      formatArg.value.span,
      `Invalid @project format "${formatValue}"`,
    );
    return;
  }

  if (projection.syntax === "block" && !focusArg) {
    pushIssue(state, "error", projection.span, "@project requires a focus field");
  }

  if (projection.syntax === "block" && !includeArg) {
    pushIssue(state, "error", projection.span, "@project requires an include field");
  }

  if (focusArg) {
    validateProjectFocus(focusArg.value, state);
  }

  if (includeArg) {
    validateProjectInclude(formatValue, includeArg.value, state);
  }
}

function validateProjectFocus(
  value: ProjectExprNode["args"][number]["value"],
  state: ValidationState,
): void {
  if (value.type === "Identifier") {
    validateIdentifier(value.name, value.span, state);
    return;
  }

  if (value.type === "StringLiteral") {
    return;
  }

  pushIssue(
    state,
    "error",
    value.span,
    "@project focus must be an identifier or string literal",
  );
}

function validateProjectInclude(
  format: keyof typeof PROJECT_FORMAT_RULES,
  value: ProjectExprNode["args"][number]["value"],
  state: ValidationState,
): void {
  if (value.type !== "ArrayLiteral") {
    pushIssue(
      state,
      "error",
      value.span,
      "@project include must be an array literal",
    );
    return;
  }

  const rule = PROJECT_FORMAT_RULES[format];
  const allowed = new Set([...rule.core, ...rule.allowed]);
  const seen = new Set<string>();

  for (const element of value.elements) {
    if (element.type !== "Identifier" && element.type !== "StringLiteral") {
      pushIssue(
        state,
        "error",
        element.span,
        "@project include entries must be identifiers or string literals",
      );
      continue;
    }

    const includeKey = element.type === "Identifier" ? element.name : element.value;

    if (!isProjectIncludeKey(includeKey)) {
      pushIssue(
        state,
        "error",
        element.span,
        `Invalid @project include key "${includeKey}"`,
      );
      continue;
    }

    if (!allowed.has(includeKey)) {
      pushIssue(
        state,
        "error",
        element.span,
        `@project format "${format}" does not allow include key "${includeKey}"`,
      );
      continue;
    }

    seen.add(includeKey);
  }

  for (const required of rule.core) {
    if (!seen.has(required)) {
      pushIssue(
        state,
        "error",
        value.span,
        `@project format "${format}" requires include key "${required}"`,
      );
    }
  }
}

function validateGraphInteractionDefinition(
  statement: GraphInteractionDefinitionNode,
  state: ValidationState,
): void {
  if (statement.name) {
    const name = statement.name.name;

    if (isTopLevelNameTaken(name, state)) {
      pushIssue(
        state,
        "error",
        statement.name.span,
        `Duplicate binding "${name}"`,
      );
      return;
    }

    state.operatorBindings.add(name);
  }

  for (const op of statement.effect.ops) {
    if (op.type === "EffectDeriveStateOp" || op.type === "EffectDeriveMetaOp") {
      validateDeriveExpr(op.expression, state);
    }
  }
}

function validateQueryStatement(
  statement: QueryStatementNode,
  state: ValidationState,
): void {
  if (statement.expr.type === "GraphQueryExpr") {
    validateGraphQueryExpr(statement.expr, state);
  }
}

function validateWhenExpr(
  statement: WhenExprNode,
  state: ValidationState,
): void {
  if (!statement.event) {
    pushIssue(state, "error", statement.span, "@when requires an event");
  } else {
    validateGraphControlExpr(statement.event, state, "@when event");
  }

  if (!statement.pipeline.length) {
    pushIssue(state, "error", statement.span, "@when requires a pipeline");
  }

  for (const step of statement.pipeline) {
    validateGraphPipelineStep(step, state);
  }
}

function validateAction(action: ActionExprNode, state: ValidationState): void {
  if (!action.pipeline || action.pipeline.length === 0) {
    pushIssue(
      state,
      "error",
      action.span,
      "@action must define at least one pipeline step",
    );
  }

  if (action.guard) {
    validateActionGuard(action.guard, state);
  }

  if (action.project) {
    validateActionExpression(action.project, state);
  }

  for (const step of action.pipeline) {
    validateActionPipelineStep(step, state);
  }
}

function validateActionGuard(
  expr: ActionGuardExprNode,
  state: ValidationState,
): void {
  if (expr.type === "GraphQueryExpr") {
    validateGraphQueryExpr(expr, state);
    return;
  }

  validateActionExpression(expr, state);
}

function validateNodeCapture(
  statement: ValueBindingNode,
  state: ValidationState,
): void {
  const value = statement.value;

  if (value.type !== "NodeCapture") return;
  const shape = value.shape;

  if (shape.type !== "TraversalExpr") return;

  for (const segment of shape.segments) {
    const operator =
      segment.type === "ActionSegment"
        ? segment.operator
        : segment.segment.operator;

    ensureKnownAction(state, operator.name, operator.span);
  }
}

function validateMutation(
  mutation: MutationExprNode,
  state: ValidationState,
): void {
  switch (mutation.type) {
    case "GraftBranchExpr":
    case "PruneBranchExpr":
      validateIdentifier(mutation.subject.name, mutation.subject.span, state);
      validateIdentifier(mutation.object.name, mutation.object.span, state);
      return;

    case "GraftProgressExpr":
      validateIdentifier(mutation.from.name, mutation.from.span, state);
      validateIdentifier(mutation.to.name, mutation.to.span, state);
      return;

    case "GraftStateExpr":
    case "GraftMetaExpr":
    case "PruneStateExpr":
    case "PruneMetaExpr":
      validateIdentifier(mutation.node.name, mutation.node.span, state);
      return;

    case "PruneNodesExpr":
    case "PruneEdgesExpr":
      return;

    default:
      return;
  }
}

function validateGraphPipelineStep(
  step: GraphPipelineStepNode,
  state: ValidationState,
): void {
  if (step.type === "IfExpr") {
    validateIfExpr(step, state);
    return;
  }

  if (step.type === "WhenExpr") {
    validateWhenExpr(step, state);
    return;
  }

  validateMutation(step, state);
}

function validateActionPipelineStep(
  step: ActionPipelineStepNode,
  state: ValidationState,
): void {
  if (step.type === "LoopExpr") {
    validateLoopExpr(step, state);
    return;
  }

  if (step.type === "WhenExpr") {
    pushIssue(state, "error", step.span, "@when is not supported inside @action pipelines");
    return;
  }

  validateGraphPipelineStep(step, state);
}

function validateIfExpr(expr: IfExprNode, state: ValidationState): void {
  if (!expr.condition) {
    pushIssue(state, "error", expr.span, "@if requires a condition");
  } else {
    validateGraphControlExpr(expr.condition, state, "@if condition");
  }

  if (!expr.then.length) {
    pushIssue(state, "error", expr.span, "@if requires a then pipeline");
  }

  for (const step of expr.then) {
    validateGraphPipelineStep(step, state);
  }

  for (const step of expr.else ?? []) {
    validateGraphPipelineStep(step, state);
  }
}

function validateLoopExpr(loop: LoopExprNode, state: ValidationState): void {
  if (!loop.pipeline.length) {
    pushIssue(state, "error", loop.span, "@loop requires a pipeline section");
  }

  if (!loop.until && !loop.count) {
    pushIssue(
      state,
      "error",
      loop.span,
      "@loop requires at least one of count or until",
    );
  }

  if (loop.until) {
    validateGraphQueryExpr(loop.until, state);
  }

  if (loop.count) {
    validateLoopCountExpr(loop.count, state);
  }

  for (const step of loop.pipeline) {
    validateActionPipelineStep(step, state);
  }
}

function validateLoopCountExpr(
  expr: LoopCountExprNode,
  state: ValidationState,
): void {
  if (expr.type === "NumberLiteral") {
    if (!Number.isInteger(expr.value)) {
      pushIssue(state, "error", expr.span, "@loop count must be an integer");
    }

    if (expr.value < 0) {
      pushIssue(state, "error", expr.span, "@loop count cannot be negative");
    }
    return;
  }

  if (expr.type === "DeriveStateExpr") {
    validateDeriveStateExpr(expr, state);
    return;
  }

  validateDeriveMetaExpr(expr, state);
}

function validateGraphControlExpr(
  expr: GraphControlExprNode,
  state: ValidationState,
  _label: string,
): void {
  if (expr.type === "BooleanLiteral") {
    return;
  }

  validateGraphQueryExpr(expr, state);
}

function validateGraphQueryExpr(
  expr: GraphQueryExprNode,
  state: ValidationState,
): void {
  const usesEdgeMode =
    expr.subject !== null || expr.relation !== null || expr.object !== null;
  const usesStateMode = expr.state !== null;
  const usesMetaMode = expr.meta !== null;
  const modeCount =
    Number(usesEdgeMode) + Number(usesStateMode) + Number(usesMetaMode);

  if (modeCount !== 1) {
    pushIssue(
      state,
      "error",
      expr.span,
      "@query must use exactly one mode: edge existence, state query, or meta query",
    );
  }

  if (usesEdgeMode) {
    if (!expr.subject || !expr.relation || !expr.object) {
      pushIssue(
        state,
        "error",
        expr.span,
        "@query edge existence requires subject, relation, and object",
      );
    }

    if (expr.equals) {
      pushIssue(
        state,
        "error",
        expr.equals.span,
        '@query edge existence does not support an "equals" field',
      );
    }

    if (expr.subject)
      validateIdentifier(expr.subject.name, expr.subject.span, state);
    if (expr.object)
      validateIdentifier(expr.object.name, expr.object.span, state);
  }

  if (usesStateMode || usesMetaMode) {
    if (!expr.node) {
      pushIssue(
        state,
        "error",
        expr.span,
        '@query state/meta mode requires a "node" field',
      );
    } else {
      validateIdentifier(expr.node.name, expr.node.span, state);
    }
  }

  if (usesStateMode) {
    if (!expr.state) {
      pushIssue(
        state,
        "error",
        expr.span,
        '@query state mode requires a "state" field',
      );
    }

    if (expr.meta) {
      pushIssue(
        state,
        "error",
        expr.span,
        '@query cannot combine "state" and "meta" fields',
      );
    }
  }

  if (usesMetaMode && !expr.meta) {
    pushIssue(
      state,
      "error",
      expr.span,
      '@query meta mode requires a "meta" field',
    );
  }

  if (expr.equals) {
    validateActionExpression(expr.equals, state);
  }
}

function validateDeriveStateExpr(
  expr: DeriveStateExprNode,
  state: ValidationState,
): void {
  if (!expr.node) {
    pushIssue(state, "error", expr.span, "@derive.state requires a node field");
  } else {
    validateIdentifier(expr.node.name, expr.node.span, state);
  }

  if (!expr.key) {
    pushIssue(state, "error", expr.span, "@derive.state requires a key field");
  }
}

function validateDeriveMetaExpr(
  expr: DeriveMetaExprNode,
  state: ValidationState,
): void {
  if (!expr.node) {
    pushIssue(state, "error", expr.span, "@derive.meta requires a node field");
  } else {
    validateIdentifier(expr.node.name, expr.node.span, state);
  }

  if (!expr.key) {
    pushIssue(state, "error", expr.span, "@derive.meta requires a key field");
  }
}

function validateDeriveExpr(
  expr: DeriveExprNode,
  state: ValidationState,
): void {
  if (expr.type !== "DeriveBinaryExpr") {
    return;
  }

  validateDeriveExpr(expr.left, state);
  validateDeriveExpr(expr.right, state);
}

function validateActionExpression(expr: any, state: ValidationState): void {
  if (!expr || typeof expr !== "object") return;

  switch (expr.type) {
    case "Identifier":
      validateIdentifier(expr.name, expr.span, state);
      return;

    case "PropertyAccess":
      validateIdentifier(expr.object.name, expr.object.span, state);
      return;

    case "BinaryBooleanExpr":
      validateActionExpression(expr.left, state);
      validateActionExpression(expr.right, state);
      return;

    case "UnaryBooleanExpr":
      validateActionExpression(expr.argument, state);
      return;

    case "ComparisonExpr":
      validateActionExpression(expr.left, state);
      validateActionExpression(expr.right, state);
      return;

    case "ObjectLiteral":
      for (const prop of expr.properties) {
        validateActionExpression(prop.value, state);
      }
      return;

    case "ArrayLiteral":
      for (const el of expr.elements) {
        validateActionExpression(el, state);
      }
      return;

    default:
      return;
  }
}

function validateIdentifier(
  name: string,
  span: any,
  state: ValidationState,
): void {
  if (name === "from" || name === "to") {
    return;
  }

  if (
    state.nodeBindings.has(name) ||
    state.valueBindings.has(name) ||
    state.actionBindings.has(name)
  ) {
    return;
  }

  pushIssue(
    state,
    "warning",
    span,
    `Unknown identifier "${name}" inside @action`,
  );
}

function ensureKnownAction(
  state: ValidationState,
  name: string,
  span?: { line: number; column: number },
): void {
  if (!state.actionBindings.has(name)) {
    pushIssue(
      state,
      "error",
      span,
      `Traversal operator "${name}" is not a declared action`,
    );
  }
}

function isTopLevelNameTaken(name: string, state: ValidationState): boolean {
  return (
    state.valueBindings.has(name) ||
    state.operatorBindings.has(name) ||
    state.graphBindings.has(name)
  );
}

function pushIssue(
  state: ValidationState,
  severity: "error" | "warning",
  span: any,
  message: string,
): void {
  state.issues.push({
    severity,
    message,
    span,
  });
}

function validateStatementAfterTerminalProject(
  statementType: "BindStatement",
  state: ValidationState,
): void {
  if (!state.terminalProjectReached) {
    return;
  }

  pushIssue(
    state,
    "error",
    undefined,
    `${statementType} cannot appear after terminal @project(...)`,
  );
}
