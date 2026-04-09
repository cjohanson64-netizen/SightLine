import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  ProgramNode,
} from "../ast/nodeTypes";
import { parse } from "../parser/parse";
import { tokenize } from "../lexer/tokenize";
import {
  executeProgram,
  type RuntimeAssetKind,
  type RuntimeState,
} from "./executeProgram";
import {
  createActionRegistry,
  registerAction,
  type RuntimeAction,
} from "./actionRegistry";
import {
  cloneGraph,
  type Graph,
  type GraphNode,
  type GraphValue,
} from "./graph";
import {
  createRuntimeBindings,
  registerNodeBinding,
} from "./evaluateNodeCapture";
import type { GraphInteraction } from "./executeGraphInteraction";

export interface ModuleAsset {
  kind: RuntimeAssetKind;
  value: GraphNode | Graph | RuntimeAction | GraphInteraction | unknown;
}

export interface LoadedModule {
  path: string;
  source: string;
  ast: ProgramNode;
  state: RuntimeState;
  exports: Map<string, ModuleAsset>;
}

export function executeTatModule(entryPath: string): LoadedModule {
  const cache = new Map<string, LoadedModule>();
  const loading = new Set<string>();
  const normalizedEntry = normalizePath(entryPath);
  return loadModule(normalizedEntry, cache, loading);
}

function loadModule(
  filePath: string,
  cache: Map<string, LoadedModule>,
  loading: Set<string>,
): LoadedModule {
  const normalizedPath = normalizePath(filePath);
  const cached = cache.get(normalizedPath);
  if (cached) {
    return cached;
  }

  if (loading.has(normalizedPath)) {
    throw new Error(`Circular module import detected: ${normalizedPath}`);
  }

  if (!existsSync(normalizedPath)) {
    throw new Error(`Unresolved import path: ${normalizedPath}`);
  }

  loading.add(normalizedPath);
  try {
    const source = readFileSync(normalizedPath, "utf8");
    const ast = parse(tokenize(source));

    const initialState = createImportedInitialState(ast, normalizedPath, cache, loading);
    const execution = executeProgram(ast, { initialState });

    const exportedNames = collectExportNames(ast);
    const exports = new Map<string, ModuleAsset>();

    for (const exportName of exportedNames) {
      const asset = resolveExportAsset(exportName, execution.state);
      if (!asset) {
        throw new Error(`Invalid export reference "${exportName}" in module ${normalizedPath}`);
      }
      exports.set(exportName, asset);
    }

    const loaded: LoadedModule = {
      path: normalizedPath,
      source,
      ast,
      state: execution.state,
      exports,
    };

    cache.set(normalizedPath, loaded);
    return loaded;
  } finally {
    loading.delete(normalizedPath);
  }
}

function createImportedInitialState(
  ast: ProgramNode,
  containingFile: string,
  cache: Map<string, LoadedModule>,
  loading: Set<string>,
): Partial<RuntimeState> {
  const bindings = createRuntimeBindings();
  const actions = createActionRegistry();
  const assetKinds = new Map<string, RuntimeAssetKind>();
  const graphs = new Map<string, Graph>();
  const projections = new Map<string, unknown>();
  const graphInteractions = new Map<string, GraphInteraction>();

  for (const statement of ast.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }

    const modulePath = resolveImportPath(statement.source.value, containingFile);
    const importedModule = loadModule(modulePath, cache, loading);

    for (const specifier of statement.specifiers) {
      const importedName = specifier.imported.name;
      const localName = specifier.local.name;
      const asset = importedModule.exports.get(importedName);

      if (!asset) {
        throw new Error(
          `Unresolved imported symbol "${importedName}" from ${modulePath}`,
        );
      }

      assetKinds.set(localName, asset.kind);

      switch (asset.kind) {
        case "node":
          registerNodeBinding(bindings, localName, cloneGraphNode(asset.value as GraphNode));
          break;

        case "graph":
        case "fragment":
          graphs.set(localName, cloneGraph(asset.value as Graph));
          break;

        case "projection":
          projections.set(localName, structuredCloneSafe(asset.value));
          break;

        case "program":
          registerAction(actions, {
            ...(asset.value as RuntimeAction),
            bindingName: localName,
          });
          break;

        case "interaction":
          graphInteractions.set(localName, structuredCloneSafe(asset.value) as GraphInteraction);
          break;

        default: {
          const _exhaustive: never = asset.kind;
          throw new Error(`Unsupported imported asset kind: ${_exhaustive}`);
        }
      }
    }
  }

  return {
    bindings,
    actions,
    assetKinds,
    graphs,
    projections,
    graphInteractions,
    interactionHistory: [],
  };
}

function collectExportNames(ast: ProgramNode): string[] {
  const names: string[] = [];
  for (const statement of ast.body) {
    if (statement.type !== "ExportDeclaration") {
      continue;
    }
    for (const specifier of statement.specifiers) {
      names.push(specifier.local.name);
    }
  }
  return names;
}

function resolveExportAsset(
  name: string,
  state: RuntimeState,
): ModuleAsset | null {
  const kind = state.assetKinds.get(name);
  if (!kind) {
    return null;
  }

  switch (kind) {
    case "node": {
      const node = state.bindings.nodes.get(name);
      if (!node) return null;
      return { kind, value: cloneGraphNode(node) };
    }

    case "graph":
    case "fragment": {
      const graph = state.graphs.get(name);
      if (!graph) return null;
      return { kind, value: cloneGraph(graph) };
    }

    case "projection": {
      const projection = state.projections.get(name);
      if (projection === undefined) return null;
      return { kind, value: structuredCloneSafe(projection) };
    }

    case "program": {
      const action = state.actions.get(name);
      if (!action) return null;
      return { kind, value: structuredCloneSafe(action) };
    }

    case "interaction": {
      const interaction = state.graphInteractions.get(name);
      if (!interaction) return null;
      return { kind, value: structuredCloneSafe(interaction) };
    }

    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unsupported export kind: ${_exhaustive}`);
    }
  }
}

function resolveImportPath(specifier: string, containingFile: string): string {
  const fromDir = path.dirname(containingFile);
  const rawPath = path.resolve(fromDir, specifier);

  if (existsSync(rawPath)) {
    return normalizePath(rawPath);
  }

  const withTat = `${rawPath}.tat`;
  if (existsSync(withTat)) {
    return normalizePath(withTat);
  }

  throw new Error(`Unresolved import path: ${specifier}`);
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function cloneGraphNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    value: deepClone(node.value),
    state: deepCloneRecord(node.state),
    meta: deepCloneRecord(node.meta),
  };
}

function deepClone<T extends GraphValue>(value: T): T {
  if (value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (typeof value === "object") {
    const out: Record<string, GraphValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = deepClone(v);
    }
    return out as T;
  }

  return value;
}

function deepCloneRecord<T extends Record<string, GraphValue>>(record: T): T {
  const out: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = deepClone(value);
  }
  return out as T;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
