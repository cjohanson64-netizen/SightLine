import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

test("apply executes action from inline traversal capture", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

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
  -> @apply(<node1.x.node2>)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, "supports");
  assert.equal(graph.edges[0].subject, "node1");
  assert.equal(graph.edges[0].object, "node2");
});

test("apply executes action from traversal binding identifier", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.x.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(step1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, "supports");
  assert.equal(graph.edges[0].subject, "node1");
  assert.equal(graph.edges[0].object, "node2");
});

test("apply respects action guard and does not run when guard fails", () => {
  const result = executeTat(`
x := @action {
  guard:
    from != to

  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
node1 = <A>
step1 = <node1.x.node1>

@seed:
  nodes: [node1]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(step1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  assert.equal(graph.edges.length, 0);
});

test("apply can execute action pipeline with state mutation", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.state(to, "visited", true)
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.x.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(step1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const node2 = graph.nodes.get("node2");
  assert.ok(node2);
  assert.equal(node2.state.visited, true);
});

test("apply can execute action pipeline with meta mutation", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.meta(to, "priority", "high")
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.x.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(step1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);

  const node2 = graph.nodes.get("node2");
  assert.ok(node2);
  assert.equal(node2.meta.priority, "high");
});

test("apply throws if target does not resolve to traversal", () => {
  assert.throws(
    () =>
      executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
node1 = <A>

@seed:
  nodes: [node1]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(node1)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@apply target must resolve to a traversal value/);
      return true;
    },
  );
});

test("apply throws if traversal step is missing refs", () => {
  assert.throws(
    () =>
      executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
node1 = <A>

@seed:
  nodes: [node1]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(<"A".x."B">)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("@apply traversal step is missing fromRef") ||
          err.message.includes("@apply traversal step is missing toRef"),
      );
      return true;
    },
  );
});

test("apply records history from executed action mutations", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
    -> @graft.state(to, "visited", true)
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.x.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

graph1 := @seed
  -> @apply(step1)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  assert.equal(graph.history.length, 3);
  assert.equal(graph.history[0].op, "@apply");
  assert.deepEqual(graph.history[0].payload, {
    from: "node1",
    action: "x",
    to: "node2",
  });
  assert.equal(graph.history[1].op, "@graft.branch");
  assert.equal(graph.history[2].op, "@graft.state");
  assert.equal(graph.history[1].causedBy, graph.history[0].id);
  assert.equal(graph.history[2].causedBy, graph.history[0].id);
});
