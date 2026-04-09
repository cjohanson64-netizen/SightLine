import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

function seededQueryProgram(query: string): string {
  return `
A = <Ti>
B = <Do>
C = <Mi>

hero = <A>
goblin = <B>
quest_main = <C>

@seed:
  nodes: [hero, goblin, quest_main]
  edges: [
    [hero : "has-status" : goblin]
  ]
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 3)
  -> @graft.meta(quest_main, "status", "complete")
  <> @project(format: "graph")

${query}
`;
}

test("match supports wildcard in subject position", () => {
  const result = executeTat(`
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

@match(_ : "supports" : Y)
`);

  assert.equal(result.execution.state.queryResults.length, 1);

  const queryResult = result.execution.state.queryResults[0].result;
  assert.equal(queryResult.kind, "MatchResultSet");

  if (queryResult.kind === "MatchResultSet") {
    assert.equal(queryResult.items.length, 1);
    assert.equal(queryResult.items[0].bindings.Y, "node2");
    assert.deepEqual(Object.keys(queryResult.items[0].bindings), ["Y"]);
  }
});

test("match supports wildcard in object position", () => {
  const result = executeTat(`
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

@match(X : "supports" : _)
`);

  const queryResult = result.execution.state.queryResults[0].result;
  assert.equal(queryResult.kind, "MatchResultSet");

  if (queryResult.kind === "MatchResultSet") {
    assert.equal(queryResult.items.length, 1);
    assert.equal(queryResult.items[0].bindings.X, "node1");
    assert.deepEqual(Object.keys(queryResult.items[0].bindings), ["X"]);
  }
});

test("match supports regex in relation position", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
C = <Mi>

node1 = <A>
node2 = <B>
node3 = <C>

@seed:
  nodes: [node1, node2, node3]
  edges: [
    [node1 : "supports" : node2],
    [node2 : "inside" : node3]
  ]
  state: {}
  meta: {}
  root: node1

@match(X : /support.*/ : Y)
`);

  const queryResult = result.execution.state.queryResults[0].result;
  assert.equal(queryResult.kind, "MatchResultSet");

  if (queryResult.kind === "MatchResultSet") {
    assert.equal(queryResult.items.length, 1);
    assert.equal(queryResult.items[0].bindings.X, "node1");
    assert.equal(queryResult.items[0].bindings.Y, "node2");
  }
});

test("match supports regex with no matches", () => {
  const result = executeTat(`
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

@match(X : /^inside$/ : Y)
`);

  const queryResult = result.execution.state.queryResults[0].result;
  assert.equal(queryResult.kind, "MatchResultSet");

  if (queryResult.kind === "MatchResultSet") {
    assert.equal(queryResult.items.length, 0);
  }
});

test("match supports wildcard plus regex together", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
C = <Mi>

node1 = <A>
node2 = <B>
node3 = <C>

@seed:
  nodes: [node1, node2, node3]
  edges: [
    [node1 : "supports" : node2],
    [node2 : "inside" : node3]
  ]
  state: {}
  meta: {}
  root: node1

@match(_ : /support.*/ : Y)
`);

  const queryResult = result.execution.state.queryResults[0].result;
  assert.equal(queryResult.kind, "MatchResultSet");

  if (queryResult.kind === "MatchResultSet") {
    assert.equal(queryResult.items.length, 1);
    assert.equal(queryResult.items[0].bindings.Y, "node2");
  }
});

test("@query edge existence returns true and false", () => {
  const result = executeTat(
    seededQueryProgram(`
@query {
  subject: hero
  relation: "has-status"
  object: goblin
}

@query {
  subject: goblin
  relation: "has-status"
  object: hero
}
`),
  );

  const [first, second] = result.execution.state.queryResults.map((entry) => entry.result as any);
  assert.equal(first.kind, "BooleanQueryResult");
  assert.equal(first.value, true);
  assert.equal(second.kind, "BooleanQueryResult");
  assert.equal(second.value, false);
});

test("@query state existence and equality return expected booleans", () => {
  const result = executeTat(
    seededQueryProgram(`
@query {
  node: goblin
  state: "hp"
}

@query {
  node: goblin
  state: "hp"
  equals: 3
}

@query {
  node: goblin
  state: "hp"
  equals: 0
}

@query {
  node: quest_main
  state: "hp"
}
`),
  );

  const values = result.execution.state.queryResults.map((entry) => (entry.result as any).value);
  assert.deepEqual(values, [true, true, false, false]);
});

test("@query meta existence and equality return expected booleans", () => {
  const result = executeTat(
    seededQueryProgram(`
@query {
  node: quest_main
  meta: "status"
}

@query {
  node: quest_main
  meta: "status"
  equals: "complete"
}

@query {
  node: quest_main
  meta: "status"
  equals: "failed"
}

@query {
  node: goblin
  meta: "status"
}
`),
  );

  const values = result.execution.state.queryResults.map((entry) => (entry.result as any).value);
  assert.deepEqual(values, [true, true, false, false]);
});
