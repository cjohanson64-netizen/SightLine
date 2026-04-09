import type { Token, TokenType } from "../lexer/tokenize";
import type {
  ActionExprNode,
  ActionGuardExprNode,
  ActionPipelineStepNode,
  ActionProjectExprNode,
  ApplyExprNode,
  ActionSegmentNode,
  ArgumentNode,
  ArrayLiteralNode,
  BaseNode,
  BindEntity,
  BindLayer,
  BindStatementNode,
  BinaryBooleanExprNode,
  BooleanExprNode,
  BooleanLiteralNode,
  BooleanValueNode,
  ComparisonExprNode,
  ComposeExprNode,
  CurrentValueNode,
  CtxClearExprNode,
  CtxExprNode,
  DeriveBinaryExprNode,
  DeriveExprNode,
  CtxSetExprNode,
  EdgeExprNode,
  EffectBlockNode,
  DeriveMetaExprNode,
  DeriveStateExprNode,
  EffectDeriveMetaOpNode,
  EffectDeriveStateOpNode,
  EffectGraftMetaOpNode,
  EffectGraftStateOpNode,
  EffectOpNode,
  EffectPruneMetaOpNode,
  EffectPruneStateOpNode,
  ExportDeclarationNode,
  ExportSpecifierNode,
  GraftBranchExprNode,
  GraftMetaExprNode,
  GraftProgressExprNode,
  GraphControlExprNode,
  GraphInteractionDefinitionNode,
  GraphPipelineStepNode,
  GraphRefNode,
  GraftStateExprNode,
  GraphSourceNode,
  GraphPipelineNode,
  GraphProjectionNode,
  GraphQueryExprNode,
  GroupedBooleanExprNode,
  HowExprNode,
  IdentifierNode,
  ImportDeclarationNode,
  ImportSpecifierNode,
  MatchExprNode,
  MutationExprNode,
  NodeCaptureNode,
  NodeShapeNode,
  NumberLiteralNode,
  ObjectLiteralNode,
  ObjectPropertyNode,
  OperatorBindingNode,
  OperatorExprNode,
  PathExprNode,
  ProgramNode,
  ProjectExprNode,
  PropertyAccessNode,
  PreviousValueNode,
  PruneBranchExprNode,
  PruneEdgesExprNode,
  PruneMetaExprNode,
  PruneNodesExprNode,
  PruneStateExprNode,
  QueryExprNode,
  QueryStatementNode,
  RegexLiteralNode,
  RelationPatternNode,
  LoopCountExprNode,
  LoopExprNode,
  IfExprNode,
  SeedBlockNode,
  SeedEdgeBindingNode,
  SeedEdgeEntryNode,
  SeedNodeRefNode,
  SeedSourceNode,
  StatementNode,
  StringLiteralNode,
  SystemRelationNode,
  TraversalExprNode,
  TraversalSegmentNode,
  UnaryBooleanExprNode,
  ValueBindingNode,
  ValueExprNode,
  WhenExprNode,
  WhereExprNode,
  WherePredicateNode,
  WhyExprNode,
  WhyTargetNode,
  WildcardNode,
  RootTargetNode,
} from "../ast/nodeTypes";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly token: Token,
  ) {
    super(`${message} at ${token.line}:${token.column}`);
    this.name = "ParseError";
  }
}

export function parse(tokens: Token[]): ProgramNode {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): ProgramNode {
    const body: StatementNode[] = [];
    const start = this.peek();

    this.skipNewlines();

    while (!this.isAtEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }

    return this.node<ProgramNode>(
      "Program",
      {
        body,
      },
      start,
    );
  }

  private parseStatement(): StatementNode {
    this.skipNewlines();

    if (this.checkTypeIdentifierValue("import")) {
      return this.parseImportDeclaration();
    }

    if (this.checkTypeIdentifierValue("export")) {
      return this.parseExportDeclaration();
    }

    if (this.check("KEYWORD", "@seed")) {
      return this.parseSeedBlock();
    }

    if (this.check("KEYWORD", "@graph")) {
      return this.parseGraphInteractionDefinition(null);
    }

    if (this.check("KEYWORD", "@when")) {
      return this.parseWhenExpr();
    }

    if (this.isGraphPipelineStart()) {
      return this.parseGraphPipeline();
    }

    if (this.isSystemRelationStart()) {
      return this.parseSystemRelation();
    }

    if (
      this.check("KEYWORD", "@query") ||
      this.check("KEYWORD", "@match") ||
      this.check("KEYWORD", "@path") ||
      this.check("KEYWORD", "@why") ||
      this.check("KEYWORD", "@how") ||
      this.check("KEYWORD", "@where")
    ) {
      const expr = this.parseQueryExpr();
      return this.node<QueryStatementNode>(
        "QueryStatement",
        { expr },
        this.previousOrPeek(),
      );
    }

    if (this.isBindStatementStart()) {
      return this.parseBindStatement();
    }

    if (this.checkType("IDENT")) {
      return this.parseBindingLikeStatement();
    }

    throw this.error(this.peek(), `Unexpected token "${this.peek().value}"`);
  }

  private parseImportDeclaration(): ImportDeclarationNode {
    const start = this.expectIdentifierValue("import");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    const specifiers: ImportSpecifierNode[] = [];

    while (!this.checkType("RBRACE")) {
      const imported = this.parseIdentifier();
      let local = imported;

      if (this.checkTypeIdentifierValue("as")) {
        this.expectIdentifierValue("as");
        local = this.parseIdentifier();
      }

      specifiers.push(
        this.node<ImportSpecifierNode>(
          "ImportSpecifier",
          { imported, local },
          identToToken(imported),
        ),
      );

      this.skipNewlines();

      if (this.match("COMMA")) {
        this.skipNewlines();
        continue;
      }

      break;
    }

    this.skipNewlines();
    this.expect("RBRACE");
    this.skipNewlines();
    this.expectIdentifierValue("from");
    this.skipNewlines();
    const source = this.parseStringLiteral();

    return this.node<ImportDeclarationNode>(
      "ImportDeclaration",
      {
        specifiers,
        source,
      },
      start,
    );
  }

  private parseExportDeclaration(): ExportDeclarationNode {
    const start = this.expectIdentifierValue("export");
    this.skipNewlines();

    const specifiers: ExportSpecifierNode[] = [];

    if (this.match("LBRACE")) {
      this.skipNewlines();

      while (!this.checkType("RBRACE")) {
        const local = this.parseIdentifier();
        specifiers.push(
          this.node<ExportSpecifierNode>(
            "ExportSpecifier",
            { local },
            identToToken(local),
          ),
        );

        this.skipNewlines();
        if (this.match("COMMA")) {
          this.skipNewlines();
          continue;
        }
        break;
      }

      this.skipNewlines();
      this.expect("RBRACE");
    } else {
      const local = this.parseIdentifier();
      specifiers.push(
        this.node<ExportSpecifierNode>(
          "ExportSpecifier",
          { local },
          identToToken(local),
        ),
      );
    }

    return this.node<ExportDeclarationNode>(
      "ExportDeclaration",
      { specifiers },
      start,
    );
  }

  private parseBindingLikeStatement(): StatementNode {
    const ident = this.parseIdentifier();

    if (this.match("COLON_EQUALS")) {
      if (this.check("KEYWORD", "@graph")) {
        return this.parseGraphInteractionDefinition(ident);
      }

      if (this.check("KEYWORD", "@seed")) {
        return this.parseGraphPipelineAfterName(ident);
      }

      const value = this.parseOperatorExpr();
      return this.node<OperatorBindingNode>(
        "OperatorBinding",
        {
          name: ident,
          value,
        },
        identToToken(ident),
      );
    }

    if (this.match("EQUALS")) {
      // Detect: name = graphId <> @project(...)
      if (this.isGraphProjectionExprStart()) {
        const source = this.parseIdentifier();
        this.skipNewlines();
        this.expect("PROJECT");
        const projection = this.parseProjectExpr();
        return this.node<GraphProjectionNode>(
          "GraphProjection",
          { name: ident, source, projection },
          identToToken(ident),
        );
      }

      const value = this.parseValueExpr();
      return this.node<ValueBindingNode>(
        "ValueBinding",
        {
          name: ident,
          value,
        },
        identToToken(ident),
      );
    }

    throw this.error(
      this.peek(),
      `Expected "=" or ":=" after identifier "${ident.name}"`,
    );
  }

  private isBindStatementStart(): boolean {
    if (!this.checkType("KEYWORD")) {
      return false;
    }

    return this.peek().value === "@bind" || this.peek().value.startsWith("@bind.");
  }

  private parseBindStatement(): BindStatementNode {
    const keyword = this.expectType("KEYWORD");
    const { layer, entity } = this.parseBindSelector(keyword);

    this.expect("LPAREN");
    const name = this.parseIdentifier();
    this.expect("COLON_EQUALS");
    const expression = this.parseValueExpr();
    this.expect("RPAREN");

    return this.node<BindStatementNode>(
      "BindStatement",
      {
        layer,
        entity,
        name,
        expression,
      },
      keyword,
    );
  }

  private parseBindSelector(
    keyword: Token,
  ): { layer: BindLayer | null; entity: BindEntity | null } {
    const parts = keyword.value.split(".");

    if (parts[0] !== "@bind") {
      throw this.error(keyword, `Expected @bind statement, got "${keyword.value}"`);
    }

    if (parts.length === 1) {
      return { layer: null, entity: null };
    }

    if (parts.length === 2) {
      return {
        layer: parts[1] as BindLayer,
        entity: null,
      };
    }

    if (parts.length === 3) {
      return {
        layer: parts[1] as BindLayer,
        entity: parts[2] as BindEntity,
      };
    }

    throw this.error(keyword, `Unsupported @bind form "${keyword.value}"`);
  }

  private parseSeedBlock(): SeedBlockNode {
    const start = this.expect("KEYWORD", "@seed");
    this.expect("COLON");

    this.skipNewlines();

    let nodes: SeedNodeRefNode[] = [];
    let edges: SeedEdgeEntryNode[] = [];
    let state: ObjectLiteralNode | null = null;
    let meta: ObjectLiteralNode | null = null;
    let root: IdentifierNode | null = null;

    while (!this.isAtEnd()) {
      this.skipNewlines();

      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        break;
      }

      const field = this.parseIdentifier().name;
      this.expect("COLON");
      
      switch (field) {
        case "nodes":
          nodes = this.parseSeedNodes();
          break;
        case "edges":
          edges = this.parseSeedEdges();
          break;
        case "state":
          state = this.parseObjectLiteral();
          break;
        case "meta":
          meta = this.parseObjectLiteral();
          break;
        case "root":
          root = this.parseIdentifier();
          break;
        default:
          throw this.error(this.peek(), `Unknown @seed field "${field}"`);
      }

      this.skipNewlines();
    }

    if (!state) {
      state = this.node<ObjectLiteralNode>(
        "ObjectLiteral",
        { properties: [] },
        start,
      );
    }

    if (!meta) {
      meta = this.node<ObjectLiteralNode>(
        "ObjectLiteral",
        { properties: [] },
        start,
      );
    }

    if (!root) {
      throw this.error(start, `@seed requires a root field`);
    }

    return this.node<SeedBlockNode>(
      "SeedBlock",
      {
        nodes,
        edges,
        state,
        meta,
        root,
      },
      start,
    );
  }

  private parseSeedNodes(): SeedNodeRefNode[] {
    this.expect("LBRACKET");
    const nodes: SeedNodeRefNode[] = [];

    this.skipNewlines();

    while (!this.checkType("RBRACKET")) {
      this.skipNewlines();

      const ref = this.parseIdentifier();
      nodes.push(
        this.node<SeedNodeRefNode>("SeedNodeRef", { ref }, identToToken(ref)),
      );

      this.skipNewlines();

      if (this.match("COMMA")) {
        this.skipNewlines();
        continue;
      }

      break;
    }

    this.skipNewlines();
    this.expect("RBRACKET");
    return nodes;
  }

  private parseSeedEdges(): SeedEdgeEntryNode[] {
    this.expect("LBRACKET");
    const edges: SeedEdgeEntryNode[] = [];

    this.skipNewlines();

    while (!this.checkType("RBRACKET")) {
      this.skipNewlines();
      edges.push(this.parseSeedEdgeEntry());

      this.skipNewlines();

      if (this.match("COMMA")) {
        this.skipNewlines();
        continue;
      }

      break;
    }

    this.skipNewlines();
    this.expect("RBRACKET");
    return edges;
  }

  private parseSeedEdgeEntry(): SeedEdgeEntryNode {
    if (
      this.checkType("IDENT") &&
      this.peekNext().type === "COLON_EQUALS" &&
      this.peekN(2).type === "LBRACKET"
    ) {
      const name = this.parseIdentifier();
      this.expect("COLON_EQUALS");
      this.expect("LBRACKET");
      this.skipNewlines();
      const edge = this.parseEdgeExpr();
      this.skipNewlines();
      this.expect("RBRACKET");
      return this.node<SeedEdgeBindingNode>(
        "SeedEdgeBinding",
        {
          name,
          edge,
        },
        identToToken(name),
      );
    }

    this.expect("LBRACKET");
    this.skipNewlines();
    const edge = this.parseEdgeExpr();
    this.skipNewlines();
    this.expect("RBRACKET");
    return edge;
  }

  private parseEdgeExpr(): EdgeExprNode {
    const left = this.parseIdentifier();
    this.expect("COLON");
    const relation = this.parseStringLiteral();
    this.expect("COLON");
    const right = this.parseIdentifier();

    return this.node<EdgeExprNode>(
      "EdgeExpr",
      {
        left,
        relation,
        right,
      },
      identToToken(left),
    );
  }

  private parseGraphInteractionDefinition(
    name: IdentifierNode | null,
  ): GraphInteractionDefinitionNode {
    const start = name ? identToToken(name) : this.peek();
    const subject = this.parseGraphRef();
    this.expect("COLON");
    const relation = this.parseStringLiteral();
    this.expect("COLON");
    const object = this.parseGraphRef();
    this.skipNewlines();
    this.expect("ARROW");
    const effect = this.parseEffectBlock();

    return this.node<GraphInteractionDefinitionNode>(
      "GraphInteractionDefinition",
      {
        name,
        subject,
        relation,
        object,
        effect,
      },
      start,
    );
  }

  private parseGraphRef(): GraphRefNode {
    const start = this.expect("KEYWORD", "@graph");
    this.expect("LPAREN");
    const graphId = this.parseIdentifier();
    this.expect("RPAREN");

    return this.node<GraphRefNode>(
      "GraphRef",
      {
        name: "@graph",
        graphId,
      },
      start,
    );
  }

  private parseEffectBlock(): EffectBlockNode {
    const start = this.expect("KEYWORD", "@effect");
    this.expect("LPAREN");
    this.skipNewlines();

    let target = null as EffectBlockNode["target"] | null;
    let ops = null as EffectOpNode[] | null;

    while (!this.checkType("RPAREN")) {
      const fieldToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (fieldToken.value) {
        case "target":
          if (target !== null) {
            throw this.error(fieldToken, `Duplicate @effect field "target"`);
          }
          target = this.parseEffectTarget();
          break;

        case "ops":
          if (ops !== null) {
            throw this.error(fieldToken, `Duplicate @effect field "ops"`);
          }
          ops = this.parseEffectOps();
          break;

        default:
          throw this.error(fieldToken, `Unknown @effect field "${fieldToken.value}"`);
      }

      this.skipNewlines();
      if (!this.match("COMMA")) {
        break;
      }
      this.skipNewlines();
    }

    this.expect("RPAREN");

    if (target === null) {
      throw this.error(start, `@effect requires a target field`);
    }

    if (ops === null) {
      throw this.error(start, `@effect requires an ops field`);
    }

    return this.node<EffectBlockNode>(
      "EffectBlock",
      {
        name: "@effect",
        target,
        ops,
      },
      start,
    );
  }

  private parseEffectTarget(): EffectBlockNode["target"] {
    if (this.checkType("IDENT") && this.peek().value === "root") {
      const token = this.expectType("IDENT");
      return this.node<RootTargetNode>(
        "RootTarget",
        {
          name: "root",
        },
        token,
      );
    }

    return this.parseIdentifier();
  }

  private parseEffectOps(): EffectOpNode[] {
    this.expect("LBRACKET");
    this.skipNewlines();

    const ops: EffectOpNode[] = [];

    while (!this.checkType("RBRACKET")) {
      ops.push(this.parseEffectOp());
      this.skipNewlines();

      if (!this.match("COMMA")) {
        break;
      }

      this.skipNewlines();
    }

    this.expect("RBRACKET");
    return ops;
  }

  private parseEffectOp(): EffectOpNode {
    const keyword = this.expectType("KEYWORD");

    switch (keyword.value) {
      case "@graft.state": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const value = this.parseValueExpr();
        this.expect("RPAREN");
        return this.node<EffectGraftStateOpNode>(
          "EffectGraftStateOp",
          {
            name: "@graft.state",
            key,
            value,
          },
          keyword,
        );
      }

      case "@graft.meta": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const value = this.parseValueExpr();
        this.expect("RPAREN");
        return this.node<EffectGraftMetaOpNode>(
          "EffectGraftMetaOp",
          {
            name: "@graft.meta",
            key,
            value,
          },
          keyword,
        );
      }

      case "@prune.state": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("RPAREN");
        return this.node<EffectPruneStateOpNode>(
          "EffectPruneStateOp",
          {
            name: "@prune.state",
            key,
          },
          keyword,
        );
      }

      case "@prune.meta": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("RPAREN");
        return this.node<EffectPruneMetaOpNode>(
          "EffectPruneMetaOp",
          {
            name: "@prune.meta",
            key,
          },
          keyword,
        );
      }

      case "@derive.state": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const expression = this.parseDeriveExpr();
        this.expect("RPAREN");
        return this.node<EffectDeriveStateOpNode>(
          "EffectDeriveStateOp",
          {
            name: "@derive.state",
            key,
            expression,
          },
          keyword,
        );
      }

      case "@derive.meta": {
        this.expect("LPAREN");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const expression = this.parseDeriveExpr();
        this.expect("RPAREN");
        return this.node<EffectDeriveMetaOpNode>(
          "EffectDeriveMetaOp",
          {
            name: "@derive.meta",
            key,
            expression,
          },
          keyword,
        );
      }

      default:
        throw this.error(keyword, `Unsupported @effect op "${keyword.value}"`);
    }
  }

  private parseGraphPipeline(): GraphPipelineNode {
    const name = this.parseIdentifier();
    this.expect("COLON_EQUALS");
    return this.parseGraphPipelineAfterName(name);
  }

  private parseGraphPipelineAfterName(name: IdentifierNode): GraphPipelineNode {
    const start = identToToken(name);
    const source = this.parseGraphSource();

    const mutations: GraphPipelineStepNode[] = [];
    let projection: ProjectExprNode | null = null;

    this.skipNewlines();

    while (this.match("ARROW")) {
      const mutation = this.parseGraphPipelineStep();
      mutations.push(mutation);
      this.skipNewlines();
    }

    if (this.match("PROJECT")) {
      projection = this.parseProjectExpr();
    }

    return this.node<GraphPipelineNode>(
      "GraphPipeline",
      {
        name,
        source,
        mutations,
        projection,
      },
      start,
    );
  }

private parseGraphPipelineStep(): GraphPipelineStepNode {
  if (this.check("KEYWORD", "@if")) {
    return this.parseIfExpr();
  }

  if (this.check("KEYWORD", "@when")) {
    return this.parseWhenExpr();
  }

  return this.parseMutationExpr();
}

  private parseMutationExpr(): MutationExprNode {
    const keyword = this.expectType("KEYWORD");

    switch (keyword.value) {
      case "@graft.branch": {
        this.expect("LPAREN");
        const subject = this.parseIdentifier();
        this.expect("COMMA");
        const relation = this.parseStringLiteral();
        this.expect("COMMA");
        const object = this.parseIdentifier();
        this.expect("RPAREN");
        return this.node<GraftBranchExprNode>(
          "GraftBranchExpr",
          {
            name: "@graft.branch",
            subject,
            relation,
            object,
          },
          keyword,
        );
      }

      case "@graft.state": {
        this.expect("LPAREN");
        const node = this.parseIdentifier();
        this.expect("COMMA");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const value = this.parseValueExpr();
        this.expect("RPAREN");
        return this.node<GraftStateExprNode>(
          "GraftStateExpr",
          {
            name: "@graft.state",
            node,
            key,
            value,
          },
          keyword,
        );
      }

      case "@graft.meta": {
        this.expect("LPAREN");
        const node = this.parseIdentifier();
        this.expect("COMMA");
        const key = this.parseStringLiteral();
        this.expect("COMMA");
        const value = this.parseValueExpr();
        this.expect("RPAREN");
        return this.node<GraftMetaExprNode>(
          "GraftMetaExpr",
          {
            name: "@graft.meta",
            node,
            key,
            value,
          },
          keyword,
        );
      }

      case "@graft.progress": {
        this.expect("LPAREN");
        const from = this.parseIdentifier();
        this.expect("COMMA");
        const relation = this.parseStringLiteral();
        this.expect("COMMA");
        const to = this.parseIdentifier();
        this.expect("RPAREN");
        return this.node<GraftProgressExprNode>(
          "GraftProgressExpr",
          {
            name: "@graft.progress",
            from,
            relation,
            to,
          },
          keyword,
        );
      }

      case "@prune.branch": {
        this.expect("LPAREN");
        const subject = this.parseIdentifier();
        this.expect("COMMA");
        const relation = this.parseStringLiteral();
        this.expect("COMMA");
        const object = this.parseIdentifier();
        this.expect("RPAREN");
        return this.node<PruneBranchExprNode>(
          "PruneBranchExpr",
          {
            name: "@prune.branch",
            subject,
            relation,
            object,
          },
          keyword,
        );
      }

      case "@prune.state": {
        this.expect("LPAREN");
        const node = this.parseIdentifier();
        this.expect("COMMA");
        const key = this.parseStringLiteral();
        this.expect("RPAREN");
        return this.node<PruneStateExprNode>(
          "PruneStateExpr",
          {
            name: "@prune.state",
            node,
            key,
          },
          keyword,
        );
      }

      case "@prune.meta": {
        this.expect("LPAREN");
        const node = this.parseIdentifier();
        this.expect("COMMA");
        const key = this.parseStringLiteral();
        this.expect("RPAREN");
        return this.node<PruneMetaExprNode>(
          "PruneMetaExpr",
          {
            name: "@prune.meta",
            node,
            key,
          },
          keyword,
        );
      }

      case "@prune.nodes": {
        this.expect("LPAREN");
        const where = this.parseWherePredicate();
        this.expect("RPAREN");
        return this.node<PruneNodesExprNode>(
          "PruneNodesExpr",
          {
            name: "@prune.nodes",
            where,
          },
          keyword,
        );
      }

      case "@prune.edges": {
        this.expect("LPAREN");
        const where = this.parseWherePredicate();
        this.expect("RPAREN");
        return this.node<PruneEdgesExprNode>(
          "PruneEdgesExpr",
          {
            name: "@prune.edges",
            where,
          },
          keyword,
        );
      }

      case "@ctx.set":
        return this.parseCtxSetExpr(keyword);

      case "@ctx.clear":
        return this.parseCtxClearExpr(keyword);

      case "@apply":
        return this.parseApplyExpr(keyword);

      default:
        throw this.error(
          keyword,
          `Unsupported mutation operator "${keyword.value}"`,
        );
    }
  }

  private parseApplyExpr(startToken: Token): ApplyExprNode {
    this.expect("LPAREN");

    let target: IdentifierNode | NodeCaptureNode;

    if (this.checkType("IDENT")) {
      target = this.parseIdentifier();
    } else if (this.checkType("LANGLE")) {
      target = this.parseNodeCapture();
    } else {
      throw this.error(
        this.peek(),
        "Expected identifier or node capture inside @apply(...)",
      );
    }

    this.expect("RPAREN");

    return this.node<ApplyExprNode>(
      "ApplyExpr",
      {
        name: "@apply",
        target,
      },
      startToken,
    );
  }

  private parseCtxSetExpr(startToken: Token): CtxSetExprNode {
    this.expect("LPAREN");
    const edge = this.parseIdentifier();
    this.expect("COMMA");
    const context = this.parseValueExpr();
    this.expect("RPAREN");

    return this.node<CtxSetExprNode>(
      "CtxSetExpr",
      {
        name: "@ctx.set",
        edge,
        context,
      },
      startToken,
    );
  }

  private parseCtxClearExpr(startToken: Token): CtxClearExprNode {
    this.expect("LPAREN");
    const edge = this.parseIdentifier();
    this.expect("RPAREN");

    return this.node<CtxClearExprNode>(
      "CtxClearExpr",
      {
        name: "@ctx.clear",
        edge,
      },
      startToken,
    );
  }

  private parseSystemRelation(): SystemRelationNode {
    const left = this.parseIdentifier();
    let relation: StringLiteralNode | null = null;

    if (this.match("COLON")) {
      relation = this.parseStringLiteral();
      this.expect("TCOLON");
    } else {
      this.expect("TCOLON");
    }

    const right = this.parseIdentifier();

    return this.node<SystemRelationNode>(
      "SystemRelation",
      {
        left,
        relation,
        right,
      },
      identToToken(left),
    );
  }

  private parseQueryExpr(): QueryExprNode {
    if (this.check("KEYWORD", "@query")) return this.parseGraphQueryExpr();
    if (this.check("KEYWORD", "@match")) return this.parseMatchExpr();
    if (this.check("KEYWORD", "@path")) return this.parsePathExpr();
    if (this.check("KEYWORD", "@why")) return this.parseWhyExpr();
    if (this.check("KEYWORD", "@how")) return this.parseHowExpr();
    if (this.check("KEYWORD", "@where")) return this.parseWhereExpr();
    throw this.error(this.peek(), "Expected query expression");
  }

  private parseMatchExpr(): MatchExprNode {
    const start = this.expect("KEYWORD", "@match");
    this.expect("LPAREN");
    this.skipNewlines();

    const patterns: RelationPatternNode[] = [];

    while (!this.checkType("RPAREN")) {
      patterns.push(this.parseRelationPattern());
      this.skipNewlines();
    }

    this.expect("RPAREN");

    let where: BooleanExprNode | null = null;
    this.skipNewlines();

    if (this.check("KEYWORD", "@where")) {
      where = this.parseWhereClause();
    }

    return this.node<MatchExprNode>(
      "MatchExpr",
      {
        patterns,
        where,
      },
      start,
    );
  }

  private parsePathExpr(): PathExprNode {
    const start = this.expect("KEYWORD", "@path");
    this.expect("LPAREN");
    const from = this.parseValueExpr();
    this.expect("COMMA");
    const to = this.parseValueExpr();
    this.expect("RPAREN");

    let where: BooleanExprNode | null = null;
    this.skipNewlines();

    if (this.check("KEYWORD", "@where")) {
      where = this.parseWhereClause();
    }

    return this.node<PathExprNode>(
      "PathExpr",
      {
        from,
        to,
        where,
      },
      start,
    );
  }

  private parseWhyExpr(): WhyExprNode {
    const start = this.expect("KEYWORD", "@why");
    this.expect("LPAREN");

    let target: WhyTargetNode;

    if (this.check("KEYWORD", "@match")) {
      target = this.parseMatchExpr();
    } else if (this.check("KEYWORD", "@path")) {
      target = this.parsePathExpr();
    } else if (this.looksLikeEdgeExpr()) {
      target = this.parseEdgeExpr();
    } else {
      target = this.parseIdentifier();
    }

    this.expect("RPAREN");

    return this.node<WhyExprNode>(
      "WhyExpr",
      {
        target,
      },
      start,
    );
  }

  private parseHowExpr(): HowExprNode {
    const start = this.expect("KEYWORD", "@how");
    this.expect("LPAREN");

    let target: IdentifierNode | NodeCaptureNode;

    if (this.checkType("IDENT")) {
      target = this.parseIdentifier();
    } else if (this.checkType("LANGLE")) {
      target = this.parseNodeCapture();
    } else {
      throw this.error(this.peek(), "Expected identifier or node capture inside @how(...)");
    }

    this.expect("RPAREN");

    return this.node<HowExprNode>(
      "HowExpr",
      {
        target,
      },
      start,
    );
  }

  private parseWhereClause(): BooleanExprNode {
    this.expect("KEYWORD", "@where");
    this.expect("LPAREN");
    const expr = this.parseBooleanExpr();
    this.expect("RPAREN");
    return expr;
  }

  private parseWhereExpr(): WhereExprNode {
    const start = this.expect("KEYWORD", "@where");
    this.expect("LPAREN");
    const expression = this.parseBooleanExpr();
    this.expect("RPAREN");
    return this.node<WhereExprNode>(
      "WhereExpr",
      { expression },
      start,
    );
  }

  private parseWherePredicate(): WherePredicateNode {
    const start = this.expect("KEYWORD", "@where");
    this.expect("LPAREN");
    const expression = this.parseBooleanExpr();
    this.expect("RPAREN");
    return this.node<WherePredicateNode>(
      "WherePredicate",
      { expression },
      start,
    );
  }

  private parseGraphQueryExpr(): GraphQueryExprNode {
    const start = this.expect("KEYWORD", "@query");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let subject: IdentifierNode | null = null;
    let relation: StringLiteralNode | null = null;
    let object: IdentifierNode | null = null;
    let node: IdentifierNode | null = null;
    let state: StringLiteralNode | null = null;
    let meta: StringLiteralNode | null = null;
    let equals: ValueExprNode | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @query field name");
      }

      const fieldToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (fieldToken.value) {
        case "subject":
          if (subject !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "subject"');
          }
          subject = this.parseIdentifier();
          break;

        case "relation":
          if (relation !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "relation"');
          }
          relation = this.parseStringLiteral();
          break;

        case "object":
          if (object !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "object"');
          }
          object = this.parseIdentifier();
          break;

        case "node":
          if (node !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "node"');
          }
          node = this.parseIdentifier();
          break;

        case "state":
          if (state !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "state"');
          }
          state = this.parseStringLiteral();
          break;

        case "meta":
          if (meta !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "meta"');
          }
          meta = this.parseStringLiteral();
          break;

        case "equals":
          if (equals !== null) {
            throw this.error(fieldToken, 'Duplicate @query field "equals"');
          }
          equals = this.parseValueExpr();
          break;

        default:
          throw this.error(fieldToken, `Unknown @query field "${fieldToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<GraphQueryExprNode>(
      "GraphQueryExpr",
      {
        name: "@query",
        subject,
        relation,
        object,
        node,
        state,
        meta,
        equals,
      },
      start,
    );
  }

  private parseLoopExpr(): LoopExprNode {
    const start = this.expect("KEYWORD", "@loop");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let until: GraphQueryExprNode | null = null;
    let count: LoopCountExprNode | null = null;
    let pipeline: ActionPipelineStepNode[] | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @loop section name");
      }

      const sectionToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (sectionToken.value) {
        case "until":
          if (until !== null) {
            throw this.error(sectionToken, 'Duplicate @loop section "until"');
          }
          until = this.parseGraphQueryExpr();
          break;

        case "count":
          if (count !== null) {
            throw this.error(sectionToken, 'Duplicate @loop section "count"');
          }
          count = this.parseLoopCountExpr();
          break;

        case "pipeline":
          if (pipeline !== null) {
            throw this.error(sectionToken, 'Duplicate @loop section "pipeline"');
          }
          pipeline = this.parseActionPipelineSection();
          break;

        default:
          throw this.error(sectionToken, `Unknown @loop section "${sectionToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<LoopExprNode>(
      "LoopExpr",
      {
        name: "@loop",
        until,
        count,
        pipeline: pipeline ?? [],
      },
      start,
    );
  }

  private parseIfExpr(): IfExprNode {
    const start = this.expect("KEYWORD", "@if");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let condition: GraphControlExprNode | null = null;
    let thenPipeline: GraphPipelineStepNode[] | null = null;
    let elsePipeline: GraphPipelineStepNode[] | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @if section name");
      }

      const sectionToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (sectionToken.value) {
        case "condition":
          if (condition !== null) {
            throw this.error(sectionToken, 'Duplicate @if section "condition"');
          }
          condition = this.parseGraphControlExpr();
          break;

        case "then":
          if (thenPipeline !== null) {
            throw this.error(sectionToken, 'Duplicate @if section "then"');
          }
          thenPipeline = this.parseGraphPipelineSection();
          break;

        case "else":
          if (elsePipeline !== null) {
            throw this.error(sectionToken, 'Duplicate @if section "else"');
          }
          elsePipeline = this.parseGraphPipelineSection();
          break;

        default:
          throw this.error(sectionToken, `Unknown @if section "${sectionToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<IfExprNode>(
      "IfExpr",
      {
        name: "@if",
        condition,
        then: thenPipeline ?? [],
        else: elsePipeline,
      },
      start,
    );
  }

  private parseWhenExpr(): WhenExprNode {
    const start = this.expect("KEYWORD", "@when");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let event: GraphControlExprNode | null = null;
    let pipeline: GraphPipelineStepNode[] | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @when section name");
      }

      const sectionToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (sectionToken.value) {
        case "event":
          if (event !== null) {
            throw this.error(sectionToken, 'Duplicate @when section "event"');
          }
          event = this.parseGraphControlExpr();
          break;

        case "pipeline":
          if (pipeline !== null) {
            throw this.error(sectionToken, 'Duplicate @when section "pipeline"');
          }
          pipeline = this.parseGraphPipelineSection();
          break;

        default:
          throw this.error(sectionToken, `Unknown @when section "${sectionToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<WhenExprNode>(
      "WhenExpr",
      {
        name: "@when",
        event,
        pipeline: pipeline ?? [],
      },
      start,
    );
  }

  private parseGraphControlExpr(): GraphControlExprNode {
    if (this.check("KEYWORD", "@query")) {
      return this.parseGraphQueryExpr();
    }

    if (this.checkType("BOOLEAN")) {
      return this.parseBooleanLiteral();
    }

    throw this.error(this.peek(), "Expected @query or boolean literal");
  }

  private parseLoopCountExpr(): LoopCountExprNode {
    if (this.checkType("NUMBER")) {
      return this.parseNumberLiteral();
    }

    if (this.check("KEYWORD", "@derive.state")) {
      return this.parseDeriveStateExpr();
    }

    if (this.check("KEYWORD", "@derive.meta")) {
      return this.parseDeriveMetaExpr();
    }

    throw this.error(this.peek(), "Expected number literal or @derive.* expression for @loop count");
  }

  private parseDeriveStateExpr(): DeriveStateExprNode {
    const start = this.expect("KEYWORD", "@derive.state");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let node: IdentifierNode | null = null;
    let key: StringLiteralNode | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @derive.state field name");
      }

      const fieldToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (fieldToken.value) {
        case "node":
          if (node !== null) {
            throw this.error(fieldToken, 'Duplicate @derive.state field "node"');
          }
          node = this.parseIdentifier();
          break;

        case "key":
          if (key !== null) {
            throw this.error(fieldToken, 'Duplicate @derive.state field "key"');
          }
          key = this.parseStringLiteral();
          break;

        default:
          throw this.error(fieldToken, `Unknown @derive.state field "${fieldToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<DeriveStateExprNode>(
      "DeriveStateExpr",
      {
        name: "@derive.state",
        node,
        key,
      },
      start,
    );
  }

  private parseDeriveMetaExpr(): DeriveMetaExprNode {
    const start = this.expect("KEYWORD", "@derive.meta");
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    let node: IdentifierNode | null = null;
    let key: StringLiteralNode | null = null;

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @derive.meta field name");
      }

      const fieldToken = this.expectType("IDENT");
      this.expect("COLON");
      this.skipNewlines();

      switch (fieldToken.value) {
        case "node":
          if (node !== null) {
            throw this.error(fieldToken, 'Duplicate @derive.meta field "node"');
          }
          node = this.parseIdentifier();
          break;

        case "key":
          if (key !== null) {
            throw this.error(fieldToken, 'Duplicate @derive.meta field "key"');
          }
          key = this.parseStringLiteral();
          break;

        default:
          throw this.error(fieldToken, `Unknown @derive.meta field "${fieldToken.value}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    return this.node<DeriveMetaExprNode>(
      "DeriveMetaExpr",
      {
        name: "@derive.meta",
        node,
        key,
      },
      start,
    );
  }

  private parseRelationPattern(): RelationPatternNode {
    const left = this.parsePatternAtom();
    this.expect("COLON");
    const relation = this.parsePatternAtom();
    this.expect("COLON");
    const right = this.parsePatternAtom();

    return this.node<RelationPatternNode>(
      "RelationPattern",
      {
        left,
        relation,
        right,
      },
      atomToToken(left),
    );
  }

  private parsePatternAtom() {
    if (this.checkType("WILDCARD")) return this.parseWildcard();
    if (this.checkType("REGEX")) return this.parseRegexLiteral();
    if (this.checkType("STRING")) return this.parseStringLiteral();
    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("BOOLEAN")) return this.parseBooleanLiteral();
    if (this.checkType("LANGLE")) return this.parseNodeCapture();
    if (this.checkType("IDENT")) return this.parseIdentifier();

    throw this.error(this.peek(), "Expected pattern atom");
  }

  private parseValueExpr(): ValueExprNode {
    if (this.check("KEYWORD", "@where")) return this.parseWhereExpr();
    if (this.checkType("IDENT")) return this.parseIdentifier();
    if (this.checkType("STRING")) return this.parseStringLiteral();
    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("BOOLEAN")) return this.parseBooleanLiteral();
    if (this.checkType("LANGLE")) return this.parseNodeCapture();
    if (this.checkType("LBRACE")) return this.parseObjectLiteral();
    if (this.checkType("LBRACKET")) return this.parseArrayLiteral();

    throw this.error(this.peek(), "Expected value expression");
  }

  private parseDeriveExpr(): DeriveExprNode {
    return this.parseDeriveAddition();
  }

  private parseDeriveAddition(): DeriveExprNode {
    let expr = this.parseDeriveMultiplication();

    while (this.checkType("PLUS") || this.checkType("MINUS")) {
      const operator = this.advance();
      const right = this.parseDeriveMultiplication();
      expr = this.node<DeriveBinaryExprNode>(
        "DeriveBinaryExpr",
        {
          operator: operator.value as DeriveBinaryExprNode["operator"],
          left: expr,
          right,
        },
        operator,
      );
    }

    return expr;
  }

  private parseDeriveMultiplication(): DeriveExprNode {
    let expr = this.parseDerivePrimary();

    while (this.checkType("STAR") || this.checkType("SLASH")) {
      const operator = this.advance();
      const right = this.parseDerivePrimary();
      expr = this.node<DeriveBinaryExprNode>(
        "DeriveBinaryExpr",
        {
          operator: operator.value as DeriveBinaryExprNode["operator"],
          left: expr,
          right,
        },
        operator,
      );
    }

    return expr;
  }

  private parseDerivePrimary(): DeriveExprNode {
    if (this.checkType("IDENT")) {
      if (this.peek().value === "current") {
        const token = this.expectType("IDENT");
        return this.node<CurrentValueNode>(
          "CurrentValue",
          {
            name: "current",
          },
          token,
        );
      }

      if (this.peek().value === "previous") {
        const token = this.expectType("IDENT");
        return this.node<PreviousValueNode>(
          "PreviousValue",
          {
            name: "previous",
          },
          token,
        );
      }
    }

    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("STRING")) return this.parseStringLiteral();

    throw this.error(this.peek(), "Expected derive expression");
  }

  private parseOperatorExpr(): OperatorExprNode {
    const keyword = this.expectType("KEYWORD");

    switch (keyword.value) {
      case "@action":
        return this.parseActionExpr(keyword);
      case "@ctx":
        return this.parseCtxExpr(keyword);
      case "@project":
        return this.parseProjectExpr(keyword);
      default:
        throw this.error(
          keyword,
          `Expected operator expression, got "${keyword.value}"`,
        );
    }
  }

  private parseActionExpr(startToken?: Token): ActionExprNode {
    const start = startToken ?? this.expect("KEYWORD", "@action");
    let guard: ActionGuardExprNode | null = null;
    let pipeline: ActionPipelineStepNode[] | null = null;
    let project: ActionProjectExprNode | null = null;

    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();

    while (!this.checkType("RBRACE")) {
      if (!(this.checkType("IDENT") && this.peekNext().type === "COLON")) {
        throw this.error(this.peek(), "Expected @action section name");
      }

      const sectionToken = this.expectType("IDENT");
      const section = sectionToken.value;
      this.expect("COLON");
      this.skipNewlines();

      switch (section) {
        case "guard":
          if (guard !== null) {
            throw this.error(sectionToken, `Duplicate @action section "${section}"`);
          }
          guard = this.parseActionGuardExpr();
          break;
        case "pipeline":
          if (pipeline !== null) {
            throw this.error(sectionToken, `Duplicate @action section "${section}"`);
          }
          pipeline = this.parseActionPipelineSection();
          break;
        case "project":
          if (project !== null) {
            throw this.error(sectionToken, `Duplicate @action section "${section}"`);
          }
          project = this.parseActionProjectSection();
          break;
        default:
          throw this.error(sectionToken, `Unknown @action section "${section}"`);
      }

      this.skipNewlines();
    }

    this.expect("RBRACE");

    if (pipeline === null) {
      throw this.error(start, `@action requires a pipeline section`);
    }

    return this.node<ActionExprNode>(
      "ActionExpr",
      {
        name: "@action",
        guard,
        pipeline,
        project,
      },
      start,
    );
  }

  private parseActionGuardExpr(): ActionGuardExprNode {
    if (this.check("KEYWORD", "@query")) {
      return this.parseGraphQueryExpr();
    }

    return this.parseBooleanExpr();
  }

  private parseActionPipelineSection(): ActionPipelineStepNode[] {
    const pipeline: ActionPipelineStepNode[] = [];

    this.skipNewlines();

    while (this.match("ARROW")) {
      pipeline.push(this.parseActionPipelineStep());
      this.skipNewlines();
    }

    if (pipeline.length === 0) {
      throw this.error(this.peek(), "@action pipeline must contain at least one step");
    }

    return pipeline;
  }

  private parseActionPipelineStep(): ActionPipelineStepNode {
    if (this.check("KEYWORD", "@loop")) {
      return this.parseLoopExpr();
    }

    return this.parseGraphPipelineStep();
  }

  private parseGraphPipelineSection(): GraphPipelineStepNode[] {
    const pipeline: GraphPipelineStepNode[] = [];

    this.skipNewlines();

    while (this.match("ARROW")) {
      pipeline.push(this.parseGraphPipelineStep());
      this.skipNewlines();
    }

    if (pipeline.length === 0) {
      throw this.error(this.peek(), "Pipeline must contain at least one step");
    }

    return pipeline;
  }

  private parseActionProjectSection(): ActionProjectExprNode {
    return this.parseValueExpr() as ActionProjectExprNode;
  }

  private parseCtxExpr(startToken?: Token): CtxExprNode {
    const start = startToken ?? this.expect("KEYWORD", "@ctx");
    this.expect("LPAREN");
    const args = this.parseArguments();
    this.expect("RPAREN");

    return this.node<CtxExprNode>(
      "CtxExpr",
      {
        name: "@ctx",
        args,
      },
      start,
    );
  }

  private parseProjectExpr(startToken?: Token): ProjectExprNode {
    const start = startToken ?? this.expect("KEYWORD", "@project");
    let syntax: ProjectExprNode["syntax"];
    let args: ArgumentNode[];

    if (this.match("LPAREN")) {
      syntax = "inline";
      args = this.parseArguments();
      this.expect("RPAREN");
    } else if (this.match("LBRACE")) {
      syntax = "block";
      args = this.parseProjectBlockArguments();
      this.expect("RBRACE");
    } else {
      throw this.error(this.peek(), 'Expected "(" or "{" after @project');
    }

    return this.node<ProjectExprNode>(
      "ProjectExpr",
      {
        name: "@project",
        syntax,
        args,
      },
      start,
    );
  }

  private parseProjectBlockArguments(): ArgumentNode[] {
    const args: ArgumentNode[] = [];
    this.skipNewlines();

    while (!this.checkType("RBRACE")) {
      const start = this.peek();

      if (!this.checkType("IDENT") || this.peekNext().type !== "COLON") {
        throw this.error(this.peek(), "@project block fields must use key: value syntax");
      }

      const key = this.parseIdentifier();
      this.expect("COLON");
      const value = this.parseValueExpr();
      args.push(this.node<ArgumentNode>("Argument", { key, value }, start));

      if (this.match("COMMA")) {
        this.skipNewlines();
        continue;
      }

      if (this.checkType("RBRACE")) {
        break;
      }

      if (this.match("NEWLINE")) {
        this.skipNewlines();
        continue;
      }

      throw this.error(this.peek(), 'Expected newline, comma, or "}" in @project block');
    }

    return args;
  }

  private parseArguments(): ArgumentNode[] {
    const args: ArgumentNode[] = [];

    if (this.checkType("RPAREN")) return args;

    while (true) {
      const start = this.peek();

      if (this.checkType("IDENT") && this.peekNext().type === "COLON") {
        const key = this.parseIdentifier();
        this.expect("COLON");
        const value = this.parseValueExpr();
        args.push(this.node<ArgumentNode>("Argument", { key, value }, start));
      } else {
        const value = this.parseValueExpr();
        args.push(
          this.node<ArgumentNode>("Argument", { key: null, value }, start),
        );
      }

      if (!this.match("COMMA")) break;
    }

    return args;
  }

  private parseNodeCapture(): NodeCaptureNode {
    const start = this.expect("LANGLE");
    const shape = this.parseNodeShape();
    this.expect("RANGLE");

    return this.node<NodeCaptureNode>(
      "NodeCapture",
      {
        shape,
      },
      start,
    );
  }

  private parseNodeShape(): NodeShapeNode {
    if (this.looksLikeTraversalExpr()) {
      return this.parseTraversalExpr();
    }

    if (this.checkType("IDENT")) return this.parseIdentifier();
    if (this.checkType("STRING")) return this.parseStringLiteral();
    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("BOOLEAN")) return this.parseBooleanLiteral();
    if (this.checkType("LBRACE")) return this.parseObjectLiteral();

    throw this.error(this.peek(), "Expected node shape");
  }

  private parseTraversalExpr(): TraversalExprNode {
    const start = this.peek();
    const segments: TraversalSegmentNode[] = [];

    const first = this.parseActionSegment();
    segments.push(first);

    while (this.match("DDOT")) {
      const context = this.parseIdentifier();
      this.expect("DDOT");
      const segment = this.parseActionSegment();

      segments.push(
        this.node(
          "ContextLift",
          {
            context,
            segment,
          },
          identToToken(context),
        ),
      );
    }

    return this.node<TraversalExprNode>(
      "TraversalExpr",
      {
        segments,
      },
      start,
    );
  }

  private parseActionSegment(): ActionSegmentNode {
    const start = this.peek();
    const from = this.parseTraversalValue();
    this.expect("DOT");
    const operator = this.parseIdentifier();
    this.expect("DOT");
    const to = this.parseTraversalValue();

    return this.node<ActionSegmentNode>(
      "ActionSegment",
      {
        from,
        operator,
        to,
      },
      start,
    );
  }

  private parseTraversalValue(): ValueExprNode {
    if (this.checkType("IDENT")) return this.parseIdentifier();
    if (this.checkType("STRING")) return this.parseStringLiteral();
    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("BOOLEAN")) return this.parseBooleanLiteral();
    if (this.checkType("LANGLE")) return this.parseNodeCapture();
    if (this.checkType("LBRACE")) return this.parseObjectLiteral();

    throw this.error(this.peek(), "Expected traversal value");
  }

  private parseObjectLiteral(): ObjectLiteralNode {
    const start = this.expect("LBRACE");
    const properties: ObjectPropertyNode[] = [];

    while (!this.checkType("RBRACE")) {
      const keyToken = this.peek();

      let key: string;
      if (this.checkType("IDENT")) {
        key = this.advance().value;
      } else if (this.checkType("STRING")) {
        key = stripQuotes(this.advance().value);
      } else {
        throw this.error(this.peek(), "Expected object key");
      }

      this.expect("COLON");
      const value = this.parseValueExpr();

      properties.push(
        this.node<ObjectPropertyNode>(
          "ObjectProperty",
          {
            key,
            value,
          },
          keyToken,
        ),
      );

      if (!this.match("COMMA")) break;
    }

    this.expect("RBRACE");

    return this.node<ObjectLiteralNode>(
      "ObjectLiteral",
      {
        properties,
      },
      start,
    );
  }

  private parseArrayLiteral(): ArrayLiteralNode {
    const start = this.expect("LBRACKET");
    const elements: ValueExprNode[] = [];

    while (!this.checkType("RBRACKET")) {
      elements.push(this.parseValueExpr());
      if (!this.match("COMMA")) break;
    }

    this.expect("RBRACKET");

    return this.node<ArrayLiteralNode>(
      "ArrayLiteral",
      {
        elements,
      },
      start,
    );
  }

  private parseBooleanExpr(): BooleanExprNode {
    return this.parseOrExpr();
  }

  private parseOrExpr(): BooleanExprNode {
    let expr = this.parseAndExpr();

    while (this.matchLogical("||")) {
      const op = this.previous();
      const right = this.parseAndExpr();
      expr = this.node<BinaryBooleanExprNode>(
        "BinaryBooleanExpr",
        {
          operator: "||",
          left: expr,
          right,
        },
        op,
      );
    }

    return expr;
  }

  private parseAndExpr(): BooleanExprNode {
    let expr = this.parseNotExpr();

    while (this.matchLogical("&&")) {
      const op = this.previous();
      const right = this.parseNotExpr();
      expr = this.node<BinaryBooleanExprNode>(
        "BinaryBooleanExpr",
        {
          operator: "&&",
          left: expr,
          right,
        },
        op,
      );
    }

    return expr;
  }

  private parseNotExpr(): BooleanExprNode {
    if (this.matchLogical("!")) {
      const op = this.previous();
      const argument = this.parseNotExpr();
      return this.node<UnaryBooleanExprNode>(
        "UnaryBooleanExpr",
        {
          operator: "!",
          argument,
        },
        op,
      );
    }

    return this.parseComparisonOrPrimary();
  }

  private parseComparisonOrPrimary(): BooleanExprNode {
    if (this.match("LPAREN")) {
      const start = this.previous();
      const expression = this.parseBooleanExpr();
      this.expect("RPAREN");
      return this.node<GroupedBooleanExprNode>(
        "GroupedBooleanExpr",
        {
          expression,
        },
        start,
      );
    }

    const left = this.parseBooleanValue();

    if (this.matchComparison()) {
      const op = this.previous();
      const right = this.parseBooleanValue();
      return this.node<ComparisonExprNode>(
        "ComparisonExpr",
        {
          operator: op.value as ComparisonExprNode["operator"],
          left,
          right,
        },
        op,
      );
    }

    return left;
  }

  private parseBooleanValue(): BooleanValueNode {
    if (this.checkType("IDENT")) {
      const ident = this.parseIdentifier();

      if (this.match("DOT")) {
        const property = this.parseIdentifier();
        const chain = [property];

        while (this.match("DOT")) {
          chain.push(this.parseIdentifier());
        }

        return this.node<PropertyAccessNode>(
          "PropertyAccess",
          {
            object: ident,
            property,
            chain,
          },
          identToToken(ident),
        );
      }

      return ident;
    }

    if (this.checkType("STRING")) return this.parseStringLiteral();
    if (this.checkType("NUMBER")) return this.parseNumberLiteral();
    if (this.checkType("BOOLEAN")) return this.parseBooleanLiteral();
    if (this.checkType("REGEX")) return this.parseRegexLiteral();

    throw this.error(this.peek(), "Expected boolean value");
  }

  private parseIdentifier(): IdentifierNode {
    const token = this.expectType("IDENT");
    return this.node<IdentifierNode>(
      "Identifier",
      {
        name: token.value,
      },
      token,
    );
  }

  private parseStringLiteral(): StringLiteralNode {
    const token = this.expectType("STRING");
    return this.node<StringLiteralNode>(
      "StringLiteral",
      {
        value: stripQuotes(token.value),
        raw: token.value,
      },
      token,
    );
  }

  private parseNumberLiteral(): NumberLiteralNode {
    const token = this.expectType("NUMBER");
    return this.node<NumberLiteralNode>(
      "NumberLiteral",
      {
        value: Number(token.value),
        raw: token.value,
      },
      token,
    );
  }

  private parseBooleanLiteral(): BooleanLiteralNode {
    const token = this.expectType("BOOLEAN");
    return this.node<BooleanLiteralNode>(
      "BooleanLiteral",
      {
        value: token.value === "true",
        raw: token.value,
      },
      token,
    );
  }

  private parseRegexLiteral(): RegexLiteralNode {
    const token = this.expectType("REGEX");
    const { pattern, flags } = splitRegexLiteral(token.value);

    return this.node<RegexLiteralNode>(
      "RegexLiteral",
      {
        pattern,
        flags,
        raw: token.value,
      },
      token,
    );
  }

  private parseWildcard(): WildcardNode {
    const token = this.expectType("WILDCARD");
    return this.node<WildcardNode>(
      "Wildcard",
      {
        raw: "_",
      },
      token,
    );
  }

  /* =========================
     Helpers
     ========================= */

  private captureBraceBodyRaw(): string {
    const start = this.expect("LBRACE");
    let depth = 1;
    let raw = "{";

    while (!this.isAtEnd() && depth > 0) {
      const token = this.advance();

      if (token.type === "LBRACE") depth += 1;
      if (token.type === "RBRACE") depth -= 1;

      raw += token.value;
    }

    if (depth !== 0) {
      throw this.error(start, "Unterminated action body");
    }

    return raw;
  }

  private looksLikeTraversalExpr(): boolean {
    if (!this.isTraversalValueStart(this.peek())) return false;
    if (this.peekNext().type !== "DOT") return false;
    if (this.peekN(2).type !== "IDENT") return false;
    if (this.peekN(3).type !== "DOT") return false;
    return this.isTraversalValueStart(this.peekN(4));
  }

  private isTraversalValueStart(token: Token): boolean {
    return (
      token.type === "IDENT" ||
      token.type === "STRING" ||
      token.type === "NUMBER" ||
      token.type === "BOOLEAN" ||
      token.type === "LANGLE" ||
      token.type === "LBRACE"
    );
  }

  private looksLikeEdgeExpr(): boolean {
    return (
      this.peek().type === "IDENT" &&
      this.peekNext().type === "COLON" &&
      this.peekN(2).type === "STRING" &&
      this.peekN(3).type === "COLON" &&
      this.peekN(4).type === "IDENT"
    );
  }

  private isGraphPipelineStart(): boolean {
    return (
      this.peek().type === "IDENT" &&
      this.peekNext().type === "COLON_EQUALS" &&
      this.peekN(2).type === "KEYWORD" &&
      (this.peekN(2).value === "@seed" || this.peekN(2).value === "@compose")
    );
  }

  // Returns true when the cursor is at `IDENT` and the next non-newline token
  // is a PROJECT (`<>`) token, indicating `name = graphId <> @project(...)`.
  private isGraphProjectionExprStart(): boolean {
    if (!this.checkType("IDENT")) return false;
    let i = 1;
    while (this.peekN(i).type === "NEWLINE") i++;
    return this.peekN(i).type === "PROJECT";
  }

  private parseGraphSource(): GraphSourceNode {
    if (this.match("KEYWORD", "@seed")) {
      const token = this.previous();
      return this.node<SeedSourceNode>(
        "SeedSource",
        {
          name: "@seed",
        },
        token,
      );
    }

    if (this.match("KEYWORD", "@compose")) {
      const token = this.previous();
      this.expect("LPAREN");
      this.skipNewlines();
      this.expect("LBRACKET");
      this.skipNewlines();

      const assets: IdentifierNode[] = [];
      while (!this.checkType("RBRACKET")) {
        assets.push(this.parseIdentifier());
        this.skipNewlines();
        if (this.match("COMMA")) {
          this.skipNewlines();
          continue;
        }
        break;
      }

      this.skipNewlines();
      this.expect("RBRACKET");
      this.skipNewlines();
      this.expect("COMMA");
      this.skipNewlines();
      this.expectIdentifierValue("merge");
      this.expect("COLON");
      const merge = this.parseIdentifier();
      this.skipNewlines();
      this.expect("RPAREN");

      return this.node<ComposeExprNode>(
        "ComposeExpr",
        {
          name: "@compose",
          assets,
          merge,
        },
        token,
      );
    }

    throw this.error(this.peek(), `Expected graph source @seed or @compose(...)`);
  }

  private isSystemRelationStart(): boolean {
    if (this.peek().type !== "IDENT") return false;

    if (this.peekNext().type === "TCOLON" && this.peekN(2).type === "IDENT") {
      return true;
    }

    return (
      this.peekNext().type === "COLON" &&
      this.peekN(2).type === "STRING" &&
      this.peekN(3).type === "TCOLON" &&
      this.peekN(4).type === "IDENT"
    );
  }

  private matchComparison(): boolean {
    const token = this.peek();
    if (!["EQ2", "EQ3", "NEQ2", "NEQ3"].includes(token.type)) return false;
    this.current += 1;
    return true;
  }

  private matchLogical(expected: "&&" | "||" | "!"): boolean {
    const token = this.peek();

    if (expected === "&&" && token.type === "AND") {
      this.current += 1;
      return true;
    }

    if (expected === "||" && token.type === "OR") {
      this.current += 1;
      return true;
    }

    if (expected === "!" && token.type === "BANG") {
      this.current += 1;
      return true;
    }

    return false;
  }

  private skipNewlines(): void {
    while (this.match("NEWLINE")) {
      // consume
    }
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.peek();

    if (token.type !== type) {
      throw this.error(token, `Expected ${value ?? type}, got ${token.type}`);
    }

    if (value !== undefined && token.value !== value) {
      throw this.error(token, `Expected ${value}, got ${token.value}`);
    }

    this.current += 1;
    return token;
  }

  private expectType(type: TokenType): Token {
    return this.expect(type);
  }

  private match(type: TokenType, value?: string): boolean {
    if (!this.checkType(type)) return false;
    if (value !== undefined && this.peek().value !== value) return false;
    this.current += 1;
    return true;
  }

  private check(type: TokenType, value?: string): boolean {
    if (!this.checkType(type)) return false;
    if (value !== undefined && this.peek().value !== value) return false;
    return true;
  }

  private checkType(type: TokenType): boolean {
    if (this.isAtEnd()) return type === "EOF";
    return this.peek().type === type;
  }

  private checkTypeIdentifierValue(value: string): boolean {
    return this.checkType("IDENT") && this.peek().value === value;
  }

  private expectIdentifierValue(value: string): Token {
    const token = this.expectType("IDENT");
    if (token.value !== value) {
      throw this.error(token, `Expected ${value}, got ${token.value}`);
    }
    return token;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current += 1;
    return this.tokens[this.current - 1];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private previousOrPeek(): Token {
    return this.current > 0 ? this.previous() : this.peek();
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token {
    return this.peekN(1);
  }

  private peekN(offset: number): Token {
    return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)];
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private error(token: Token, message: string): ParseError {
    return new ParseError(message, token);
  }

  private node<T extends BaseNode>(
    type: T["type"],
    props: Omit<T, "type" | "span">,
    token: Token,
  ): T {
    return {
      type,
      ...props,
      span: {
        start: token.index,
        end: token.index + token.value.length,
        line: token.line,
        column: token.column,
      },
    } as T;
  }
}

/* =========================
   Small utilities
   ========================= */

function stripQuotes(raw: string): string {
  if (raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

function splitRegexLiteral(raw: string): { pattern: string; flags: string } {
  const lastSlash = raw.lastIndexOf("/");
  if (lastSlash <= 0) {
    return { pattern: raw, flags: "" };
  }
  return {
    pattern: raw.slice(1, lastSlash),
    flags: raw.slice(lastSlash + 1),
  };
}

function identToToken(node: IdentifierNode): Token {
  return {
    type: "IDENT",
    value: node.name,
    line: node.span?.line ?? 0,
    column: node.span?.column ?? 0,
    index: node.span?.start ?? 0,
  };
}

function atomToToken(
  node:
    | IdentifierNode
    | StringLiteralNode
    | NumberLiteralNode
    | BooleanLiteralNode
    | RegexLiteralNode
    | WildcardNode
    | NodeCaptureNode,
): Token {
  return {
    type: "IDENT",
    value: node.type,
    line: node.span?.line ?? 0,
    column: node.span?.column ?? 0,
    index: node.span?.start ?? 0,
  };
}
