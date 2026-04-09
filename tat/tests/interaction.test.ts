import test from "node:test";
import assert from "node:assert/strict";
import { addNode, createGraph } from "../runtime/graph";
import {
  executeGraphInteraction,
  parseTatToAst,
  executeTat,
  type GraphInteraction,
  type GraphInteractionHistoryEntry,
  type GraphWorkspace,
} from "../runtime/index";
import { executeWhy } from "../runtime/executeWhy";

function createWorkspaceWithTarget(
  targetState: Record<string, any>,
): GraphWorkspace {
  const hero = createGraph("hero_root");
  addNode(hero, {
    id: "hero_root",
    value: "hero",
    state: {},
    meta: {},
  });

  const enemy = createGraph("enemy_root");
  addNode(enemy, {
    id: "enemy_root",
    value: "enemy",
    state: targetState,
    meta: {},
  });

  return {
    graphs: new Map([
      ["hero", hero],
      ["enemy", enemy],
    ]),
    interactionHistory: [],
  };
}

test("graph interaction definitions are stored and not executed immediately", () => {
  const result = executeTat(`
attack := @graph(hero) : "attacks" : @graph(enemy)
  -> @effect(
    target: root,
    ops: [
      @graft.state("has", "poison"),
      @derive.state("hp", current - 1)
    ]
  )
`);

  assert.deepEqual(Object.keys(result.debug.graphInteractions), ["attack"]);
  assert.equal(result.debug.graphInteractions.attack.objectGraphId, "enemy");
  assert.equal(result.execution.state.graphs.size, 0);
  assert.deepEqual(result.debug.interactionHistory, []);
});

test("executeGraphInteraction records workspace interaction history and causal graph history", () => {
  const workspace = createWorkspaceWithTarget({ hp: 3 });

  const interaction: GraphInteraction = {
    id: "attack",
    subjectGraphId: "hero",
    relation: "attacks",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        { op: "@graft.state", key: "has", value: "poison" },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
      ],
    },
  };

  const result = executeGraphInteraction(interaction, workspace);
  const updatedEnemy = result.workspace.graphs.get("enemy");
  const untouchedHero = result.workspace.graphs.get("hero");

  assert.deepEqual(result.changedGraphIds, ["enemy"]);
  assert.equal(updatedEnemy?.nodes.get("enemy_root")?.state.has, "poison");
  assert.equal(updatedEnemy?.nodes.get("enemy_root")?.state.hp, 2);
  assert.equal(untouchedHero?.nodes.get("hero_root")?.state.has, undefined);
  assert.equal(result.log.length, 2);
  assert.equal(result.log[0].op, "@graft.state");
  assert.equal(result.log[1].op, "@derive.state");

  const interactionEvent = result.workspace.interactionHistory[0] as GraphInteractionHistoryEntry;
  assert.equal(interactionEvent.op, "@interaction");
  assert.equal(interactionEvent.definitionId, "attack");
  assert.equal(interactionEvent.subjectGraphId, "hero");
  assert.equal(interactionEvent.objectGraphId, "enemy");
  assert.equal(interactionEvent.targetNodeId, "enemy_root");
  assert.equal(interactionEvent.effectEntryIds.length, 2);
  assert.equal(interactionEvent.summary?.effects?.length, 2);

  const history = updatedEnemy?.history ?? [];
  assert.equal(history[0].op, "@graft.state");
  assert.equal(history[1].op, "@derive.state");
  assert.equal(history[0].causedBy, interactionEvent.id);
  assert.equal(history[1].causedBy, interactionEvent.id);
  assert.deepEqual(
    history.map((entry) => entry.id),
    interactionEvent.effectEntryIds,
  );
});

test("@derive.state uses append semantics for non-numeric +", () => {
  const interaction: GraphInteraction = {
    id: "buff",
    subjectGraphId: "bard",
    relation: "inspires",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "has",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "literal", value: "inspired" },
          },
        },
      ],
    },
  };

  const arrayResult = executeGraphInteraction(
    interaction,
    createWorkspaceWithTarget({ has: ["poison"] }),
  );
  assert.deepEqual(
    arrayResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["poison", "inspired"],
  );

  const scalarResult = executeGraphInteraction(
    interaction,
    createWorkspaceWithTarget({ has: "poison" }),
  );
  assert.deepEqual(
    scalarResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["poison", "inspired"],
  );

  const missingResult = executeGraphInteraction(interaction, createWorkspaceWithTarget({}));
  assert.deepEqual(
    missingResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.has,
    ["inspired"],
  );
});

test("@derive.state keeps previous stable across the whole effect and errors on missing numeric current", () => {
  const stablePreviousInteraction: GraphInteraction = {
    id: "combo",
    subjectGraphId: "hero",
    relation: "combos",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "previous" },
          },
        },
      ],
    },
  };

  const stableResult = executeGraphInteraction(
    stablePreviousInteraction,
    createWorkspaceWithTarget({ hp: 5 }),
  );
  assert.equal(
    stableResult.workspace.graphs.get("enemy")?.nodes.get("enemy_root")?.state.hp,
    9,
  );

  const missingCurrentInteraction: GraphInteraction = {
    id: "heal",
    subjectGraphId: "cleric",
    relation: "heals",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "+",
            left: { kind: "current" },
            right: { kind: "literal", value: 2 },
          },
        },
      ],
    },
  };

  assert.throws(
    () => executeGraphInteraction(missingCurrentInteraction, createWorkspaceWithTarget({})),
    /Missing current for numeric derive/,
  );
});

test("@why(nodeId) includes linked interaction provenance for interaction-driven mutations", () => {
  const workspace = createWorkspaceWithTarget({ hp: 3 });
  const interaction: GraphInteraction = {
    id: "strike",
    subjectGraphId: "hero",
    relation: "attacks",
    objectGraphId: "enemy",
    effect: {
      target: "root",
      ops: [
        { op: "@graft.state", key: "has", value: "poison" },
        {
          op: "@derive.state",
          key: "hp",
          expression: {
            kind: "binary",
            operator: "-",
            left: { kind: "current" },
            right: { kind: "literal", value: 1 },
          },
        },
      ],
    },
  };

  const executed = executeGraphInteraction(interaction, workspace);
  const graph = executed.workspace.graphs.get("enemy");
  assert.ok(graph);

  const ast = parseTatToAst(`@why(enemy_root)`);
  const stmt = ast.body[0];
  assert.equal(stmt.type, "QueryStatement");
  const result = executeWhy(graph, stmt.expr, executed.workspace);

  assert.equal(result.kind, "ReasonResultSet");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].because.length, 2);
  assert.equal(result.items[0].becauseInteractions.length, 1);
  assert.equal(result.items[0].becauseInteractions[0].definitionId, "strike");
  assert.deepEqual(
    result.items[0].because.map((entry) => entry.causedBy),
    [result.items[0].becauseInteractions[0].id, result.items[0].becauseInteractions[0].id],
  );
});
