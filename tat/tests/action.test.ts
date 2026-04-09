import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

test("registers action bindings at runtime", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}
`);

  const action = result.execution.state.actions.get("x");
  assert.ok(action);
  assert.equal(action.bindingName, "x");
  assert.equal(action.guard, null);
  assert.equal(action.pipeline.length, 1);
  assert.equal(action.pipeline[0].type, "GraftBranchExpr");
  assert.equal(action.project, null);
});

test("registers action with guard and project", () => {
  const result = executeTat(`
x := @action {
  guard:
    from != to

  pipeline:
    -> @graft.branch(from, "supports", to)

  project:
    to
}
`);

  const action = result.execution.state.actions.get("x");
  assert.ok(action);
  assert.ok(action.guard);
  assert.equal(action.guard?.type, "ComparisonExpr");
  assert.equal(action.pipeline.length, 1);
  assert.ok(action.project);
  assert.equal(action.project?.type, "Identifier");
  if (action.project?.type === "Identifier") {
    assert.equal(action.project.name, "to");
  }
});

test("traversal node capture includes action metadata", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
B = <Do>

node1 = <A.x.B>
`);

  const node = result.execution.state.bindings.nodes.get("node1");
  assert.ok(node);

  const value = node.value as any;
  assert.equal(value.kind, "traversal");
  assert.equal(value.source, "A.x.B");
  assert.equal(Array.isArray(value.steps), true);
  assert.equal(value.steps.length, 1);

  const step = value.steps[0];
  assert.equal(step.kind, "action");
  assert.equal(step.binding, "x");
  assert.equal(step.callee, "x");
  assert.equal(step.from, "Ti");
  assert.equal(step.to, "Do");
  assert.ok(step.action);
  assert.equal(step.action.bindingName, "x");
  assert.equal(Array.isArray(step.action.pipeline), true);
  assert.equal(step.action.pipeline.length, 1);
});

test("context traversal includes action metadata on inner action", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

z := @action {
  pipeline:
    -> @graft.state(to, "visited", true)
}

A = <Ti>
B = <Do>
C = <"voice">
D = <"Soprano">

node1 = <A.x.B..ctx..C.z.D>
`);

  const node = result.execution.state.bindings.nodes.get("node1");
  assert.ok(node);

  const value = node.value as any;
  assert.equal(value.kind, "traversal");
  assert.equal(value.steps.length, 2);

  const first = value.steps[0];
  assert.equal(first.kind, "action");
  assert.equal(first.binding, "x");
  assert.ok(first.action);
  assert.equal(first.action.bindingName, "x");

  const second = value.steps[1];
  assert.equal(second.kind, "context");
  assert.equal(second.context, "ctx");
  assert.equal(second.binding, "z");
  assert.ok(second.action);
  assert.equal(second.action.bindingName, "z");
});

test("action-aware traversal still evaluates identifiers through bindings", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

A = <Ti>
B = <Do>

node1 = <A.x.B>
node2 = <node1>
`);

  const node2 = result.execution.state.bindings.nodes.get("node2");
  assert.ok(node2);

  const value = node2.value as any;
  assert.equal(value.kind, "traversal");
  assert.equal(value.source, "A.x.B");
  assert.equal(value.steps[0].from, "Ti");
  assert.equal(value.steps[0].to, "Do");
});

test("multiple actions can coexist in runtime registry", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

y := @action {
  pipeline:
    -> @graft.progress(from, "movesTo", to)
}
`);

  assert.equal(result.execution.state.actions.size, 2);

  const x = result.execution.state.actions.get("x");
  const y = result.execution.state.actions.get("y");

  assert.ok(x);
  assert.ok(y);
  assert.equal(x.bindingName, "x");
  assert.equal(y.bindingName, "y");
  assert.equal(x.pipeline[0].type, "GraftBranchExpr");
  assert.equal(y.pipeline[0].type, "GraftProgressExpr");
});