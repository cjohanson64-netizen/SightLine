import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

test("how inspects action from traversal binding", () => {
  const result = executeTat(`
resolve := @action {
  pipeline:
    -> @graft.branch(from, "resolvesTo", to)
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.resolve.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

@how(step1)
`);

  assert.equal(result.execution.state.queryResults.length, 1);
  const queryResult = result.execution.state.queryResults[0].result as any;

  assert.equal(queryResult.kind, "HowResult");
  assert.equal(queryResult.binding, "resolve");
  assert.equal(queryResult.fromRef, "node1");
  assert.equal(queryResult.toRef, "node2");
  assert.equal(queryResult.from, "Ti");
  assert.equal(queryResult.to, "Do");
  assert.ok(queryResult.action);
  assert.equal(queryResult.action.bindingName, "resolve");
});

test("how inspects action from inline traversal capture", () => {
  const result = executeTat(`
resolve := @action {
  pipeline:
    -> @graft.branch(from, "resolvesTo", to)
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

@how(<node1.resolve.node2>)
`);

  assert.equal(result.execution.state.queryResults.length, 1);
  const queryResult = result.execution.state.queryResults[0].result as any;

  assert.equal(queryResult.kind, "HowResult");
  assert.equal(queryResult.binding, "resolve");
  assert.equal(queryResult.fromRef, "node1");
  assert.equal(queryResult.toRef, "node2");
});

test("how returns first traversal step only", () => {
  const result = executeTat(`
x := @action {
  pipeline:
    -> @graft.branch(from, "supports", to)
}

z := @action {
  pipeline:
    -> @graft.branch(from, "leadsTo", to)
}

A = <Ti>
B = <Do>
C = <"voice">
D = <"Soprano">
node1 = <A.x.B..ctx..C.z.D>

@seed:
  nodes: []
  edges: []
  state: {}
  meta: {}
  root: nowhere

@how(node1)
`);

  assert.equal(result.execution.state.queryResults.length, 1);
  const queryResult = result.execution.state.queryResults[0].result as any;

  assert.equal(queryResult.kind, "HowResult");
  assert.equal(queryResult.binding, "x");
  assert.ok(queryResult.action);
  assert.equal(queryResult.action.bindingName, "x");
});

test("how throws when target is not a traversal", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
node1 = <A>

@seed:
  nodes: [node1]
  edges: []
  state: {}
  meta: {}
  root: node1

@how(node1)
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@how target must resolve to a traversal value/);
      return true;
    },
  );
});

test("how throws when action binding is missing", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.missingAction.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

@how(step1)
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('@how traversal step is missing an action binding') ||
          err.message.includes('@how could not find action "missingAction"') ||
          err.message.includes('Traversal operator "missingAction" is not a declared action'),
      );
      return true;
    },
  );
});

test("how exposes action guard and project when present", () => {
  const result = executeTat(`
resolve := @action {
  guard:
    from != to

  pipeline:
    -> @graft.branch(from, "resolvesTo", to)

  project:
    to
}

A = <Ti>
B = <Do>
node1 = <A>
node2 = <B>
step1 = <node1.resolve.node2>

@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1

@how(step1)
`);

  const queryResult = result.execution.state.queryResults[0].result as any;
  assert.equal(queryResult.kind, "HowResult");
  assert.ok(queryResult.action);
  assert.equal(queryResult.action.bindingName, "resolve");
  assert.ok(queryResult.action.guard);
  assert.ok(queryResult.action.project);
});

test("how preserves null refs for raw traversal values", () => {
  const result = executeTat(`
resolve := @action {
  pipeline:
    -> @graft.branch(from, "resolvesTo", to)
}

@seed:
  nodes: []
  edges: []
  state: {}
  meta: {}
  root: nowhere

@how(<"A".resolve."B">)
`);

  assert.equal(result.execution.state.queryResults.length, 1);
  const queryResult = result.execution.state.queryResults[0].result as any;

  assert.equal(queryResult.kind, "HowResult");
  assert.equal(queryResult.binding, "resolve");
  assert.equal(queryResult.fromRef, null);
  assert.equal(queryResult.toRef, null);
  assert.equal(queryResult.from, "A");
  assert.equal(queryResult.to, "B");
});
