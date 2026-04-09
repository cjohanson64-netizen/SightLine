import { printAST } from "./ast/printAST";
import { tokenize, type Token } from "./lexer/tokenize";
import { parse, ParseError } from "./parser/parse";
import type { ProgramNode } from "./ast/nodeTypes";

export interface TatParseResult {
  source: string;
  tokens: Token[];
  ast: ProgramNode;
  printedAst: string;
}

export function tokenizeTat(source: string): Token[] {
  return tokenize(source);
}

export function parseTatToAst(source: string): ProgramNode {
  return parse(tokenizeTat(source));
}

export function printTatAst(source: string): string {
  return printAST(parseTatToAst(source));
}

export function parseTat(source: string): TatParseResult {
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

export type { Token, ProgramNode };
export { ParseError, tokenize, parse, printAST };

// runtime exports
export { executeTatModule } from "./runtime/executeModule";
export {
  addBranch,
  removeBranch,
  addProgress,
  setNodeState,
  removeNodeState,
  setNodeMeta,
  removeNodeMeta,
  cloneGraph,
  graphToDebugObject,
} from "./runtime/graph";