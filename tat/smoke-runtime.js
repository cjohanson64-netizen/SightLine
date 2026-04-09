const path = require("node:path");
const {
  executeTatModule,
  addBranch,
  setNodeState,
  setNodeMeta,
  graphToDebugObject,
} = require("./dist");

const tatPath = path.join(__dirname, "examples/hero.tat");

const moduleResult = executeTatModule(tatPath);
const graph = moduleResult.state.graphs.get("heroGraph");

if (!graph) {
  throw new Error("heroGraph was not created");
}

console.log("\n--- graph from TAT ---");
console.log(JSON.stringify(graphToDebugObject(graph), null, 2));

addBranch(graph, "hero", "owns", "inventory");
setNodeState(graph, "hero", "hp", 15);
setNodeMeta(graph, "inventory", "slots", 12);

console.log("\n--- graph after JS mutation ---");
console.log(JSON.stringify(graphToDebugObject(graph), null, 2));
