export type Primitive = string | number | boolean;

export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface BaseNode {
  type: string;
  span?: SourceSpan;
}

/* =========================
   Program
   ========================= */

export interface ProgramNode extends BaseNode {
  type: "Program";
  body: StatementNode[];
}

/* =========================
   Statements
   ========================= */

export type StatementNode =
  | ImportDeclarationNode
  | ExportDeclarationNode
  | BindStatementNode
  | ValueBindingNode
  | OperatorBindingNode
  | SeedBlockNode
  | GraphPipelineNode
  | GraphProjectionNode
  | WhenExprNode
  | GraphInteractionDefinitionNode
  | SystemRelationNode
  | QueryStatementNode;

export interface ImportDeclarationNode extends BaseNode {
  type: "ImportDeclaration";
  specifiers: ImportSpecifierNode[];
  source: StringLiteralNode;
}

export interface ImportSpecifierNode extends BaseNode {
  type: "ImportSpecifier";
  imported: IdentifierNode;
  local: IdentifierNode;
}

export interface ExportDeclarationNode extends BaseNode {
  type: "ExportDeclaration";
  specifiers: ExportSpecifierNode[];
}

export interface ExportSpecifierNode extends BaseNode {
  type: "ExportSpecifier";
  local: IdentifierNode;
}

export type BindLayer = "ctx" | "state" | "meta";

export type BindEntity = "node" | "edge";

export interface BindStatementNode extends BaseNode {
  type: "BindStatement";
  layer: BindLayer | null;
  entity: BindEntity | null;
  name: IdentifierNode;
  expression: ValueExprNode;
}

export interface ValueBindingNode extends BaseNode {
  type: "ValueBinding";
  name: IdentifierNode;
  value: ValueExprNode;
}

export interface OperatorBindingNode extends BaseNode {
  type: "OperatorBinding";
  name: IdentifierNode;
  value: OperatorExprNode;
}

export interface SeedBlockNode extends BaseNode {
  type: "SeedBlock";
  nodes: SeedNodeRefNode[];
  edges: SeedEdgeEntryNode[];
  state: ObjectLiteralNode;
  meta: ObjectLiteralNode;
  root: IdentifierNode;
}

export interface GraphPipelineNode extends BaseNode {
  type: "GraphPipeline";
  name: IdentifierNode;
  source: GraphSourceNode;
  mutations: GraphPipelineStepNode[];
  projection: ProjectExprNode | null;
}

// Projects an already-built graph binding into a named view.
// Syntax: battleGraph = battle <> @project(format: "graph")
export interface GraphProjectionNode extends BaseNode {
  type: "GraphProjection";
  name: IdentifierNode;
  source: IdentifierNode;
  projection: ProjectExprNode;
}

export type GraphSourceNode = SeedSourceNode | ComposeExprNode;

export interface GraphInteractionDefinitionNode extends BaseNode {
  type: "GraphInteractionDefinition";
  name: IdentifierNode | null;
  subject: GraphRefNode;
  relation: StringLiteralNode;
  object: GraphRefNode;
  effect: EffectBlockNode;
}

export interface SystemRelationNode extends BaseNode {
  type: "SystemRelation";
  left: IdentifierNode;
  relation: StringLiteralNode | null;
  right: IdentifierNode;
}

export interface QueryStatementNode extends BaseNode {
  type: "QueryStatement";
  expr: QueryExprNode;
}

export interface WhenExprNode extends BaseNode {
  type: "WhenExpr";
  name: "@when";
  event: GraphControlExprNode | null;
  pipeline: GraphPipelineStepNode[];
}

/* =========================
   Core Expressions
   ========================= */

export type ValueExprNode =
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NodeCaptureNode
  | WhereExprNode
  | ObjectLiteralNode
  | ArrayLiteralNode;

export type ActionProjectExprNode =
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NodeCaptureNode
  | ObjectLiteralNode
  | ArrayLiteralNode;

export type OperatorExprNode = ActionExprNode | CtxExprNode | ProjectExprNode;

export interface IdentifierNode extends BaseNode {
  type: "Identifier";
  name: string;
}

export interface StringLiteralNode extends BaseNode {
  type: "StringLiteral";
  value: string;
  raw: string;
}

export interface NumberLiteralNode extends BaseNode {
  type: "NumberLiteral";
  value: number;
  raw: string;
}

export interface BooleanLiteralNode extends BaseNode {
  type: "BooleanLiteral";
  value: boolean;
  raw: string;
}

export interface RegexLiteralNode extends BaseNode {
  type: "RegexLiteral";
  pattern: string;
  flags: string;
  raw: string;
}

export interface WildcardNode extends BaseNode {
  type: "Wildcard";
  raw: "_";
}

/* =========================
   Node Capture
   ========================= */

export interface NodeCaptureNode extends BaseNode {
  type: "NodeCapture";
  shape: NodeShapeNode;
}

export type NodeShapeNode =
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | ObjectLiteralNode
  | TraversalExprNode;

/* =========================
   Traversal
   ========================= */

export interface TraversalExprNode extends BaseNode {
  type: "TraversalExpr";
  segments: TraversalSegmentNode[];
}

export type TraversalSegmentNode = ActionSegmentNode | ContextLiftNode;

export interface ActionSegmentNode extends BaseNode {
  type: "ActionSegment";
  from: ValueExprNode;
  operator: IdentifierNode;
  to: ValueExprNode;
}

export interface ContextLiftNode extends BaseNode {
  type: "ContextLift";
  context: IdentifierNode;
  segment: ActionSegmentNode;
}

/* =========================
   Seed
   ========================= */

export interface SeedSourceNode extends BaseNode {
  type: "SeedSource";
  name: "@seed";
}

export interface ComposeExprNode extends BaseNode {
  type: "ComposeExpr";
  name: "@compose";
  assets: IdentifierNode[];
  merge: IdentifierNode;
}

export interface GraphRefNode extends BaseNode {
  type: "GraphRef";
  name: "@graph";
  graphId: IdentifierNode;
}

export interface SeedNodeRefNode extends BaseNode {
  type: "SeedNodeRef";
  ref: IdentifierNode;
}

export type SeedEdgeEntryNode = EdgeExprNode | SeedEdgeBindingNode;

export interface SeedEdgeBindingNode extends BaseNode {
  type: "SeedEdgeBinding";
  name: IdentifierNode;
  edge: EdgeExprNode;
}

export interface EdgeExprNode extends BaseNode {
  type: "EdgeExpr";
  left: IdentifierNode;
  relation: StringLiteralNode;
  right: IdentifierNode;
}

/* =========================
   Objects / Arrays
   ========================= */

export interface ObjectLiteralNode extends BaseNode {
  type: "ObjectLiteral";
  properties: ObjectPropertyNode[];
}

export interface ObjectPropertyNode extends BaseNode {
  type: "ObjectProperty";
  key: string;
  value: ValueExprNode;
}

export interface ArrayLiteralNode extends BaseNode {
  type: "ArrayLiteral";
  elements: ValueExprNode[];
}

/* =========================
   Built-in Operator Expressions
   ========================= */

export interface ActionExprNode extends BaseNode {
  type: "ActionExpr";
  name: "@action";
  guard: ActionGuardExprNode | null;
  pipeline: ActionPipelineStepNode[];
  project: ActionProjectExprNode | null;
}

export type ActionGuardExprNode = BooleanExprNode | GraphQueryExprNode;

export type ActionPipelineStepNode = GraphPipelineStepNode | LoopExprNode;

export type GraphPipelineStepNode = MutationExprNode | IfExprNode | WhenExprNode;

export interface CtxExprNode extends BaseNode {
  type: "CtxExpr";
  name: "@ctx";
  args: ArgumentNode[];
}

export interface ProjectExprNode extends BaseNode {
  type: "ProjectExpr";
  name: "@project";
  syntax: "inline" | "block";
  args: ArgumentNode[];
}

export interface ArgumentNode extends BaseNode {
  type: "Argument";
  key: IdentifierNode | null;
  value: ValueExprNode;
}

/* =========================
   Mutations
   ========================= */

export type MutationExprNode =
  | GraftBranchExprNode
  | GraftStateExprNode
  | GraftMetaExprNode
  | GraftProgressExprNode
  | PruneBranchExprNode
  | PruneStateExprNode
  | PruneMetaExprNode
  | PruneNodesExprNode
  | PruneEdgesExprNode
  | CtxSetExprNode
  | CtxClearExprNode
  | ApplyExprNode;

export type GraphControlExprNode = GraphQueryExprNode | BooleanLiteralNode;

export interface IfExprNode extends BaseNode {
  type: "IfExpr";
  name: "@if";
  condition: GraphControlExprNode | null;
  then: GraphPipelineStepNode[];
  else: GraphPipelineStepNode[] | null;
}

export interface LoopExprNode extends BaseNode {
  type: "LoopExpr";
  name: "@loop";
  until: GraphQueryExprNode | null;
  count: LoopCountExprNode | null;
  pipeline: ActionPipelineStepNode[];
}

export type LoopCountExprNode =
  | NumberLiteralNode
  | DeriveStateExprNode
  | DeriveMetaExprNode;

export interface GraftBranchExprNode extends BaseNode {
  type: "GraftBranchExpr";
  name: "@graft.branch";
  subject: IdentifierNode;
  relation: StringLiteralNode;
  object: IdentifierNode;
}

export interface GraftStateExprNode extends BaseNode {
  type: "GraftStateExpr";
  name: "@graft.state";
  node: IdentifierNode;
  key: StringLiteralNode;
  value: ValueExprNode;
}

export interface GraftMetaExprNode extends BaseNode {
  type: "GraftMetaExpr";
  name: "@graft.meta";
  node: IdentifierNode;
  key: StringLiteralNode;
  value: ValueExprNode;
}

export interface GraftProgressExprNode extends BaseNode {
  type: "GraftProgressExpr";
  name: "@graft.progress";
  from: IdentifierNode;
  relation: StringLiteralNode;
  to: IdentifierNode;
}

export interface PruneBranchExprNode extends BaseNode {
  type: "PruneBranchExpr";
  name: "@prune.branch";
  subject: IdentifierNode;
  relation: StringLiteralNode;
  object: IdentifierNode;
}

export interface PruneStateExprNode extends BaseNode {
  type: "PruneStateExpr";
  name: "@prune.state";
  node: IdentifierNode;
  key: StringLiteralNode;
}

export interface PruneMetaExprNode extends BaseNode {
  type: "PruneMetaExpr";
  name: "@prune.meta";
  node: IdentifierNode;
  key: StringLiteralNode;
}

export interface WherePredicateNode extends BaseNode {
  type: "WherePredicate";
  expression: BooleanExprNode;
}

export interface PruneNodesExprNode extends BaseNode {
  type: "PruneNodesExpr";
  name: "@prune.nodes";
  where: WherePredicateNode;
}

export interface PruneEdgesExprNode extends BaseNode {
  type: "PruneEdgesExpr";
  name: "@prune.edges";
  where: WherePredicateNode;
}

export interface CtxSetExprNode extends BaseNode {
  type: "CtxSetExpr";
  name: "@ctx.set";
  edge: IdentifierNode;
  context: ValueExprNode;
}

export interface CtxClearExprNode extends BaseNode {
  type: "CtxClearExpr";
  name: "@ctx.clear";
  edge: IdentifierNode;
}

export interface ApplyExprNode extends BaseNode {
  type: "ApplyExpr";
  name: "@apply";
  target: IdentifierNode | NodeCaptureNode;
}

/* =========================
   Graph Effects
   ========================= */

export interface EffectBlockNode extends BaseNode {
  type: "EffectBlock";
  name: "@effect";
  target: EffectTargetNode;
  ops: EffectOpNode[];
}

export type EffectTargetNode = RootTargetNode | IdentifierNode;

export interface RootTargetNode extends BaseNode {
  type: "RootTarget";
  name: "root";
}

export type EffectOpNode =
  | EffectGraftStateOpNode
  | EffectGraftMetaOpNode
  | EffectPruneStateOpNode
  | EffectPruneMetaOpNode
  | EffectDeriveStateOpNode
  | EffectDeriveMetaOpNode;

export interface EffectGraftStateOpNode extends BaseNode {
  type: "EffectGraftStateOp";
  name: "@graft.state";
  key: StringLiteralNode;
  value: ValueExprNode;
}

export interface EffectGraftMetaOpNode extends BaseNode {
  type: "EffectGraftMetaOp";
  name: "@graft.meta";
  key: StringLiteralNode;
  value: ValueExprNode;
}

export interface EffectPruneStateOpNode extends BaseNode {
  type: "EffectPruneStateOp";
  name: "@prune.state";
  key: StringLiteralNode;
}

export interface EffectPruneMetaOpNode extends BaseNode {
  type: "EffectPruneMetaOp";
  name: "@prune.meta";
  key: StringLiteralNode;
}

export interface EffectDeriveStateOpNode extends BaseNode {
  type: "EffectDeriveStateOp";
  name: "@derive.state";
  key: StringLiteralNode;
  expression: DeriveExprNode;
}

export interface EffectDeriveMetaOpNode extends BaseNode {
  type: "EffectDeriveMetaOp";
  name: "@derive.meta";
  key: StringLiteralNode;
  expression: DeriveExprNode;
}

export type DeriveExprNode =
  | CurrentValueNode
  | PreviousValueNode
  | NumberLiteralNode
  | StringLiteralNode
  | DeriveBinaryExprNode;

export interface CurrentValueNode extends BaseNode {
  type: "CurrentValue";
  name: "current";
}

export interface PreviousValueNode extends BaseNode {
  type: "PreviousValue";
  name: "previous";
}

export interface DeriveBinaryExprNode extends BaseNode {
  type: "DeriveBinaryExpr";
  operator: "+" | "-" | "*" | "/";
  left: DeriveExprNode;
  right: DeriveExprNode;
}

/* =========================
   Query / Reasoning
   ========================= */

export type QueryExprNode =
  | MatchExprNode
  | PathExprNode
  | WhyExprNode
  | HowExprNode
  | WhereExprNode
  | GraphQueryExprNode;

export interface GraphQueryExprNode extends BaseNode {
  type: "GraphQueryExpr";
  name: "@query";
  subject: IdentifierNode | null;
  relation: StringLiteralNode | null;
  object: IdentifierNode | null;
  node: IdentifierNode | null;
  state: StringLiteralNode | null;
  meta: StringLiteralNode | null;
  equals: ValueExprNode | null;
}

export interface DeriveStateExprNode extends BaseNode {
  type: "DeriveStateExpr";
  name: "@derive.state";
  node: IdentifierNode | null;
  key: StringLiteralNode | null;
}

export interface DeriveMetaExprNode extends BaseNode {
  type: "DeriveMetaExpr";
  name: "@derive.meta";
  node: IdentifierNode | null;
  key: StringLiteralNode | null;
}

export interface WhereExprNode extends BaseNode {
  type: "WhereExpr";
  expression: BooleanExprNode;
}

export interface MatchExprNode extends BaseNode {
  type: "MatchExpr";
  patterns: RelationPatternNode[];
  where: BooleanExprNode | null;
}

export interface PathExprNode extends BaseNode {
  type: "PathExpr";
  from: ValueExprNode;
  to: ValueExprNode;
  where: BooleanExprNode | null;
}

export interface WhyExprNode extends BaseNode {
  type: "WhyExpr";
  target: WhyTargetNode;
}

export interface HowExprNode extends BaseNode {
  type: "HowExpr";
  target: IdentifierNode | NodeCaptureNode;
}

export type WhyTargetNode =
  | EdgeExprNode
  | IdentifierNode
  | MatchExprNode
  | PathExprNode;

export interface RelationPatternNode extends BaseNode {
  type: "RelationPattern";
  left: PatternAtomNode;
  relation: PatternAtomNode;
  right: PatternAtomNode;
}

export type PatternAtomNode =
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | RegexLiteralNode
  | WildcardNode
  | NodeCaptureNode;

/* =========================
   Boolean Expressions
   ========================= */

export type BooleanExprNode =
  | BinaryBooleanExprNode
  | UnaryBooleanExprNode
  | ComparisonExprNode
  | GroupedBooleanExprNode
  | PropertyAccessNode
  | IdentifierNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | RegexLiteralNode;

export interface BinaryBooleanExprNode extends BaseNode {
  type: "BinaryBooleanExpr";
  operator: "&&" | "||";
  left: BooleanExprNode;
  right: BooleanExprNode;
}

export interface UnaryBooleanExprNode extends BaseNode {
  type: "UnaryBooleanExpr";
  operator: "!";
  argument: BooleanExprNode;
}

export interface GroupedBooleanExprNode extends BaseNode {
  type: "GroupedBooleanExpr";
  expression: BooleanExprNode;
}

export interface ComparisonExprNode extends BaseNode {
  type: "ComparisonExpr";
  operator: "==" | "===" | "!=" | "!==";
  left: BooleanValueNode;
  right: BooleanValueNode;
}

export type BooleanValueNode =
  | IdentifierNode
  | PropertyAccessNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | RegexLiteralNode;

export interface PropertyAccessNode extends BaseNode {
  type: "PropertyAccess";
  object: IdentifierNode;
  property: IdentifierNode;
  chain: IdentifierNode[];
}

/* =========================
   Type Guards
   ========================= */

export function isIdentifierNode(node: unknown): node is IdentifierNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "Identifier";
}

export function isNodeCaptureNode(node: unknown): node is NodeCaptureNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "NodeCapture";
}

export function isTraversalExprNode(node: unknown): node is TraversalExprNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "TraversalExpr";
}

export function isMatchExprNode(node: unknown): node is MatchExprNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "MatchExpr";
}

export function isPathExprNode(node: unknown): node is PathExprNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "PathExpr";
}

export function isWhyExprNode(node: unknown): node is WhyExprNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "WhyExpr";
}

export function isHowExprNode(node: unknown): node is HowExprNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "HowExpr";
}

export function isSeedEdgeBindingNode(node: unknown): node is SeedEdgeBindingNode {
  return !!node && typeof node === "object" && (node as BaseNode).type === "SeedEdgeBinding";
}
