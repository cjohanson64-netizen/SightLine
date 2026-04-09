import test from "node:test";
import assert from "node:assert/strict";
import { executeTat } from "../runtime/index";

function projectionFixture(pipeline: string): string {
  return `
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
allyValue = <{ name: "Ally", type: "character" }>
partyValue = <{ name: "Party", type: "group" }>
skillTreeValue = <{ name: "Skills", type: "tree" }>
slashValue = <{ name: "Slash", type: "skill" }>
comboValue = <{ name: "Combo", type: "skill" }>
battleValue = <{ name: "Battle", type: "encounter" }>
phase1Value = <{ name: "Round 1", type: "phase" }>
phase2Value = <{ name: "Round 2", type: "phase" }>
attackActionValue = <{ name: "Attack", type: "action", binding: "attack" }>
talkActionValue = <{ name: "Talk", type: "action", binding: "talk" }>

hero = <heroValue>
goblin = <goblinValue>
ally = <allyValue>
party = <partyValue>
skillTree = <skillTreeValue>
slash = <slashValue>
combo = <comboValue>
battle = <battleValue>
phase1 = <phase1Value>
phase2 = <phase2Value>
attackActionNode = <attackActionValue>
talkActionNode = <talkActionValue>

attack := @action {
  guard: to.state.alive == true
  pipeline:
    -> @graft.state(to, "status", "defeated")
}

talk := @action {
  guard: to.meta.friendly == true
  pipeline:
    -> @graft.meta(to, "lastInteraction", "talk")
}

@seed:
  nodes: [
    hero,
    goblin,
    ally,
    party,
    skillTree,
    slash,
    combo,
    battle,
    phase1,
    phase2,
    attackActionNode,
    talkActionNode
  ]
  edges: [
    [hero : "targets" : goblin],
    [hero : "targets" : ally],
    [hero : "can" : attackActionNode],
    [hero : "can" : talkActionNode],
    [party : "contains" : hero],
    [party : "contains" : ally],
    [skillTree : "contains" : slash],
    [slash : "unlocks" : combo]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  -> @graft.state(hero, "active", true)
  -> @graft.state(goblin, "alive", true)
  -> @graft.state(ally, "alive", false)
  -> @graft.meta(ally, "friendly", true)
  -> @graft.progress(battle, "started", phase1)
  -> @graft.progress(battle, "resolved", phase2)
  -> @apply(<hero.attack.goblin>)
${pipeline ? `\n  <> @project ${pipeline.trim()}` : ""}
`;
}

test("project validation fails when block fields are missing", () => {
  assert.throws(
    () =>
      executeTat(projectionFixture(`
{
  format: "menu"
  focus: hero
}
`)),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /@project requires an include field/);
      return true;
    },
  );
});

test("project validation fails on invalid include keys", () => {
  assert.throws(
    () =>
      executeTat(projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [label, action, banana]
}
`)),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Invalid @project include key "banana"/);
      return true;
    },
  );
});

test("project validation fails on format/include mismatches", () => {
  assert.throws(
    () =>
      executeTat(projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [label, action, target, relationships]
}
`)),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /does not allow include key "relationships"/);
      return true;
    },
  );
});

test("graph projection returns a local slice around the focus node", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "graph"
  focus: hero
  include: [id, label, type, value, state, meta, relationships, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "graph");
  assert.equal(projection.focus, "hero");
  assert.equal(projection.nodes.length, 5);
  assert.ok(projection.nodes.some((node: any) => node.id === "hero"));
  assert.ok(projection.edges.every((edge: any) => edge.source === "hero"));
});

test("detail projection returns one node contract", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "detail"
  focus: hero
  include: [id, label, type, state, meta, actions, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "detail");
  assert.equal(projection.focus.id, "hero");
  assert.equal(projection.node.label, "Hero");
  assert.equal(projection.node.status, "active");
  assert.deepEqual(projection.node.actions, [{ id: "attackActionNode", label: "Attack" }, { id: "talkActionNode", label: "Talk" }]);
});

// Guard-aware: only pairs where the action guard passes for the given target.
// attack guard: to.state.alive == true  → goblin(alive=true)✓  ally(alive=false)✗
// talk guard:   to.meta.friendly == true → goblin(no friendly)✗  ally(friendly=true)✓
test("menu projection filters items by action guard", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [id, label, action, target, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "menu");
  assert.equal(projection.focus.id, "hero");
  // attack×goblin passes (goblin.alive=true), talk×ally passes (ally.friendly=true)
  assert.equal(projection.items.length, 2);
  assert.deepEqual(
    projection.items.map((item: any) => item.label).sort(),
    ["Attack Goblin", "Talk Ally"],
  );
});

test("menu projection item ids use dot-separated focus.action.target pattern", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [id, label, action, target, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  const ids: string[] = projection.items.map((item: any) => item.id).sort();
  // Only guard-passing pairs are included (attack×goblin, talk×ally)
  assert.deepEqual(ids, [
    "hero.attack.goblin",
    "hero.talk.ally",
  ]);
});

test("menu projection action record uses binding name for id", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [id, label, action, target, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  const actionIds: string[] = [...new Set(projection.items.map((item: any) => item.action.id))].sort();
  assert.deepEqual(actionIds, ["attack", "talk"]);
  const attackItem = projection.items.find((item: any) => item.action.id === "attack");
  assert.equal(attackItem.action.label, "Attack");
  assert.equal(attackItem.action.value.name, "Attack");
});

test("menu projection target record uses node id and derived label", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [id, label, action, target, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  const goblinItem = projection.items.find(
    (item: any) => item.action.id === "attack" && item.target.id === "goblin",
  );
  assert.ok(goblinItem, "expected attack×goblin pair");
  assert.equal(goblinItem.target.id, "goblin");
  assert.equal(goblinItem.target.label, "Goblin");
  assert.equal(goblinItem.target.value.name, "Goblin");
});

test("menu projection status is 'available' for all items in V1", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "menu"
  focus: hero
  include: [id, label, action, target, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  for (const item of projection.items) {
    assert.equal(item.status, "available");
  }
});

test("list projection derives items from contains", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "list"
  focus: party
  include: [id, label, status]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "list");
  assert.deepEqual(
    projection.items.map((item: any) => item.id),
    ["hero", "ally"],
  );
});

test("tree projection derives hierarchy from contains and unlocks", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "tree"
  focus: skillTree
  include: [label, children, id, status, value]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "tree");
  assert.equal(projection.focus.id, "skillTree");
  assert.equal(projection.tree.label, "Skills");
  assert.equal(projection.tree.value.name, "Skills");
  assert.equal(projection.tree.children[0].label, "Slash");
  assert.equal(projection.tree.children[0].children[0].label, "Combo");
});

test("timeline projection is empty before any explicit apply", () => {
  const result = executeTat(`
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
attackValue = <{ name: "Attack", type: "action", binding: "attack" }>

heroNode = <heroValue>
goblinNode = <goblinValue>
attackNode = <attackValue>

attack := @action {
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(heroNode, "hp", 10)
  -> @graft.state(goblinNode, "hp", 3)

battleTimeline = battle <> @project(format: "timeline")
`);

  const projection = result.execution.state.projections.get("battleTimeline") as any;
  assert.equal(projection.format, "timeline");
  assert.deepEqual(projection.events, []);
});

test("trace projection is empty before any explicit apply", () => {
  const result = executeTat(`
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
attackValue = <{ name: "Attack", type: "action", binding: "attack" }>

heroNode = <heroValue>
goblinNode = <goblinValue>
attackNode = <attackValue>

attack := @action {
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(heroNode, "hp", 10)
  -> @graft.state(goblinNode, "hp", 3)

battleTrace = battle <> @project(format: "trace")
`);

  const projection = result.execution.state.projections.get("battleTrace") as any;
  assert.equal(projection.format, "trace");
  assert.deepEqual(projection.steps, []);
});

test("timeline projection derives apply events from structured apply history", () => {
  const result = executeTat(`
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
attackValue = <{ name: "Attack", type: "action", binding: "attack" }>

heroNode = <heroValue>
goblinNode = <goblinValue>
attackNode = <attackValue>

attack := @action {
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(heroNode, "hp", 10)
  -> @graft.state(goblinNode, "hp", 3)
  -> @apply(<heroNode.attack.goblinNode>)

battleTimeline = battle <> @project(format: "timeline")
`);

  const projection = result.execution.state.projections.get("battleTimeline") as any;
  assert.equal(projection.format, "timeline");
  assert.deepEqual(projection.events, [
    {
      id: projection.events[0].id,
      step: 1,
      from: "heroNode",
      event: "attack",
      action: {
        id: "attack",
        label: "Attack",
        value: { name: "Attack", type: "action", binding: "attack" },
        state: {},
        meta: {},
        status: "ready",
      },
      target: {
        id: "goblinNode",
        label: "Goblin",
        value: { name: "Goblin", type: "enemy" },
        state: { hp: 0 },
        meta: {},
        status: "ready",
      },
      label: "Hero targeted Goblin with Attack",
      status: "ready",
      state: { hp: 0 },
      raw: "@apply(<heroNode.attack.goblinNode>)",
    },
  ]);
});

test("trace projection derives apply steps from structured apply history", () => {
  const result = executeTat(`
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
attackValue = <{ name: "Attack", type: "action", binding: "attack" }>

heroNode = <heroValue>
goblinNode = <goblinValue>
attackNode = <attackValue>

attack := @action {
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: [
    [heroNode : "can" : attackNode],
    [heroNode : "targets" : goblinNode]
  ]
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(heroNode, "hp", 10)
  -> @graft.state(goblinNode, "hp", 3)
  -> @apply(<heroNode.attack.goblinNode>)

battleTrace = battle <> @project(format: "trace")
`);

  const projection = result.execution.state.projections.get("battleTrace") as any;
  assert.equal(projection.format, "trace");
  assert.deepEqual(projection.steps, [
    {
      id: projection.steps[0].id,
      step: 1,
      from: "heroNode",
      to: "goblinNode",
      label: "Hero targeted Goblin with Attack",
      event: "@apply",
      action: {
        id: "attack",
        label: "Attack",
        value: { name: "Attack", type: "action", binding: "attack" },
        state: {},
        meta: {},
        status: "ready",
      },
      target: {
        id: "goblinNode",
        label: "Goblin",
        value: { name: "Goblin", type: "enemy" },
        state: { hp: 0 },
        meta: {},
        status: "ready",
      },
      status: "ready",
      state: { hp: 0 },
      raw: "@apply(<heroNode.attack.goblinNode>)",
    },
  ]);
});

test("summary projection returns compressed node data", () => {
  const result = executeTat(
    projectionFixture(`
{
  format: "summary"
  focus: hero
  include: [label, status, id, actions]
}
`),
  );

  const projection = result.execution.state.projections.get("world") as any;
  assert.equal(projection.format, "summary");
  assert.equal(projection.data.label, "Hero");
  assert.equal(projection.data.status, "active");
  assert.equal(projection.data.actions.length, 2);
});

// ─── GraphProjection: name = graph <> @project(...) ────────────────────────

const graphProjectionFixture = `
heroValue = <{ name: "Hero", type: "character" }>
goblinValue = <{ name: "Goblin", type: "enemy" }>
allyValue = <{ name: "Ally", type: "character" }>
attackActionValue = <{ name: "Attack", type: "action", binding: "attack" }>
talkActionValue = <{ name: "Talk", type: "action", binding: "talk" }>

hero = <heroValue>
goblin = <goblinValue>
ally = <allyValue>
attackActionNode = <attackActionValue>
talkActionNode = <talkActionValue>

attack := @action {
  pipeline:
    -> @graft.state(goblin, "status", "defeated")
}

talk := @action {
  pipeline:
    -> @graft.meta(ally, "lastInteraction", "talk")
}

@seed:
  nodes: [hero, goblin, ally, attackActionNode, talkActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "targets" : ally],
    [hero : "can" : attackActionNode],
    [hero : "can" : talkActionNode]
  ]
  state: {}
  meta: {}
  root: hero

battle := @seed
  -> @graft.state(hero, "active", true)
  -> @graft.state(goblin, "alive", true)

battleGraph = battle <> @project(format: "graph")

battleMenu = battle
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`;

test("graph projection: inline form produces graph view of existing binding", () => {
  const result = executeTat(graphProjectionFixture);
  const proj = result.execution.state.projections.get("battleGraph") as any;
  assert.ok(proj, "expected battleGraph projection to exist");
  assert.equal(proj.format, "graph");
  assert.equal(proj.focus, "hero");
  assert.ok(Array.isArray(proj.nodes));
  assert.ok(proj.nodes.some((n: any) => n.id === "hero"));
});

test("graph projection: block form produces menu view of existing binding", () => {
  const result = executeTat(graphProjectionFixture);
  const proj = result.execution.state.projections.get("battleMenu") as any;
  assert.ok(proj, "expected battleMenu projection to exist");
  assert.equal(proj.format, "menu");
  assert.equal(proj.focus.id, "hero");
  assert.ok(Array.isArray(proj.items));
  assert.equal(proj.items.length, 4); // 2 can × 2 targets — no guards on these actions, all pairs pass
});

test("graph projection: battle graph is not mutated by projections", () => {
  const result = executeTat(graphProjectionFixture);
  const graph = result.execution.state.graphs.get("battle")!;
  assert.ok(graph, "battle graph should still exist");
  // Projections are read-only views — graph node count unchanged
  assert.ok(graph.nodes.size >= 5);
});

test("graph projection: both views share the same underlying graph mutations", () => {
  const result = executeTat(graphProjectionFixture);
  const graphProj = result.execution.state.projections.get("battleGraph") as any;
  const menuProj = result.execution.state.projections.get("battleMenu") as any;

  // The graph projection shows hero's active=true state (set by the battle pipeline)
  const heroNode = graphProj.nodes.find((n: any) => n.id === "hero");
  assert.ok(heroNode, "hero should appear in graph projection");
  assert.equal(heroNode.state?.active, true);

  // Menu projection also reflects the same graph (focus is hero)
  assert.equal(menuProj.focus.id, "hero");
});

test("graph projection: errors when source is not a graph binding", () => {
  assert.throws(
    () =>
      executeTat(`
heroValue = <{ name: "Hero" }>
hero = <heroValue>

@seed:
  nodes: [hero]
  edges: []
  state: {}
  meta: {}
  root: hero

bad = hero <> @project(format: "graph")
`),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /is not a (known graph binding|graph value)/);
      return true;
    },
  );
});

// ─── Guard-aware menu filtering ────────────────────────────────────────────

// Deterministic fixture: hero can attack and talk, two targets with specific state.
// attack guard: to.state.hp  (truthy check — target must have an hp value)
// talk guard:   true          (always passes)
const guardMenuFixture = `
heroValue = <{ name: "Hero" }>
goblinValue = <{ name: "Goblin" }>
allyValue = <{ name: "Ally" }>
attackNodeValue = <{ name: "Attack", binding: "attack" }>
talkNodeValue = <{ name: "Talk", binding: "talk" }>

hero = <heroValue>
goblin = <goblinValue>
ally = <allyValue>
attackActionNode = <attackNodeValue>
talkActionNode = <talkNodeValue>

attack := @action {
  guard: @query {
    node: to
    state: "hp"
  }
  pipeline:
    -> @graft.state(to, "hp", 0)
}

talk := @action {
  guard: true
  pipeline:
    -> @graft.meta(to, "lastInteraction", "talk")
}

@seed:
  nodes: [hero, goblin, ally, attackActionNode, talkActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "targets" : ally],
    [hero : "can" : attackActionNode],
    [hero : "can" : talkActionNode]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  -> @graft.state(goblin, "hp", 10)
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`;

test("guard-aware menu: target without required state is excluded", () => {
  const result = executeTat(guardMenuFixture);
  const proj = result.execution.state.projections.get("world") as any;

  // attack requires to.state.hp — goblin has hp=10, ally has no hp
  const attackItems = proj.items.filter((item: any) => item.action.id === "attack");
  const attackTargetIds = attackItems.map((item: any) => item.target.id);
  assert.deepEqual(attackTargetIds, ["goblin"]);
  assert.ok(!attackTargetIds.includes("ally"), "ally should not appear under attack (no hp)");
});

test("guard-aware menu: target satisfying guard is included", () => {
  const result = executeTat(guardMenuFixture);
  const proj = result.execution.state.projections.get("world") as any;

  const goblinAttack = proj.items.find(
    (item: any) => item.action.id === "attack" && item.target.id === "goblin",
  );
  assert.ok(goblinAttack, "goblin (hp=10) should appear under attack");
  assert.equal(goblinAttack.status, "available");
});

test("guard-aware menu: guard: true always passes for all targets", () => {
  const result = executeTat(guardMenuFixture);
  const proj = result.execution.state.projections.get("world") as any;

  const talkItems = proj.items.filter((item: any) => item.action.id === "talk");
  const talkTargetIds = talkItems.map((item: any) => item.target.id).sort();
  // talk has guard: true — both goblin and ally should appear
  assert.deepEqual(talkTargetIds, ["ally", "goblin"]);
});

test("guard-aware menu: total item count reflects guard filtering", () => {
  const result = executeTat(guardMenuFixture);
  const proj = result.execution.state.projections.get("world") as any;

  // attack: 1 legal (goblin), 1 excluded (ally)
  // talk:   2 legal (both, guard: true)
  // total: 3
  assert.equal(proj.items.length, 3);
});

test("guard-aware menu: action without guard treats all targets as available", () => {
  const result = executeTat(`
heroValue = <{ name: "Hero" }>
goblinValue = <{ name: "Goblin" }>
allyValue = <{ name: "Ally" }>
strikeNodeValue = <{ name: "Strike", binding: "strike" }>

hero = <heroValue>
goblin = <goblinValue>
ally = <allyValue>
strikeActionNode = <strikeNodeValue>

strike := @action {
  pipeline:
    -> @graft.meta(to, "struck", true)
}

@seed:
  nodes: [hero, goblin, ally, strikeActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "targets" : ally],
    [hero : "can" : strikeActionNode]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`);

  const proj = result.execution.state.projections.get("world") as any;
  // No guard on strike — both targets should appear
  assert.equal(proj.items.length, 2);
  const targetIds = proj.items.map((item: any) => item.target.id).sort();
  assert.deepEqual(targetIds, ["ally", "goblin"]);
});

test("guard-aware menu: legality aligns with @apply semantics", () => {
  // If a menu item would appear, @apply for the same pair should also run.
  // Test: attack guard requires to.state.hp — if goblin has hp, apply runs.
  // After @apply: goblin.state.hp changes to 0. A fresh menu would no longer include goblin.
  const result = executeTat(`
heroValue = <{ name: "Hero" }>
goblinValue = <{ name: "Goblin" }>
attackNodeValue = <{ name: "Attack", binding: "attack" }>

hero = <heroValue>
goblin = <goblinValue>
attackActionNode = <attackNodeValue>

attack := @action {
  guard: @query {
    node: to
    state: "hp"
  }
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [hero, goblin, attackActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "can" : attackActionNode]
  ]
  state: {}
  meta: {}
  root: hero

beforeAttack := @seed
  -> @graft.state(goblin, "hp", 10)
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }

afterAttack := @seed
  -> @graft.state(goblin, "hp", 10)
  -> @apply(<hero.attack.goblin>)
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`);

  const before = result.execution.state.projections.get("beforeAttack") as any;
  const after = result.execution.state.projections.get("afterAttack") as any;

  // Before attack: goblin has hp=10, guard passes
  assert.equal(before.items.length, 1);
  assert.equal(before.items[0].target.id, "goblin");

  // After attack sets hp=0: @query { node: to, state: "hp" } checks existence,
  // hp still exists (=0), so guard still passes at existence level
  // (This verifies the behavior is consistent with how @query works)
  assert.equal(after.items.length, 1);
});

// ─── Guard binding resolution: value.id and Node-suffix patterns ────────────
// These fixtures mirror the actual playground INITIAL_SOURCE pattern where
// action nodes use { id: "attack", type: "action", name: "Attack" } (no binding field)
// and node ids end with "Node" (e.g. attackNode).

const playgroundStyleFixture = (guardExpr: string) => `
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
goblinNode = <{ id: "goblin", type: "enemy", name: "Goblin" }>
attackNode = <{ id: "attack", type: "action", name: "Attack" }>

hero = <heroNode>
goblin = <goblinNode>
attackActionNode = <attackNode>

attack := @action {
  guard:
    ${guardExpr}
  pipeline:
    -> @graft.branch(from, "attacks", to)
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [hero, goblin, attackActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "can" : attackActionNode]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  -> @graft.state(goblin, "hp", 3)
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`;

test("guard binding: value.id pattern — guard: false produces zero items", () => {
  const result = executeTat(playgroundStyleFixture("false"));
  const proj = result.execution.state.projections.get("world") as any;
  assert.equal(proj.items.length, 0, "guard: false must produce no items");
});

test("guard binding: value.id pattern — guard: true produces all structurally valid items", () => {
  const result = executeTat(playgroundStyleFixture("true"));
  const proj = result.execution.state.projections.get("world") as any;
  assert.equal(proj.items.length, 1);
  assert.equal(proj.items[0].action.id, "attack");
  assert.equal(proj.items[0].target.id, "goblin");
});

test("guard binding: value.id pattern — @query guard filters targets without matching state", () => {
  const withHpFixture = `
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
goblinNode = <{ id: "goblin", type: "enemy", name: "Goblin" }>
allyNode = <{ id: "ally", type: "character", name: "Ally" }>
attackNode = <{ id: "attack", type: "action", name: "Attack" }>

hero = <heroNode>
goblin = <goblinNode>
ally = <allyNode>
attackActionNode = <attackNode>

attack := @action {
  guard:
    @query {
      node: to
      state: "hp"
    }
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [hero, goblin, ally, attackActionNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "targets" : ally],
    [hero : "can" : attackActionNode]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  -> @graft.state(goblin, "hp", 3)
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`;

  const result = executeTat(withHpFixture);
  const proj = result.execution.state.projections.get("world") as any;
  // goblin has hp, ally does not — only goblin should appear
  assert.equal(proj.items.length, 1);
  assert.equal(proj.items[0].target.id, "goblin");
});

test("guard binding: Node-suffix stripping resolves action for guard lookup", () => {
  // attackNode -> strip "Node" -> "attack" -> finds registered action
  // This proves the Node-suffix stripping path works even without value.id
  const result = executeTat(`
heroNode = <{ name: "Hero" }>
goblinNode = <{ name: "Goblin" }>
attackNodeValue = <{ name: "Attack" }>

hero = <heroNode>
goblin = <goblinNode>
attackNode = <attackNodeValue>

attack := @action {
  guard: false
  pipeline:
    -> @graft.state(to, "hp", 0)
}

@seed:
  nodes: [hero, goblin, attackNode]
  edges: [
    [hero : "targets" : goblin],
    [hero : "can" : attackNode]
  ]
  state: {}
  meta: {}
  root: hero

world := @seed
  <> @project {
    format: "menu"
    focus: hero
    include: [id, label, action, target, status]
  }
`);

  const proj = result.execution.state.projections.get("world") as any;
  assert.equal(proj.items.length, 0, "guard: false via Node-suffix resolution must filter all items");
});

test("guard binding: apply/menu consistency with value.id pattern", () => {
  // If guard passes → menu shows item AND apply would run
  // If guard fails → menu omits item AND apply would not run
  const passingResult = executeTat(playgroundStyleFixture("true"));
  const failingResult = executeTat(playgroundStyleFixture("false"));

  const passing = passingResult.execution.state.projections.get("world") as any;
  const failing = failingResult.execution.state.projections.get("world") as any;

  assert.equal(passing.items.length, 1, "guard: true — item appears");
  assert.equal(failing.items.length, 0, "guard: false — item omitted");
});
