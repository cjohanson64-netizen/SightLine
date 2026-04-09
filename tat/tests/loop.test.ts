import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

function countHistory(
  result: ReturnType<typeof executeTat>,
  op: string,
): number {
  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  return graph.history.filter((entry) => entry.op === op).length;
}

test("@query can be used as an action guard", () => {
  const result = executeTat(`
attack := @action {
  guard:
    @query {
      subject: from
      relation: "can"
      object: to
    }

  pipeline:
    -> @graft.state(to, "hit", true)
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: [
    [hero : "can" : goblin]
  ]
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.attack.goblin>)
  <> @project(format: "graph")
`);

  const graph = result.execution.state.graphs.get("graph1");
  assert.ok(graph);
  assert.equal(graph.nodes.get("goblin")?.state.hit, true);
});

test("@loop with count only runs exact iterations", () => {
  const result = executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: 3
      pipeline:
        -> @graft.state(to, "hit", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 3);
});

test("@loop with until only stops once condition becomes true", () => {
  const result = executeTat(`
finish := @action {
  pipeline:
    -> @loop {
      until: @query {
        node: to
        state: "done"
        equals: true
      }
      pipeline:
        -> @graft.state(to, "done", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.finish.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 1);
});

test("@loop with count and until stops early", () => {
  const result = executeTat(`
finish := @action {
  pipeline:
    -> @loop {
      until: @query {
        node: to
        state: "done"
        equals: true
      }
      count: 5
      pipeline:
        -> @graft.state(to, "done", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.finish.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 1);
});

test("@derive.state can drive loop count and is evaluated once at loop entry", () => {
  const result = executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: @derive.state {
        node: to
        key: "hp"
      }
      pipeline:
        -> @graft.state(to, "hp", 0)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 2)
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 3);
});

test("@derive.meta can drive loop count", () => {
  const result = executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: @derive.meta {
        node: to
        key: "charges"
      }
      pipeline:
        -> @graft.state(to, "charged", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.meta(goblin, "charges", 3)
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 3);
});

test("@loop supports nested @apply inside the loop pipeline", () => {
  const result = executeTat(`
attack := @action {
  pipeline:
    -> @graft.state(to, "hit", true)
}

combo := @action {
  pipeline:
    -> @loop {
      count: 3
      pipeline:
        -> @apply(<from.attack.to>)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.state"), 3);
});

test("@loop throws on safety cap overflow", () => {
  assert.throws(
    () =>
      executeTat(`
spin := @action {
  pipeline:
    -> @loop {
      until: @query {
        node: to
        state: "done"
        equals: true
      }
      pipeline:
        -> @graft.state(to, "done", false)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.spin.goblin>)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@loop exceeded safety cap/);
      return true;
    },
  );
});

test("@derive.state missing key fails clearly when used for loop count", () => {
  assert.throws(
    () =>
      executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: @derive.state {
        node: to
        key: "hp"
      }
      pipeline:
        -> @graft.state(to, "hit", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@derive\.state could not find state key "hp"/);
      return true;
    },
  );
});

test("@derive.meta missing key fails clearly when used for loop count", () => {
  assert.throws(
    () =>
      executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: @derive.meta {
        node: to
        key: "charges"
      }
      pipeline:
        -> @graft.state(to, "hit", true)
    }
}

A = <Ti>
B = <Do>
hero = <A>
goblin = <B>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.combo.goblin>)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@derive\.meta could not find meta key "charges"/);
      return true;
    },
  );
});
