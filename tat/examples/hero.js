const path = require("node:path");
const {
  executeTatModule,
  addBranch,
  setNodeState,
  setNodeMeta,
  graphToDebugObject,
} = require("../dist");

// Load the TAT file
const tatPath = path.join(__dirname, "hero.tat");

// Execute TAT
const moduleResult = executeTatModule(tatPath);
const graph = moduleResult.state.graphs.get("heroGraph");

if (!graph) {
  throw new Error("heroGraph was not created");
}

// Before mutation
console.log("\n--- graph from TAT ---");
console.log(JSON.stringify(graphToDebugObject(graph), null, 2));

// JS mutations
addBranch(graph, "hero", "owns", "inventory");
setNodeState(graph, "hero", "hp", 15);
setNodeMeta(graph, "inventory", "slots", 12);

// After mutation
console.log("\n--- graph after JS mutation ---");
console.log(JSON.stringify(graphToDebugObject(graph), null, 2));