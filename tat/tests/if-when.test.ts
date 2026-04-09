import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

function getGraph(result: ReturnType<typeof executeTat>, name = "graph1") {
  const graph = result.execution.state.graphs.get(name);
  assert.ok(graph);
  return graph;
}

function countHistory(
  result: ReturnType<typeof executeTat>,
  op: string,
  name = "graph1",
): number {
  return getGraph(result, name).history.filter((entry) => entry.op === op).length;
}

test("@if with true condition runs then branch", () => {
  const result = executeTat(`
A = <Ti>
hero = <A>

@seed:
  nodes: [hero]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @if {
    condition: true
    then:
      -> @graft.meta(hero, "status", "ready")
    else:
      -> @graft.meta(hero, "status", "blocked")
  }
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("hero")?.meta.status, "ready");
});

test("@if with false condition runs else branch", () => {
  const result = executeTat(`
A = <Ti>
hero = <A>

@seed:
  nodes: [hero]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @if {
    condition: false
    then:
      -> @graft.meta(hero, "status", "ready")
    else:
      -> @graft.meta(hero, "status", "blocked")
  }
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("hero")?.meta.status, "blocked");
});

test("@if with false condition and no else does nothing", () => {
  const result = executeTat(`
A = <Ti>
hero = <A>

@seed:
  nodes: [hero]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @if {
    condition: false
    then:
      -> @graft.meta(hero, "status", "ready")
  }
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("hero")?.meta.status, undefined);
});

test("@if missing condition fails validation", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
hero = <A>

@seed:
  nodes: [hero]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @if {
    then:
      -> @graft.meta(hero, "status", "ready")
  }
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@if requires a condition/);
      return true;
    },
  );
});

test("@if works inside an @action pipeline", () => {
  const result = executeTat(`
finishEnemy := @action {
  guard:
    true
  pipeline:
    -> @if {
      condition: @query {
        node: to
        state: "hp"
        equals: 0
      }
      then:
        -> @graft.meta(to, "status", "defeated")
      else:
        -> @graft.branch(from, "presses-on", to)
    }
}

A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 0)
  -> @apply(<hero.finishEnemy.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("goblin")?.meta.status, "defeated");
});

test("@if and @loop work together", () => {
  const result = executeTat(`
combo := @action {
  pipeline:
    -> @loop {
      count: 3
      pipeline:
        -> @if {
          condition: true
          then:
            -> @graft.state(to, "hit", true)
        }
    }
}

A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

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

test("@when false initially does not fire", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", "defeated")
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.meta(hero, "mood", "watchful")
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("goblin")?.meta.status, undefined);
  assert.equal(countHistory(result, "@graft.meta"), 1);
});

test("@when fires when event becomes true", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", "defeated")
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 0)
  <> @project(format: "graph")
`);

  const graph = getGraph(result);
  assert.equal(graph.nodes.get("goblin")?.meta.status, "defeated");
  assert.equal(countHistory(result, "@graft.meta"), 1);
});

test("@when does not repeatedly fire while event stays true", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", "defeated")
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 0)
  -> @graft.meta(hero, "mood", "calm")
  -> @graft.meta(hero, "pose", "steady")
  <> @project(format: "graph")
`);

  assert.equal(countHistory(result, "@graft.meta"), 3);
  assert.equal(getGraph(result).nodes.get("goblin")?.meta.status, "defeated");
});

test("@when can run a pipeline containing @apply", () => {
  const result = executeTat(`
celebrate := @action {
  guard:
    true
  pipeline:
    -> @graft.meta(from, "mood", "victorious")
}

A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @apply(<hero.celebrate.hero>)
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 0)
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("hero")?.meta.mood, "victorious");
});

test("@when reacts to a state change caused by @apply", () => {
  const result = executeTat(`
strike := @action {
  guard:
    true
  pipeline:
    -> @graft.state(to, "hp", 0)
}

A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", "defeated")
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @apply(<hero.strike.goblin>)
  <> @project(format: "graph")
`);

  assert.equal(getGraph(result).nodes.get("goblin")?.meta.status, "defeated");
});

test("@when and @query work together through false to true transitions", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    state: "hp"
    equals: 0
  }
  pipeline:
    -> @graft.meta(goblin, "status", "defeated")
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 1)
  -> @graft.state(goblin, "hp", 0)
  <> @project(format: "graph")

@query {
  node: goblin
  meta: "status"
  equals: "defeated"
}
`);

  assert.equal(result.execution.state.queryResults.at(-1)?.result.value, true);
});

test("@when throws on reactive safety cap overflow", () => {
  assert.throws(
    () =>
      executeTat(`
A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@when {
  event: @query {
    node: goblin
    meta: "armed"
    equals: true
  }
  pipeline:
    -> @prune.meta(goblin, "armed")
    -> @graft.meta(goblin, "armed", true)
}

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.meta(goblin, "armed", true)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@when exceeded reactive safety cap/);
      return true;
    },
  );
});

test("inline -> @when does not fire when condition is already true at registration time", () => {
  // @when only fires on false→true transitions; if the condition is already true
  // when the trigger is registered, it will not fire until it goes false and back to true.
  const result = executeTat(`
A = <Ti>
B = <Do>
goblinShape = <B>
goblinNode = <goblinShape>

@seed:
  nodes: [goblinNode]
  edges: []
  state: {}
  meta: {}
  root: goblinNode

battle := @seed
  -> @graft.state(goblinNode, "hp", 0)
  -> @when {
    event: @query {
      node: goblinNode
      state: "hp"
      equals: 0
    }
    pipeline:
      -> @graft.meta(goblinNode, "status", "defeated")
  }
  <> @project(format: "graph")
`);

  assert.equal(
    getGraph(result, "battle").nodes.get("goblinNode")?.meta.status,
    undefined,
  );
});

test("inline -> @when does not fire when condition is initially false", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
goblinShape = <B>
goblinNode = <goblinShape>

@seed:
  nodes: [goblinNode]
  edges: []
  state: {}
  meta: {}
  root: goblinNode

battle := @seed
  -> @graft.state(goblinNode, "hp", 10)
  -> @when {
    event: @query {
      node: goblinNode
      state: "hp"
      equals: 0
    }
    pipeline:
      -> @graft.meta(goblinNode, "status", "defeated")
  }
  <> @project(format: "graph")
`);

  assert.equal(
    getGraph(result, "battle").nodes.get("goblinNode")?.meta.status,
    undefined,
  );
});

test("inline -> @when fires when a later mutation makes condition true", () => {
  const result = executeTat(`
A = <Ti>
B = <Do>
goblinShape = <B>
goblinNode = <goblinShape>

@seed:
  nodes: [goblinNode]
  edges: []
  state: {}
  meta: {}
  root: goblinNode

battle := @seed
  -> @graft.state(goblinNode, "hp", 10)
  -> @when {
    event: @query {
      node: goblinNode
      state: "hp"
      equals: 0
    }
    pipeline:
      -> @graft.meta(goblinNode, "status", "defeated")
  }
  -> @graft.state(goblinNode, "hp", 0)
  <> @project(format: "graph")
`);

  assert.equal(
    getGraph(result, "battle").nodes.get("goblinNode")?.meta.status,
    "defeated",
  );
});

test("@when in @action pipeline fails validation", () => {
  assert.throws(
    () =>
      executeTat(`
finish := @action {
  guard:
    true
  pipeline:
    -> @when {
      event: @query {
        node: to
        state: "hp"
        equals: 0
      }
      pipeline:
        -> @graft.meta(to, "status", "defeated")
    }
}

A = <Ti>
B = <Do>
heroShape = <A>
goblinShape = <B>
hero = <heroShape>
goblin = <goblinShape>

@seed:
  nodes: [hero, goblin]
  edges: []
  state: {}
  meta: {}
  root: hero

graph1 := @seed
  -> @graft.state(goblin, "hp", 0)
  -> @apply(<hero.finish.goblin>)
  <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@when is not supported inside @action pipelines/);
      return true;
    },
  );
});
