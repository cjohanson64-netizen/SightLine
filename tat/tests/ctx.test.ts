import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

test("ctx.set assigns context to named edge", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(e1, "voiceLeading")
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.equal(edge.id, "e1");
  assert.equal(edge.context, "voiceLeading");
});

test("ctx.set overwrites existing context", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(e1, "voiceLeading")
  -> @ctx.set(e1, "partWriting")
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.equal(edge.context, "partWriting");
});

test("ctx.clear removes edge context", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(e1, "voiceLeading")
  -> @ctx.clear(e1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.equal(edge.context, null);
});

test("ctx.set accepts object literal context", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(e1, { scope: "voiceLeading", strict: true })
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.ok(edge.context && typeof edge.context === "object" && !Array.isArray(edge.context));
  if (edge.context && typeof edge.context === "object" && !Array.isArray(edge.context)) {
    assert.equal(edge.context.scope, "voiceLeading");
    assert.equal(edge.context.strict, true);
  }
});

test("ctx.clear on edge with no context leaves it null", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.clear(e1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.equal(edge.context, null);
});

test("ctx.set throws for unknown edge id", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(missingEdge, "voiceLeading")
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /missingEdge/);
      return true;
    },
  );
});

test("ctx.clear throws for unknown edge id", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.clear(missingEdge)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /missingEdge/);
      return true;
    },
  );
});

test("ctx mutations preserve edge subject relation object", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>

@seed:
  nodes: [node1, node2]
  edges: [
    e1 := [node1 : "supports" : node2]
  ]
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @ctx.set(e1, "voiceLeading")
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const edge = graph.edges[0];
  assert.ok(edge);
  assert.equal(edge.subject, "node1");
  assert.equal(edge.relation, "supports");
  assert.equal(edge.object, "node2");
  assert.equal(edge.context, "voiceLeading");
  assert.equal(graph.history[1].op, "@ctx.set");
});
