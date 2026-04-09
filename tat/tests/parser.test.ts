import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../lexer/tokenize";
import { parse } from "../parser/parse";
import type {
  BindStatementNode,
  GraphInteractionDefinitionNode,
  GraphPipelineNode,
  MatchExprNode,
  PathExprNode,
  ProgramNode,
  SeedBlockNode,
  SystemRelationNode,
  ValueBindingNode,
  WhyExprNode,
} from "../ast/nodeTypes";

function parseSource(source: string): ProgramNode {
  return parse(tokenize(source));
}

test("parses simple node binding", () => {
  const ast = parseSource(`A = <Ti>`);

  assert.equal(ast.type, "Program");
  assert.equal(ast.body.length, 1);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "ValueBinding");

  const binding = stmt as ValueBindingNode;
  assert.equal(binding.name.name, "A");
  assert.equal(binding.value.type, "NodeCapture");
  assert.equal(binding.value.shape.type, "Identifier");
  assert.equal(binding.value.shape.name, "Ti");
});

test("parses object node capture", () => {
  const ast = parseSource(`node2 = <{id: "Ti", pitch: 71}>`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "ValueBinding");

  const binding = stmt as ValueBindingNode;
  assert.equal(binding.name.name, "node2");
  assert.equal(binding.value.type, "NodeCapture");
  assert.equal(binding.value.shape.type, "ObjectLiteral");
  assert.equal(binding.value.shape.properties.length, 2);
  assert.equal(binding.value.shape.properties[0].key, "id");
  assert.equal(binding.value.shape.properties[1].key, "pitch");
});

test("parses traversal node capture", () => {
  const ast = parseSource(`node1 = <A.x.B..y..C.z.D>`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "ValueBinding");

  const binding = stmt as ValueBindingNode;
  assert.equal(binding.value.type, "NodeCapture");
  assert.equal(binding.value.shape.type, "TraversalExpr");

  const traversal = binding.value.shape;
  assert.equal(traversal.segments.length, 2);

  const first = traversal.segments[0];
  assert.equal(first.type, "ActionSegment");
  assert.equal(first.from.type, "Identifier");
  assert.equal(first.from.name, "A");
  assert.equal(first.operator.name, "x");
  assert.equal(first.to.type, "Identifier");
  assert.equal(first.to.name, "B");

  const second = traversal.segments[1];
  assert.equal(second.type, "ContextLift");
  assert.equal(second.context.name, "y");
  assert.equal(second.segment.type, "ActionSegment");
  assert.equal(second.segment.from.type, "Identifier");
  assert.equal(second.segment.from.name, "C");
  assert.equal(second.segment.operator.name, "z");
  assert.equal(second.segment.to.type, "Identifier");
  assert.equal(second.segment.to.name, "D");
});

test("parses operator bindings", () => {
  const ast = parseSource(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}
y := @ctx(scope: "partWriting")
z := @project(format: "graph")
`);

  assert.equal(ast.body.length, 3);

  assert.equal(ast.body[0].type, "OperatorBinding");
  assert.equal(ast.body[1].type, "OperatorBinding");
  assert.equal(ast.body[2].type, "OperatorBinding");

  const x = ast.body[0];
  const y = ast.body[1];
  const z = ast.body[2];

  assert.equal(x.type, "OperatorBinding");
  assert.equal(x.name.name, "x");
  assert.equal(x.value.type, "ActionExpr");
  assert.equal(x.value.name, "@action");
  assert.equal(x.value.guard, null);
  assert.equal(x.value.pipeline.length, 1);
  assert.equal(x.value.pipeline[0].type, "GraftBranchExpr");
  assert.equal(x.value.project, null);

  assert.equal(y.type, "OperatorBinding");
  assert.equal(y.name.name, "y");
  assert.equal(y.value.type, "CtxExpr");
  assert.equal(y.value.args.length, 1);

  assert.equal(z.type, "OperatorBinding");
  assert.equal(z.name.name, "z");
  assert.equal(z.value.type, "ProjectExpr");
  assert.equal(z.value.syntax, "inline");
  assert.equal(z.value.args.length, 1);
});

test("parses block-form @project", () => {
  const ast = parseSource(`
hero = <{ name: "Hero" }>

view := @project {
  format: "menu"
  focus: hero
  include: [label, action, target]
}
`);

  const stmt = ast.body[1];
  assert.equal(stmt.type, "OperatorBinding");
  assert.equal(stmt.value.type, "ProjectExpr");
  assert.equal(stmt.value.syntax, "block");
  assert.equal(stmt.value.args.length, 3);
  assert.equal(stmt.value.args[0].key?.name, "format");
  assert.equal(stmt.value.args[1].key?.name, "focus");
  assert.equal(stmt.value.args[2].key?.name, "include");
});

test("rejects malformed block-form @project fields", () => {
  assert.throws(
    () =>
      parseSource(`
hero = <{ name: "Hero" }>

view := @project {
  format "menu"
  focus: hero
  include: [label, action, target]
}
`),
    /key: value syntax/,
  );
});

test("parses bind variants with optional layer and entity", () => {
  const ast = parseSource(`
@bind(x := node1)
@bind.ctx(y := node1)
@bind.state(z := node1)
@bind.meta(w := node1)
@bind.ctx.node(n := node1)
@bind.ctx.edge(e := edge1)
@bind.state.node(sn := node1)
@bind.state.edge(se := edge1)
@bind.meta.node(mn := node1)
@bind.meta.edge(me := edge1)
`);

  const statements = ast.body as BindStatementNode[];

  assert.equal(statements.length, 10);
  assert.equal(statements[0].type, "BindStatement");
  assert.equal(statements[0].layer, null);
  assert.equal(statements[0].entity, null);
  assert.equal(statements[0].name.name, "x");

  assert.equal(statements[1].layer, "ctx");
  assert.equal(statements[1].entity, null);
  assert.equal(statements[2].layer, "state");
  assert.equal(statements[3].layer, "meta");
  assert.equal(statements[4].layer, "ctx");
  assert.equal(statements[4].entity, "node");
  assert.equal(statements[5].layer, "ctx");
  assert.equal(statements[5].entity, "edge");
  assert.equal(statements[6].layer, "state");
  assert.equal(statements[6].entity, "node");
  assert.equal(statements[7].layer, "state");
  assert.equal(statements[7].entity, "edge");
  assert.equal(statements[8].layer, "meta");
  assert.equal(statements[8].entity, "node");
  assert.equal(statements[9].layer, "meta");
  assert.equal(statements[9].entity, "edge");
});

test("invalid bind variant throws", () => {
  assert.throws(() => parseSource(`@bind.node(x := y)`));
});

test("malformed bind syntax throws", () => {
  assert.throws(() => parseSource(`@bind.ctx.node(x = y)`));
});

test("mutation syntax after project is rejected", () => {
  assert.throws(() =>
    parseSource(`
A = <Ti>
node1 = <A>

@seed:
  nodes: [node1]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  <> @project(format: "graph")
  -> @graft.state(node1, "active", true)
`),
  );
});

test("parses structured @action with guard, pipeline, and project", () => {
  const ast = parseSource(`
x := @action {
  guard:
    from != to

  pipeline:
    -> @graft.branch(from, "supports", to)
    -> @graft.state(to, "visited", true)

  project:
    to
}
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "OperatorBinding");

  const binding = ast.body[0];
  assert.equal(binding.type, "OperatorBinding");
  assert.equal(binding.name.name, "x");
  assert.equal(binding.value.type, "ActionExpr");
  assert.equal(binding.value.name, "@action");
  assert.ok(binding.value.guard);
  assert.equal(binding.value.guard?.type, "ComparisonExpr");
  assert.equal(binding.value.pipeline.length, 2);
  assert.equal(binding.value.pipeline[0].type, "GraftBranchExpr");
  assert.equal(binding.value.pipeline[1].type, "GraftStateExpr");
  assert.ok(binding.value.project);
  assert.equal(binding.value.project?.type, "Identifier");
  assert.equal(binding.value.project?.name, "to");
});

test("@action section order does not matter", () => {
  const ast = parseSource(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)

  project:
    to

  guard:
    from != to
}
`);

  const binding = ast.body[0];
  assert.equal(binding.type, "OperatorBinding");
  assert.equal(binding.name.name, "x");
  assert.equal(binding.value.type, "ActionExpr");
  assert.ok(binding.value.guard);
  assert.equal(binding.value.guard?.type, "ComparisonExpr");
  assert.equal(binding.value.pipeline.length, 1);
  assert.equal(binding.value.pipeline[0].type, "GraftBranchExpr");
  assert.ok(binding.value.project);
  assert.equal(binding.value.project?.type, "Identifier");
  assert.equal(binding.value.project?.name, "to");
});

test("@action without pipeline section throws", () => {
  assert.throws(() =>
    parseSource(`
x := @action {
  guard:
    from != to

  project:
    to
}
`),
  );
});

test("parses @if inside an action pipeline", () => {
  const ast = parseSource(`
finish := @action {
  pipeline:
    -> @if {
      condition: @query {
        node: to
        state: "hp"
        equals: 0
      }
      then:
        -> @graft.meta(to, "status", defeated)
      else:
        -> @graft.branch(from, "presses-on", to)
    }
}
`);

  const binding = ast.body[0];
  assert.equal(binding.type, "OperatorBinding");
  assert.equal(binding.value.type, "ActionExpr");
  assert.equal(binding.value.pipeline.length, 1);
  assert.equal(binding.value.pipeline[0].type, "IfExpr");

  const ifExpr = binding.value.pipeline[0];
  assert.equal(ifExpr.condition?.type, "GraphQueryExpr");
  assert.equal(ifExpr.then.length, 1);
  assert.equal(ifExpr.then[0].type, "GraftMetaExpr");
  assert.equal(ifExpr.else?.length, 1);
  assert.equal(ifExpr.else?.[0].type, "GraftBranchExpr");
});

test("parses top-level @when registration", () => {
  const ast = parseSource(`
@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", defeated)
}
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "WhenExpr");
  assert.equal(ast.body[0].event?.type, "GraphQueryExpr");
  assert.equal(ast.body[0].pipeline.length, 1);
  assert.equal(ast.body[0].pipeline[0].type, "GraftMetaExpr");
});

test("parses @query guard and @loop with derive count", () => {
  const ast = parseSource(`
attack := @action {
  guard:
    @query {
      subject: from
      relation: "can"
      object: to
    }

  pipeline:
    -> @loop {
      until: @query {
        node: to
        state: "done"
        equals: true
      }
      count: @derive.state {
        node: to
        key: "hp"
      }
      pipeline:
        -> @apply(<from.attack.to>)
    }
}
`);

  const binding = ast.body[0];
  assert.equal(binding.type, "OperatorBinding");
  assert.equal(binding.value.type, "ActionExpr");
  assert.ok(binding.value.guard);
  assert.equal(binding.value.guard?.type, "GraphQueryExpr");
  assert.equal(binding.value.pipeline.length, 1);
  assert.equal(binding.value.pipeline[0].type, "LoopExpr");

  const loop = binding.value.pipeline[0];
  assert.equal(loop.type, "LoopExpr");
  assert.ok(loop.until);
  assert.equal(loop.until?.type, "GraphQueryExpr");
  assert.ok(loop.count);
  assert.equal(loop.count?.type, "DeriveStateExpr");
  assert.equal(loop.pipeline.length, 1);
  assert.equal(loop.pipeline[0].type, "ApplyExpr");
});

test("@action with unknown section throws", () => {
  assert.throws(() =>
    parseSource(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)

  unknown:
    to
}
`),
  );
});

test("parses @seed block", () => {
  const ast = parseSource(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1
`);

  const seedStmt = ast.body[4];
  assert.equal(seedStmt.type, "SeedBlock");

  const seed = seedStmt as SeedBlockNode;
  assert.equal(seed.nodes.length, 2);
  assert.equal(seed.nodes[0].ref.name, "node1");
  assert.equal(seed.nodes[1].ref.name, "node2");

  assert.equal(seed.edges.length, 1);
  const seedEdge = seed.edges[0].type === "SeedEdgeBinding" ? seed.edges[0].edge : seed.edges[0];
  assert.equal(seedEdge.left.name, "node1");
  assert.equal(seedEdge.relation.value, "supports");
  assert.equal(seedEdge.right.name, "node2");

  assert.equal(seed.state.type, "ObjectLiteral");
  assert.equal(seed.meta.type, "ObjectLiteral");
  assert.equal(seed.root.name, "node1");
});

test("parses graph pipeline with mutations and projection", () => {
  const ast = parseSource(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @graft.branch(node1, "supports", node2)
  -> @graft.state(node1, "active", true)
  -> @graft.meta(node2, "priority", "high")
  -> @graft.progress(node1, "transitionsTo", node2)
  <> @project(format: "graph")
`);

  const pipelineStmt = ast.body[5];
  assert.equal(pipelineStmt.type, "GraphPipeline");

  const pipeline = pipelineStmt as GraphPipelineNode;
  assert.equal(pipeline.name.name, "graph1");
  assert.equal(pipeline.source.name, "@seed");
  assert.equal(pipeline.mutations.length, 4);
  assert.equal(pipeline.mutations[0].type, "GraftBranchExpr");
  assert.equal(pipeline.mutations[1].type, "GraftStateExpr");
  assert.equal(pipeline.mutations[2].type, "GraftMetaExpr");
  assert.equal(pipeline.mutations[3].type, "GraftProgressExpr");
  assert.ok(pipeline.projection);
  assert.equal(pipeline.projection?.type, "ProjectExpr");
  assert.equal(pipeline.projection?.syntax, "inline");
});

test("parses system relation :::", () => {
  const ast = parseSource(`
graph1 ::: graph2
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "SystemRelation");

  const relation = stmt as SystemRelationNode;
  assert.equal(relation.left.name, "graph1");
  assert.equal(relation.relation, null);
  assert.equal(relation.right.name, "graph2");
});

test("parses explicit system relation", () => {
  const ast = parseSource(`
graph1 : "comparesTo" ::: graph2
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "SystemRelation");

  const relation = stmt as SystemRelationNode;
  assert.equal(relation.left.name, "graph1");
  assert.ok(relation.relation);
  assert.equal(relation.relation?.value, "comparesTo");
  assert.equal(relation.right.name, "graph2");
});

test("parses @match query", () => {
  const ast = parseSource(`
@match(X : "supports" : Y)
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  assert.equal(stmt.expr.type, "MatchExpr");

  const match = stmt.expr as MatchExprNode;
  assert.equal(match.patterns.length, 1);
  assert.equal(match.patterns[0].left.type, "Identifier");
  assert.equal(match.patterns[0].left.name, "X");
  assert.equal(match.patterns[0].relation.type, "StringLiteral");
  assert.equal(match.patterns[0].relation.value, "supports");
  assert.equal(match.patterns[0].right.type, "Identifier");
  assert.equal(match.patterns[0].right.name, "Y");
  assert.equal(match.where, null);
});

test("parses @match with @where", () => {
  const ast = parseSource(`
@match(X : "supports" : Y)
@where(Y.priority == "high" && Y.active === true)
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  assert.equal(stmt.expr.type, "MatchExpr");

  const match = stmt.expr as MatchExprNode;
  assert.ok(match.where);
  assert.equal(match.where?.type, "BinaryBooleanExpr");
  assert.equal(match.where?.operator, "&&");
});

test("parses @path query", () => {
  const ast = parseSource(`
@path(node1, node2)
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  assert.equal(stmt.expr.type, "PathExpr");

  const path = stmt.expr as PathExprNode;
  assert.equal(path.from.type, "Identifier");
  assert.equal(path.from.name, "node1");
  assert.equal(path.to.type, "Identifier");
  assert.equal(path.to.name, "node2");
  assert.equal(path.where, null);
});

test("parses standalone @where query", () => {
  const ast = parseSource(`
@where(node.state.active == true)
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  assert.equal(stmt.expr.type, "WhereExpr");
  assert.equal(stmt.expr.expression.type, "ComparisonExpr");
});

test("parses @why query with edge target", () => {
  const ast = parseSource(`
@why(node1 : "supports" : node2)
`);

  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  assert.equal(stmt.expr.type, "WhyExpr");

  const why = stmt.expr as WhyExprNode;
  assert.equal(why.target.type, "EdgeExpr");
  assert.equal(why.target.left.name, "node1");
  assert.equal(why.target.relation.value, "supports");
  assert.equal(why.target.right.name, "node2");
});

test("parses multiple top-level statements in order", () => {
  const ast = parseSource(`
A = <Ti>
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

@seed:
  nodes: [A]
  edges: []
  state: {}
  meta: {}
  root: A

graph1 := @seed
  <> @project(format: "graph")

@match(X : "supports" : Y)
graph1 ::: graph1
`);

  assert.equal(ast.body.length, 6);
  assert.equal(ast.body[0].type, "ValueBinding");
  assert.equal(ast.body[1].type, "OperatorBinding");
  assert.equal(ast.body[2].type, "SeedBlock");
  assert.equal(ast.body[3].type, "GraphPipeline");
  assert.equal(ast.body[4].type, "QueryStatement");
  assert.equal(ast.body[5].type, "SystemRelation");
});

test("parses single import declaration", () => {
  const ast = parseSource(`import { identityGraph } from "./domains/identity.tat"`);
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "ImportDeclaration");
  const stmt = ast.body[0];
  if (stmt.type !== "ImportDeclaration") throw new Error("expected import");
  assert.equal(stmt.specifiers.length, 1);
  assert.equal(stmt.specifiers[0].imported.name, "identityGraph");
  assert.equal(stmt.specifiers[0].local.name, "identityGraph");
  assert.equal(stmt.source.value, "./domains/identity.tat");
});

test("parses multiline import list with alias and trailing comma", () => {
  const ast = parseSource(`
import {
  identityGraph as identity,
  abilityGraph as abilities,
  combatGraph,
} from "./domains/core.tat"
`);
  assert.equal(ast.body.length, 1);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "ImportDeclaration");
  if (stmt.type !== "ImportDeclaration") throw new Error("expected import");
  assert.equal(stmt.specifiers.length, 3);
  assert.equal(stmt.specifiers[0].imported.name, "identityGraph");
  assert.equal(stmt.specifiers[0].local.name, "identity");
  assert.equal(stmt.specifiers[1].imported.name, "abilityGraph");
  assert.equal(stmt.specifiers[1].local.name, "abilities");
  assert.equal(stmt.specifiers[2].imported.name, "combatGraph");
  assert.equal(stmt.specifiers[2].local.name, "combatGraph");
});

test("parses single export declaration", () => {
  const ast = parseSource(`export identityGraph`);
  assert.equal(ast.body.length, 1);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "ExportDeclaration");
  if (stmt.type !== "ExportDeclaration") throw new Error("expected export");
  assert.equal(stmt.specifiers.length, 1);
  assert.equal(stmt.specifiers[0].local.name, "identityGraph");
});

test("parses braced export declaration", () => {
  const ast = parseSource(`export { character_root, identityGraph, characterHeaderProjection }`);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "ExportDeclaration");
  if (stmt.type !== "ExportDeclaration") throw new Error("expected export");
  assert.deepEqual(
    stmt.specifiers.map((item) => item.local.name),
    ["character_root", "identityGraph", "characterHeaderProjection"],
  );
});

test("parses @compose graph source", () => {
  const ast = parseSource(`
appGraph := @compose([
  graphA,
  graphB,
], merge: character_root)
  <> @project(format: "graph")
`);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "GraphPipeline");
  if (stmt.type !== "GraphPipeline") throw new Error("expected graph pipeline");
  assert.equal(stmt.source.type, "ComposeExpr");
  if (stmt.source.type !== "ComposeExpr") throw new Error("expected compose");
  assert.deepEqual(stmt.source.assets.map((asset) => asset.name), ["graphA", "graphB"]);
  assert.equal(stmt.source.merge.name, "character_root");
});

test("parses @prune.nodes(@where(...)) and @prune.edges(@where(...))", () => {
  const ast = parseSource(`
graph1 := @seed
  -> @prune.nodes(@where(type == "option" && state.selected == false))
  -> @prune.edges(@where(source == class_fighter && rel == "grantsFeature"))
`);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "GraphPipeline");
  if (stmt.type !== "GraphPipeline") throw new Error("expected graph pipeline");
  assert.equal(stmt.mutations[0].type, "PruneNodesExpr");
  assert.equal(stmt.mutations[1].type, "PruneEdgesExpr");
});

test("parses named graph interaction definitions with @effect ops", () => {
  const ast = parseSource(`
attack := @graph(hero) : "attacks" : @graph(enemy)
  -> @effect(
    target: root,
    ops: [
      @graft.state("has", "poison"),
      @derive.state("hp", current - 1)
    ]
  )
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "GraphInteractionDefinition");

  const interaction = ast.body[0] as GraphInteractionDefinitionNode;
  assert.equal(interaction.name?.name, "attack");
  assert.equal(interaction.subject.graphId.name, "hero");
  assert.equal(interaction.relation.value, "attacks");
  assert.equal(interaction.object.graphId.name, "enemy");
  assert.equal(interaction.effect.target.type, "RootTarget");
  assert.equal(interaction.effect.ops.length, 2);
  assert.equal(interaction.effect.ops[0].type, "EffectGraftStateOp");
  assert.equal(interaction.effect.ops[1].type, "EffectDeriveStateOp");

  const derive = interaction.effect.ops[1];
  assert.equal(derive.type, "EffectDeriveStateOp");
  assert.equal(derive.expression.type, "DeriveBinaryExpr");
  assert.equal(derive.expression.operator, "-");
});

test("parses unnamed graph interaction definitions with explicit target node", () => {
  const ast = parseSource(`
@graph(cleric) : "heals" : @graph(hero)
  -> @effect(
    target: hero_root,
    ops: [
      @derive.state("hp", previous + 2)
    ]
  )
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "GraphInteractionDefinition");

  const interaction = ast.body[0] as GraphInteractionDefinitionNode;
  assert.equal(interaction.name, null);
  assert.equal(interaction.effect.target.type, "Identifier");
  if (interaction.effect.target.type !== "Identifier") {
    throw new Error("expected explicit target identifier");
  }
  assert.equal(interaction.effect.target.name, "hero_root");
  assert.equal(interaction.effect.ops[0].type, "EffectDeriveStateOp");
});

test("parses block-form menu projection on graph pipeline", () => {
  const ast = parseSource(`
world := @seed
  <> @project {
    format: "menu"
    focus: heroNode
    include: [id, label, action, target, status]
  }
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "GraphPipeline");

  const pipeline = ast.body[0] as GraphPipelineNode;
  assert.ok(pipeline.projection, "expected projection to be parsed");
  assert.equal(pipeline.projection!.name, "@project");
  assert.equal(pipeline.projection!.syntax, "block");

  const args = pipeline.projection!.args;
  const formatArg = args.find((a) => a.key?.name === "format");
  const focusArg = args.find((a) => a.key?.name === "focus");
  const includeArg = args.find((a) => a.key?.name === "include");

  assert.ok(formatArg, "expected format arg");
  assert.ok(focusArg, "expected focus arg");
  assert.ok(includeArg, "expected include arg");

  assert.equal(formatArg!.value.type, "StringLiteral");
  if (formatArg!.value.type === "StringLiteral") {
    assert.equal(formatArg!.value.value, "menu");
  }

  assert.equal(focusArg!.value.type, "Identifier");
  if (focusArg!.value.type === "Identifier") {
    assert.equal(focusArg!.value.name, "heroNode");
  }

  assert.equal(includeArg!.value.type, "ArrayLiteral");
  if (includeArg!.value.type === "ArrayLiteral") {
    assert.equal(includeArg!.value.elements.length, 5);
  }
});

test("parses inline graph projection: name = graphId <> @project(format: ...)", () => {
  const ast = parseSource(`battleGraph = battle <> @project(format: "graph")`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "GraphProjection");

  const stmt = ast.body[0] as import("../ast/nodeTypes").GraphProjectionNode;
  assert.equal(stmt.name.name, "battleGraph");
  assert.equal(stmt.source.name, "battle");
  assert.equal(stmt.projection.name, "@project");
  assert.equal(stmt.projection.syntax, "inline");

  const formatArg = stmt.projection.args.find((a) => a.key?.name === "format");
  assert.ok(formatArg);
  assert.equal(formatArg!.value.type, "StringLiteral");
  if (formatArg!.value.type === "StringLiteral") {
    assert.equal(formatArg!.value.value, "graph");
  }
});

test("parses multiline block-form graph projection: name = graphId <newline> <> @project { ... }", () => {
  const ast = parseSource(`
battleMenu = battle
  <> @project {
    format: "menu"
    focus: heroNode
    include: [id, label, action, target, status]
  }
`);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, "GraphProjection");

  const stmt = ast.body[0] as import("../ast/nodeTypes").GraphProjectionNode;
  assert.equal(stmt.name.name, "battleMenu");
  assert.equal(stmt.source.name, "battle");
  assert.equal(stmt.projection.syntax, "block");

  const formatArg = stmt.projection.args.find((a) => a.key?.name === "format");
  assert.ok(formatArg);
  if (formatArg!.value.type === "StringLiteral") {
    assert.equal(formatArg!.value.value, "menu");
  }
});
