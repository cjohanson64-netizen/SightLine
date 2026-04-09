"use strict";

const { printAST } = require("./dist/ast/printAST");
const { tokenize } = require("./dist/lexer/tokenize");
const { parse, ParseError } = require("./dist/parser/parse");
const { executeProgram } = require("./dist/runtime/executeProgram");
const { graphToDebugObject } = require("./dist/runtime/graph");
const { validateProgram } = require("./dist/runtime/validateProgram");

function tokenizeTat(source) {
  return tokenize(source);
}

function parseTatToAst(source) {
  return parse(tokenizeTat(source));
}

function printTatAst(source) {
  return printAST(parseTatToAst(source));
}

function parseTat(source) {
  const tokens = tokenizeTat(source);
  const ast = parse(tokens);
  const printedAst = printAST(ast);

  return {
    source,
    tokens,
    ast,
    printedAst,
  };
}

function executeTat(source) {
  const parsed = parseTat(source);
  const validation = validateProgram(parsed.ast);
  const errors = validation.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    const message = errors
      .map((issue) =>
        issue.span?.line && issue.span?.column
          ? `${issue.message} at ${issue.span.line}:${issue.span.column}`
          : issue.message,
      )
      .join("\n");

    throw new Error(`Validation failed:\n${message}`);
  }

  const execution = executeProgram(parsed.ast);
  const graphs = {};

  for (const [name, graph] of execution.state.graphs.entries()) {
    graphs[name] = graphToDebugObject(graph);
  }

  const projections = {};
  for (const [name, projection] of execution.state.projections.entries()) {
    projections[name] = structuredCloneSafe(projection);
  }

  const graphInteractions = {};
  for (const [name, interaction] of execution.state.graphInteractions.entries()) {
    graphInteractions[name] = structuredCloneSafe(interaction);
  }

  const interactionHistory = structuredCloneSafe(execution.state.interactionHistory);
  const values = {};

  for (const [name, value] of execution.state.bindings.values.entries()) {
    values[name] = structuredCloneSafe(value);
  }

  const nodes = {};
  for (const [name, node] of execution.state.bindings.nodes.entries()) {
    nodes[name] = {
      id: node.id,
      value: structuredCloneSafe(node.value),
      state: structuredCloneSafe(node.state),
      meta: structuredCloneSafe(node.meta),
    };
  }

  return {
    ...parsed,
    validation,
    execution,
    debug: {
      graphs,
      projections,
      graphInteractions,
      interactionHistory,
      systemRelations: execution.state.systemRelations,
      queryResults: execution.state.queryResults,
      bindings: {
        values,
        nodes,
      },
    },
  };
}

function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  tokenizeTat,
  parseTatToAst,
  printTatAst,
  parseTat,
  executeTat,
  ParseError,
  tokenize,
  parse,
  printAST,
  executeProgram,
  graphToDebugObject,
  validateProgram,
};
