import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../lexer/tokenize";

function types(source: string): string[] {
  return tokenize(source).map((token) => token.type);
}

function values(source: string): string[] {
  return tokenize(source).map((token) => token.value);
}

test("tokenizes simple node binding", () => {
  const source = `A = <Ti>`;

  assert.deepEqual(types(source), [
    "IDENT",
    "EQUALS",
    "LANGLE",
    "IDENT",
    "RANGLE",
    "EOF",
  ]);

  assert.deepEqual(values(source), [
    "A",
    "=",
    "<",
    "Ti",
    ">",
    "",
  ]);
});

test("tokenizes traversal node capture", () => {
  const source = `node1 = <A.x.B..y..C.z.D>`;

  assert.deepEqual(types(source), [
    "IDENT",
    "EQUALS",
    "LANGLE",
    "IDENT",
    "DOT",
    "IDENT",
    "DOT",
    "IDENT",
    "DDOT",
    "IDENT",
    "DDOT",
    "IDENT",
    "DOT",
    "IDENT",
    "DOT",
    "IDENT",
    "RANGLE",
    "EOF",
  ]);
});

test("tokenizes @seed block fields", () => {
  const source = `@seed:
  nodes: [node1, node2]
  edges: []
  state: {}
  meta: {}
  root: node1`;

  assert.deepEqual(types(source), [
    "KEYWORD",
    "COLON",
    "NEWLINE",
    "IDENT",
    "COLON",
    "LBRACKET",
    "IDENT",
    "COMMA",
    "IDENT",
    "RBRACKET",
    "NEWLINE",
    "IDENT",
    "COLON",
    "LBRACKET",
    "RBRACKET",
    "NEWLINE",
    "IDENT",
    "COLON",
    "LBRACE",
    "RBRACE",
    "NEWLINE",
    "IDENT",
    "COLON",
    "LBRACE",
    "RBRACE",
    "NEWLINE",
    "IDENT",
    "COLON",
    "IDENT",
    "EOF",
  ]);
});

test("tokenizes graph pipeline operators", () => {
  const source = `graph1 := @seed
  -> @graft.branch(node1, "supports", node2)
  <> @project(format: "graph")`;

  assert.deepEqual(types(source), [
    "IDENT",
    "COLON_EQUALS",
    "KEYWORD",
    "NEWLINE",
    "ARROW",
    "KEYWORD",
    "LPAREN",
    "IDENT",
    "COMMA",
    "STRING",
    "COMMA",
    "IDENT",
    "RPAREN",
    "NEWLINE",
    "PROJECT",
    "KEYWORD",
    "LPAREN",
    "IDENT",
    "COLON",
    "STRING",
    "RPAREN",
    "EOF",
  ]);
});

test("tokenizes system relation :::", () => {
  const source = `graph1 ::: graph2`;

  assert.deepEqual(types(source), [
    "IDENT",
    "TCOLON",
    "IDENT",
    "EOF",
  ]);

  assert.deepEqual(values(source), [
    "graph1",
    ":::",
    "graph2",
    "",
  ]);
});

test("tokenizes boolean and comparison operators in @where", () => {
  const source = `@where(Y.priority == "high" && Y.active === true || !Y.blocked)`;

  assert.deepEqual(types(source), [
    "KEYWORD",
    "LPAREN",
    "IDENT",
    "DOT",
    "IDENT",
    "EQ2",
    "STRING",
    "AND",
    "IDENT",
    "DOT",
    "IDENT",
    "EQ3",
    "BOOLEAN",
    "OR",
    "BANG",
    "IDENT",
    "DOT",
    "IDENT",
    "RPAREN",
    "EOF",
  ]);
});

test("tokenizes regex in @match", () => {
  const source = `@match(X : /support.*/ : Y)`;

  assert.deepEqual(types(source), [
    "KEYWORD",
    "LPAREN",
    "IDENT",
    "COLON",
    "REGEX",
    "COLON",
    "IDENT",
    "RPAREN",
    "EOF",
  ]);

  assert.deepEqual(values(source), [
    "@match",
    "(",
    "X",
    ":",
    "/support.*/",
    ":",
    "Y",
    ")",
    "",
  ]);
});

test("tokenizes wildcard in @match", () => {
  const source = `@match(_ : "supports" : Y)`;

  assert.deepEqual(types(source), [
    "KEYWORD",
    "LPAREN",
    "WILDCARD",
    "COLON",
    "STRING",
    "COLON",
    "IDENT",
    "RPAREN",
    "EOF",
  ]);
});

test("ignores // line comments", () => {
  const source = `A = <Ti> // comment here
B = <Do>`;

  assert.deepEqual(types(source), [
    "IDENT",
    "EQUALS",
    "LANGLE",
    "IDENT",
    "RANGLE",
    "NEWLINE",
    "IDENT",
    "EQUALS",
    "LANGLE",
    "IDENT",
    "RANGLE",
    "EOF",
  ]);
});

test("tracks line and column positions", () => {
  const source = `A = <Ti>
B = <Do>`;

  const tokens = tokenize(source);

  assert.equal(tokens[0].type, "IDENT");
  assert.equal(tokens[0].value, "A");
  assert.equal(tokens[0].line, 1);
  assert.equal(tokens[0].column, 1);

  const bToken = tokens.find((token) => token.type === "IDENT" && token.value === "B");
  assert.ok(bToken);
  assert.equal(bToken.line, 2);
  assert.equal(bToken.column, 1);
});

test("tokenizes compose and selective prune keywords", () => {
  const source = `graph1 := @compose([a], merge: root)
  -> @prune.nodes(@where(type == "option"))
  -> @prune.edges(@where(rel == "offers"))`;

  const tokenValues = values(source);
  assert.ok(tokenValues.includes("@compose"));
  assert.ok(tokenValues.includes("@prune.nodes"));
  assert.ok(tokenValues.includes("@prune.edges"));
});
