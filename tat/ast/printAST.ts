import type {
  ActionExprNode,
  ActionGuardExprNode,
  ActionProjectExprNode,
  ArgumentNode,
  ArrayLiteralNode,
  BindStatementNode,
  BinaryBooleanExprNode,
  BooleanExprNode,
  BooleanLiteralNode,
  ComparisonExprNode,
  ComposeExprNode,
  CurrentValueNode,
  CtxExprNode,
  DeriveMetaExprNode,
  DeriveStateExprNode,
  DeriveBinaryExprNode,
  DeriveExprNode,
  EdgeExprNode,
  EffectBlockNode,
  EffectOpNode,
  ExportDeclarationNode,
  GraphControlExprNode,
  GraphInteractionDefinitionNode,
  GraphPipelineNode,
  GraphPipelineStepNode,
  GraphQueryExprNode,
  GraphRefNode,
  GroupedBooleanExprNode,
  HowExprNode,
  IdentifierNode,
  IfExprNode,
  ImportDeclarationNode,
  MatchExprNode,
  MutationExprNode,
  NodeCaptureNode,
  NumberLiteralNode,
  ObjectLiteralNode,
  ObjectPropertyNode,
  OperatorBindingNode,
  PathExprNode,
  ProgramNode,
  ProjectExprNode,
  PropertyAccessNode,
  PreviousValueNode,
  PruneEdgesExprNode,
  PruneNodesExprNode,
  QueryStatementNode,
  RegexLiteralNode,
  RelationPatternNode,
  RootTargetNode,
  SeedBlockNode,
  SeedEdgeBindingNode,
  SeedEdgeEntryNode,
  StringLiteralNode,
  SystemRelationNode,
  TraversalExprNode,
  UnaryBooleanExprNode,
  ValueBindingNode,
  ValueExprNode,
  WhenExprNode,
  WhereExprNode,
  WhyExprNode,
  WildcardNode,
  StatementNode,
  WherePredicateNode,
  LoopExprNode,
} from "./nodeTypes";

type PrintableNode =
  | ProgramNode
  | StatementNode
  | ImportDeclarationNode
  | ExportDeclarationNode
  | ActionExprNode
  | ComposeExprNode
  | GraphRefNode
  | EffectBlockNode
  | GraphInteractionDefinitionNode
  | WhenExprNode
  | CtxExprNode
  | ProjectExprNode
  | WherePredicateNode
  | NodeCaptureNode
  | TraversalExprNode
  | ObjectLiteralNode
  | ArrayLiteralNode
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | CurrentValueNode
  | PreviousValueNode
  | DeriveStateExprNode
  | DeriveMetaExprNode
  | RegexLiteralNode
  | WildcardNode
  | MatchExprNode
  | PathExprNode
  | WhyExprNode
  | HowExprNode
  | WhereExprNode
  | GraphQueryExprNode
  | RelationPatternNode
  | EdgeExprNode
  | BinaryBooleanExprNode
  | UnaryBooleanExprNode
  | GroupedBooleanExprNode
  | ComparisonExprNode
  | DeriveBinaryExprNode
  | PropertyAccessNode
  | MutationExprNode
  | EffectOpNode
  | LoopExprNode
  | IfExprNode
  | PruneNodesExprNode
  | PruneEdgesExprNode
  | RootTargetNode;

export function printAST(program: ProgramNode): string {
  const lines: string[] = [];
  visit(program, 0, lines);
  return lines.join("\n");
}

function visit(node: PrintableNode, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);

  switch (node.type) {
    case "Program":
      lines.push(`${pad}Program`);
      for (const statement of node.body) {
        visit(statement, indent + 1, lines);
      }
      return;

    case "ValueBinding":
      printValueBinding(node, indent, lines);
      return;

    case "BindStatement":
      printBindStatement(node, indent, lines);
      return;

    case "ImportDeclaration":
      lines.push(`${pad}${printImportInline(node)}`);
      return;

    case "ExportDeclaration":
      lines.push(`${pad}${printExportInline(node)}`);
      return;

    case "OperatorBinding":
      printOperatorBinding(node, indent, lines);
      return;

    case "SeedBlock":
      printSeedBlock(node, indent, lines);
      return;

    case "GraphPipeline":
      printGraphPipeline(node, indent, lines);
      return;

    case "GraphInteractionDefinition":
      printGraphInteractionDefinition(node, indent, lines);
      return;

    case "WhenExpr":
      printWhenExpr(node, indent, lines);
      return;

    case "SystemRelation":
      printSystemRelation(node, indent, lines);
      return;

    case "QueryStatement":
      printQueryStatement(node, indent, lines);
      return;

    case "ActionExpr":
      printActionExpr(node, indent, lines);
      return;

    case "CtxExpr":
      printCtxExpr(node, indent, lines);
      return;

    case "ProjectExpr":
      printProjectExpr(node, indent, lines);
      return;

    case "ComposeExpr":
      lines.push(`${pad}${printComposeInline(node)}`);
      return;

    case "GraphRef":
      lines.push(`${pad}${printGraphRefInline(node)}`);
      return;

    case "EffectBlock":
      printEffectBlock(node, indent, lines);
      return;

    case "WherePredicate":
      lines.push(`${pad}${printWherePredicateInline(node)}`);
      return;

    case "NodeCapture":
      lines.push(`${pad}${printNodeCaptureInline(node)}`);
      return;

    case "TraversalExpr":
      lines.push(`${pad}${printTraversalInline(node)}`);
      return;

    case "ObjectLiteral":
      lines.push(`${pad}${printObjectLiteralInline(node)}`);
      return;

    case "ArrayLiteral":
      lines.push(`${pad}${printArrayLiteralInline(node)}`);
      return;

    case "Identifier":
      lines.push(`${pad}${node.name}`);
      return;

    case "StringLiteral":
      lines.push(`${pad}${node.raw}`);
      return;

    case "NumberLiteral":
      lines.push(`${pad}${node.raw}`);
      return;

    case "BooleanLiteral":
      lines.push(`${pad}${node.raw}`);
      return;

    case "CurrentValue":
      lines.push(`${pad}${node.name}`);
      return;

    case "PreviousValue":
      lines.push(`${pad}${node.name}`);
      return;

    case "DeriveStateExpr":
    case "DeriveMetaExpr":
      lines.push(`${pad}${printLoopCountInline(node)}`);
      return;

    case "RegexLiteral":
      lines.push(`${pad}${node.raw}`);
      return;

    case "Wildcard":
      lines.push(`${pad}_`);
      return;

    case "MatchExpr":
      printMatchExpr(node, indent, lines);
      return;

    case "PathExpr":
      printPathExpr(node, indent, lines);
      return;

    case "WhyExpr":
      printWhyExpr(node, indent, lines);
      return;

    case "HowExpr":
      printHowExpr(node, indent, lines);
      return;

    case "WhereExpr":
      printWhereExpr(node, indent, lines);
      return;

    case "GraphQueryExpr":
      lines.push(`${pad}${printGraphQueryInline(node)}`);
      return;

    case "RelationPattern":
      lines.push(`${pad}${printRelationPatternInline(node)}`);
      return;

    case "EdgeExpr":
      lines.push(`${pad}${printEdgeExprInline(node)}`);
      return;

    case "BinaryBooleanExpr":
    case "UnaryBooleanExpr":
    case "GroupedBooleanExpr":
    case "ComparisonExpr":
      lines.push(`${pad}${printBooleanExprInline(node)}`);
      return;

    case "DeriveBinaryExpr":
      lines.push(`${pad}${printDeriveExprInline(node)}`);
      return;

    case "PropertyAccess":
      lines.push(`${pad}${printPropertyAccessInline(node)}`);
      return;

    case "GraftBranchExpr":
    case "GraftStateExpr":
    case "GraftMetaExpr":
    case "GraftProgressExpr":
    case "PruneBranchExpr":
    case "PruneStateExpr":
    case "PruneMetaExpr":
    case "PruneNodesExpr":
    case "PruneEdgesExpr":
    case "LoopExpr":
    case "IfExpr":
      lines.push(`${pad}${printMutationInline(node)}`);
      return;
    case "WhenExpr":
      lines.push(`${pad}${printMutationInline(node)}`);
      return;

    case "EffectGraftStateOp":
    case "EffectGraftMetaOp":
    case "EffectPruneStateOp":
    case "EffectPruneMetaOp":
    case "EffectDeriveStateOp":
    case "EffectDeriveMetaOp":
      lines.push(`${pad}${printEffectOpInline(node)}`);
      return;

    case "RootTarget":
      lines.push(`${pad}${node.name}`);
      return;
  }
}

function printValueBinding(
  node: ValueBindingNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}ValueBinding ${node.name.name}`);
  visit(node.value, indent + 1, lines);
}

function printBindStatement(
  node: BindStatementNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  const parts = ["@bind"];

  if (node.layer) {
    parts.push(node.layer);
  }

  if (node.entity) {
    parts.push(node.entity);
  }

  lines.push(`${pad}BindStatement ${parts.join(".")} ${node.name.name}`);
  visit(node.expression, indent + 1, lines);
}

function printOperatorBinding(
  node: OperatorBindingNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}OperatorBinding ${node.name.name}`);
  visit(node.value, indent + 1, lines);
}

function printSeedBlock(
  node: SeedBlockNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}SeedBlock @seed`);

  lines.push(`${pad}  nodes`);
  for (const nodeRef of node.nodes) {
    lines.push(`${pad}    ${nodeRef.ref.name}`);
  }

  lines.push(`${pad}  edges`);
  for (const edge of node.edges) {
    lines.push(`${pad}    ${printSeedEdgeEntryInline(edge)}`);
  }

  lines.push(`${pad}  state ${printObjectLiteralInline(node.state)}`);
  lines.push(`${pad}  meta ${printObjectLiteralInline(node.meta)}`);
  lines.push(`${pad}  root ${node.root.name}`);
}

function printGraphPipeline(
  node: GraphPipelineNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}GraphPipeline ${node.name.name}`);
  if (node.source.type === "SeedSource") {
    lines.push(`${pad}  source ${node.source.name}`);
  } else {
    lines.push(`${pad}  source ${printComposeInline(node.source)}`);
  }

  lines.push(`${pad}  mutations`);
  if (node.mutations.length === 0) {
    lines.push(`${pad}    (none)`);
  } else {
    for (const mutation of node.mutations) {
      lines.push(`${pad}    ${printMutationInline(mutation)}`);
    }
  }

  if (node.projection) {
    lines.push(`${pad}  projection ${printProjectExprInline(node.projection)}`);
  }
}

function printGraphInteractionDefinition(
  node: GraphInteractionDefinitionNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  const suffix = node.name ? ` ${node.name.name}` : "";
  lines.push(`${pad}GraphInteractionDefinition${suffix}`);
  lines.push(
    `${pad}  ${printGraphRefInline(node.subject)} : ${node.relation.raw} : ${printGraphRefInline(node.object)}`,
  );
  printEffectBlock(node.effect, indent + 1, lines);
}

function printWhenExpr(
  node: WhenExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}@when`);
  lines.push(
    `${pad}  event ${node.event ? printGraphControlExprInline(node.event) : "(missing)"}`,
  );
  lines.push(`${pad}  pipeline`);

  if (node.pipeline.length === 0) {
    lines.push(`${pad}    (none)`);
    return;
  }

  for (const step of node.pipeline) {
    lines.push(`${pad}    ${printMutationInline(step)}`);
  }
}

function printEffectBlock(
  node: EffectBlockNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}EffectBlock ${node.name}`);
  lines.push(`${pad}  target ${printEffectTargetInline(node.target)}`);
  lines.push(`${pad}  ops`);
  for (const op of node.ops) {
    lines.push(`${pad}    ${printEffectOpInline(op)}`);
  }
}

function printSystemRelation(
  node: SystemRelationNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  if (node.relation) {
    lines.push(
      `${pad}SystemRelation ${node.left.name} : ${node.relation.raw} ::: ${node.right.name}`,
    );
  } else {
    lines.push(`${pad}SystemRelation ${node.left.name} ::: ${node.right.name}`);
  }
}

function printQueryStatement(
  node: QueryStatementNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}QueryStatement`);
  visit(node.expr, indent + 1, lines);
}

function printActionExpr(
  node: ActionExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}@action`);

  if (node.guard) {
    lines.push(`${pad}  guard`);
    lines.push(`${pad}    ${printActionGuardInline(node.guard)}`);
  }

  lines.push(`${pad}  pipeline`);
  if (node.pipeline.length === 0) {
    lines.push(`${pad}    (none)`);
  } else {
    for (const step of node.pipeline) {
      lines.push(`${pad}    ${printMutationInline(step)}`);
    }
  }

  if (node.project) {
    lines.push(`${pad}  project`);
    lines.push(`${pad}    ${printActionProjectExprInline(node.project)}`);
  }
}

function printCtxExpr(
  node: CtxExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}${printCtxExprInline(node)}`);
}

function printProjectExpr(
  node: ProjectExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}${printProjectExprInline(node)}`);
}

function printImportInline(node: ImportDeclarationNode): string {
  const specs = node.specifiers.map((spec) =>
    spec.imported.name === spec.local.name
      ? spec.imported.name
      : `${spec.imported.name} as ${spec.local.name}`,
  );
  return `import { ${specs.join(", ")} } from ${node.source.raw}`;
}

function printExportInline(node: ExportDeclarationNode): string {
  return `export { ${node.specifiers.map((spec) => spec.local.name).join(", ")} }`;
}

function printComposeInline(node: ComposeExprNode): string {
  return `@compose([${node.assets.map((asset) => asset.name).join(", ")}], merge: ${node.merge.name})`;
}

function printGraphRefInline(node: GraphRefNode): string {
  return `${node.name}(${node.graphId.name})`;
}

function printWherePredicateInline(node: WherePredicateNode): string {
  return `@where(${printBooleanExprInline(node.expression)})`;
}

function printMatchExpr(
  node: MatchExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}MatchExpr`);
  for (const pattern of node.patterns) {
    lines.push(`${pad}  ${printRelationPatternInline(pattern)}`);
  }
  if (node.where) {
    lines.push(`${pad}  where ${printBooleanExprInline(node.where)}`);
  }
}

function printPathExpr(
  node: PathExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  let line = `${pad}PathExpr ${printValueExprInline(node.from)} -> ${printValueExprInline(node.to)}`;
  if (node.where) {
    line += ` where ${printBooleanExprInline(node.where)}`;
  }
  lines.push(line);
}

function printWhyExpr(
  node: WhyExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}WhyExpr ${printWhyTargetInline(node.target)}`);
}

function printHowExpr(
  node: HowExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  if (node.target.type === "Identifier") {
    lines.push(`${pad}HowExpr ${node.target.name}`);
    return;
  }
  lines.push(`${pad}HowExpr ${printNodeCaptureInline(node.target)}`);
}

function printWhereExpr(
  node: WhereExprNode,
  indent: number,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  lines.push(`${pad}WhereExpr ${printBooleanExprInline(node.expression)}`);
}

function printActionGuardInline(node: ActionGuardExprNode): string {
  if (node.type === "GraphQueryExpr") {
    return printGraphQueryInline(node);
  }

  return printBooleanExprInline(node);
}

function printGraphQueryInline(node: GraphQueryExprNode): string {
  const fields: string[] = [];

  if (node.subject) fields.push(`subject: ${node.subject.name}`);
  if (node.relation) fields.push(`relation: ${node.relation.raw}`);
  if (node.object) fields.push(`object: ${node.object.name}`);
  if (node.node) fields.push(`node: ${node.node.name}`);
  if (node.state) fields.push(`state: ${node.state.raw}`);
  if (node.meta) fields.push(`meta: ${node.meta.raw}`);
  if (node.equals) fields.push(`equals: ${printValueExprInline(node.equals)}`);

  return `@query { ${fields.join(", ")} }`;
}

function printGraphControlExprInline(node: GraphControlExprNode): string {
  if (node.type === "GraphQueryExpr") {
    return printGraphQueryInline(node);
  }

  return node.raw;
}

function printWhyTargetInline(target: WhyExprNode["target"]): string {
  switch (target.type) {
    case "Identifier":
      return target.name;
    case "EdgeExpr":
      return printEdgeExprInline(target);
    case "MatchExpr":
      return `@match(${target.patterns.map(printRelationPatternInline).join(", ")})`;
    case "PathExpr":
      return `@path(${printValueExprInline(target.from)}, ${printValueExprInline(target.to)})`;
  }
}

function printRelationPatternInline(node: RelationPatternNode): string {
  return `${printPatternAtomInline(node.left)} : ${printPatternAtomInline(node.relation)} : ${printPatternAtomInline(node.right)}`;
}

function printPatternAtomInline(
  node:
    | IdentifierNode
    | StringLiteralNode
    | NumberLiteralNode
    | BooleanLiteralNode
    | RegexLiteralNode
    | WildcardNode
    | NodeCaptureNode,
): string {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "RegexLiteral":
      return node.raw;
    case "Wildcard":
      return "_";
    case "NodeCapture":
      return printNodeCaptureInline(node);
  }
}

function printEdgeExprInline(node: EdgeExprNode): string {
  return `${node.left.name} : ${node.relation.raw} : ${node.right.name}`;
}

function printCtxExprInline(node: CtxExprNode): string {
  return `@ctx(${node.args.map(printArgumentInline).join(", ")})`;
}

function printProjectExprInline(node: ProjectExprNode): string {
  if (node.syntax === "block") {
    return `@project { ${node.args.map(printArgumentInline).join(" ")} }`;
  }
  return `@project(${node.args.map(printArgumentInline).join(", ")})`;
}

function printArgumentInline(arg: ArgumentNode): string {
  if (arg.key) {
    return `${arg.key.name}: ${printValueExprInline(arg.value)}`;
  }
  return printValueExprInline(arg.value);
}

function printNodeCaptureInline(node: NodeCaptureNode): string {
  return `<${printNodeShapeInline(node.shape)}>`;
}

function printNodeShapeInline(node: NodeCaptureNode["shape"]): string {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "ObjectLiteral":
      return printObjectLiteralInline(node);
    case "TraversalExpr":
      return printTraversalInline(node);
  }
}

function printTraversalInline(node: TraversalExprNode): string {
  const parts: string[] = [];

  for (const segment of node.segments) {
    if (segment.type === "ActionSegment") {
      parts.push(
        `${printValueExprInline(segment.from)}.${segment.operator.name}.${printValueExprInline(segment.to)}`,
      );
    } else {
      parts.push(
        `..${segment.context.name}..${printValueExprInline(segment.segment.from)}.${segment.segment.operator.name}.${printValueExprInline(segment.segment.to)}`,
      );
    }
  }

  return parts.join("");
}

function printValueExprInline(node: ValueExprNode): string {
  switch (node.type) {
    case "WhereExpr":
      return `@where(${printBooleanExprInline(node.expression)})`;
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "NodeCapture":
      return printNodeCaptureInline(node);
    case "ObjectLiteral":
      return printObjectLiteralInline(node);
    case "ArrayLiteral":
      return printArrayLiteralInline(node);
  }
}

function printDeriveExprInline(node: DeriveExprNode): string {
  switch (node.type) {
    case "CurrentValue":
      return node.name;
    case "PreviousValue":
      return node.name;
    case "NumberLiteral":
      return node.raw;
    case "StringLiteral":
      return node.raw;
    case "DeriveBinaryExpr":
      return `${printDeriveExprInline(node.left)} ${node.operator} ${printDeriveExprInline(node.right)}`;
  }
}

function printActionProjectExprInline(node: ActionProjectExprNode): string {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "NodeCapture":
      return printNodeCaptureInline(node);
    case "ObjectLiteral":
      return printObjectLiteralInline(node);
    case "ArrayLiteral":
      return printArrayLiteralInline(node);
  }
}

function printLoopCountInline(
  node: LoopExprNode["count"] | DeriveStateExprNode | DeriveMetaExprNode,
): string {
  if (!node) {
    return "(none)";
  }

  if (node.type === "NumberLiteral") {
    return node.raw;
  }

  return `${node.name} { node: ${node.node?.name ?? "?"}, key: ${node.key?.raw ?? "?"} }`;
}

function printObjectLiteralInline(node: ObjectLiteralNode): string {
  return `{${node.properties.map(printObjectPropertyInline).join(", ")}}`;
}

function printObjectPropertyInline(node: ObjectPropertyNode): string {
  return `${node.key}: ${printValueExprInline(node.value)}`;
}

function printArrayLiteralInline(node: ArrayLiteralNode): string {
  return `[${node.elements.map(printValueExprInline).join(", ")}]`;
}

function printBooleanExprInline(node: BooleanExprNode): string {
  switch (node.type) {
    case "BinaryBooleanExpr":
      return `${printBooleanExprInline(node.left)} ${node.operator} ${printBooleanExprInline(node.right)}`;
    case "UnaryBooleanExpr":
      return `${node.operator}${printBooleanExprInline(node.argument)}`;
    case "GroupedBooleanExpr":
      return `(${printBooleanExprInline(node.expression)})`;
    case "ComparisonExpr":
      return `${printBooleanValueInline(node.left)} ${node.operator} ${printBooleanValueInline(node.right)}`;
    case "PropertyAccess":
      return printPropertyAccessInline(node);
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "RegexLiteral":
      return node.raw;
  }
}

function printBooleanValueInline(
  node:
    | IdentifierNode
    | PropertyAccessNode
    | StringLiteralNode
    | NumberLiteralNode
    | BooleanLiteralNode
    | RegexLiteralNode,
): string {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "PropertyAccess":
      return printPropertyAccessInline(node);
    case "StringLiteral":
      return node.raw;
    case "NumberLiteral":
      return node.raw;
    case "BooleanLiteral":
      return node.raw;
    case "RegexLiteral":
      return node.raw;
  }
}

function printPropertyAccessInline(node: PropertyAccessNode): string {
  return `${node.object.name}.${node.chain.map((part) => part.name).join(".")}`;
}

function printEffectTargetInline(node: EffectBlockNode["target"]): string {
  if (node.type === "RootTarget") {
    return node.name;
  }

  return node.name;
}

function printMutationInline(
  node: LoopExprNode | IfExprNode | GraphPipelineStepNode | MutationExprNode,
): string {
  switch (node.type) {
    case "GraftBranchExpr":
      return `@graft.branch(${node.subject.name}, ${node.relation.raw}, ${node.object.name})`;
    case "GraftStateExpr":
      return `@graft.state(${node.node.name}, ${node.key.raw}, ${printValueExprInline(node.value)})`;
    case "GraftMetaExpr":
      return `@graft.meta(${node.node.name}, ${node.key.raw}, ${printValueExprInline(node.value)})`;
    case "GraftProgressExpr":
      return `@graft.progress(${node.from.name}, ${node.relation.raw}, ${node.to.name})`;
    case "PruneBranchExpr":
      return `@prune.branch(${node.subject.name}, ${node.relation.raw}, ${node.object.name})`;
    case "PruneStateExpr":
      return `@prune.state(${node.node.name}, ${node.key.raw})`;
    case "PruneMetaExpr":
      return `@prune.meta(${node.node.name}, ${node.key.raw})`;
    case "PruneNodesExpr":
      return `@prune.nodes(${printWherePredicateInline(node.where)})`;
    case "PruneEdgesExpr":
      return `@prune.edges(${printWherePredicateInline(node.where)})`;
    case "CtxSetExpr":
      return `@ctx.set(${node.edge.name}, ${printValueExprInline(node.context)})`;
    case "CtxClearExpr":
      return `@ctx.clear(${node.edge.name})`;
    case "ApplyExpr":
      if (node.target.type === "Identifier") {
        return `@apply(${node.target.name})`;
      }
      return `@apply(${printNodeCaptureInline(node.target)})`;
    case "IfExpr": {
      const sections = [
        `condition: ${node.condition ? printGraphControlExprInline(node.condition) : "(missing)"}`,
        `then: ${node.then.map(printMutationInline).join(" -> ") || "(none)"}`,
      ];

      if (node.else) {
        sections.push(
          `else: ${node.else.map(printMutationInline).join(" -> ") || "(none)"}`,
        );
      }

      return `@if { ${sections.join(", ")} }`;
    }
    case "LoopExpr": {
      const sections = [
        `pipeline: ${node.pipeline.map(printMutationInline).join(" -> ")}`,
      ];
      if (node.until) {
        sections.unshift(`until: ${printGraphQueryInline(node.until)}`);
      }
      if (node.count) {
        sections.unshift(`count: ${printLoopCountInline(node.count)}`);
      }
      return `@loop { ${sections.join(", ")} }`;
    }
    case "WhenExpr": {
      const sections = [
        `event: ${node.event ? printGraphControlExprInline(node.event) : "(missing)"}`,
        `pipeline: ${node.pipeline.map(printMutationInline).join(" -> ") || "(none)"}`,
      ];

      return `@when { ${sections.join(", ")} }`;
    }
  }
}

function printEffectOpInline(node: EffectOpNode): string {
  switch (node.type) {
    case "EffectGraftStateOp":
      return `@graft.state(${node.key.raw}, ${printValueExprInline(node.value)})`;
    case "EffectGraftMetaOp":
      return `@graft.meta(${node.key.raw}, ${printValueExprInline(node.value)})`;
    case "EffectPruneStateOp":
      return `@prune.state(${node.key.raw})`;
    case "EffectPruneMetaOp":
      return `@prune.meta(${node.key.raw})`;
    case "EffectDeriveStateOp":
      return `@derive.state(${node.key.raw}, ${printDeriveExprInline(node.expression)})`;
    case "EffectDeriveMetaOp":
      return `@derive.meta(${node.key.raw}, ${printDeriveExprInline(node.expression)})`;
  }
}

function printSeedEdgeEntryInline(node: SeedEdgeEntryNode): string {
  if (node.type === "SeedEdgeBinding") {
    return `${node.name.name} := [${printEdgeExprInline(node.edge)}]`;
  }
  return printEdgeExprInline(node);
}
