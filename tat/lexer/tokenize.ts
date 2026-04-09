export type TokenType =
  | "IDENT"
  | "KEYWORD"
  | "STRING"
  | "NUMBER"
  | "BOOLEAN"
  | "REGEX"
  | "WILDCARD"
  | "EQUALS"
  | "COLON_EQUALS"
  | "EQ2"
  | "EQ3"
  | "NEQ2"
  | "NEQ3"
  | "AND"
  | "OR"
  | "BANG"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "DOT"
  | "DDOT"
  | "COLON"
  | "DCOLON"
  | "TCOLON"
  | "ARROW"
  | "PROJECT"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "LANGLE"
  | "RANGLE"
  | "COMMA"
  | "NEWLINE"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  index: number;
}

const KEYWORDS = new Set([
  "@seed",
  "@match",
  "@path",
  "@where",
  "@query",
  "@why",
  "@how",
  "@project",
  "@compose",
  "@graph",
  "@effect",
  "@action",
  "@loop",
  "@if",
  "@when",
  "@bind",
  "@bind.ctx",
  "@bind.ctx.node",
  "@bind.ctx.edge",
  "@bind.state",
  "@bind.state.node",
  "@bind.state.edge",
  "@bind.meta",
  "@bind.meta.node",
  "@bind.meta.edge",
  "@ctx",
  "@ctx.set",
  "@ctx.clear",
  "@graft.branch",
  "@graft.state",
  "@graft.meta",
  "@graft.progress",
  "@prune.branch",
  "@prune.state",
  "@prune.meta",
  "@prune.nodes",
  "@prune.edges",
  "@derive.state",
  "@derive.meta",
  "@apply",
]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isKeywordPart(ch: string): boolean {
  return /[A-Za-z0-9_.@]/.test(ch);
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
    public readonly index: number,
  ) {
    super(`${message} at ${line}:${column}`);
    this.name = "TokenizeError";
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];

  let i = 0;
  let line = 1;
  let column = 1;

  function current(offset = 0): string {
    return source[i + offset] ?? "";
  }

  function advance(count = 1): void {
    for (let j = 0; j < count; j++) {
      const ch = source[i];
      i += 1;
      if (ch === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  }

  function addToken(
    type: TokenType,
    value: string,
    startLine: number,
    startColumn: number,
    startIndex: number,
  ): void {
    tokens.push({
      type,
      value,
      line: startLine,
      column: startColumn,
      index: startIndex,
    });
  }

  function match(value: string): boolean {
    return source.startsWith(value, i);
  }

  function skipLineComment(): void {
    while (i < source.length && current() !== "\n") {
      advance();
    }
  }

  function readString(): void {
    const quote = current();
    const startLine = line;
    const startColumn = column;
    const startIndex = i;

    let value = quote;
    advance();

    while (i < source.length) {
      const ch = current();

      if (ch === "\\") {
        value += ch;
        advance();

        if (i >= source.length) {
          throw new TokenizeError(
            "Unterminated escape sequence in string",
            line,
            column,
            i,
          );
        }

        value += current();
        advance();
        continue;
      }

      if (ch === quote) {
        value += ch;
        advance();
        addToken("STRING", value, startLine, startColumn, startIndex);
        return;
      }

      if (ch === "\n") {
        throw new TokenizeError(
          "Unterminated string literal",
          startLine,
          startColumn,
          startIndex,
        );
      }

      value += ch;
      advance();
    }

    throw new TokenizeError(
      "Unterminated string literal",
      startLine,
      startColumn,
      startIndex,
    );
  }

  function readNumber(): void {
    const startLine = line;
    const startColumn = column;
    const startIndex = i;

    let value = "";

    while (isDigit(current())) {
      value += current();
      advance();
    }

    if (current() === "." && isDigit(current(1))) {
      value += current();
      advance();

      while (isDigit(current())) {
        value += current();
        advance();
      }
    }

    addToken("NUMBER", value, startLine, startColumn, startIndex);
  }

  function readIdentifier(): void {
    const startLine = line;
    const startColumn = column;
    const startIndex = i;

    let value = "";

    while (isIdentPart(current())) {
      value += current();
      advance();
    }

    if (value === "true" || value === "false") {
      addToken("BOOLEAN", value, startLine, startColumn, startIndex);
      return;
    }

    addToken("IDENT", value, startLine, startColumn, startIndex);
  }

  function readKeyword(): void {
    const startLine = line;
    const startColumn = column;
    const startIndex = i;

    let value = "";

    while (isKeywordPart(current())) {
      value += current();
      advance();
    }

    if (!KEYWORDS.has(value)) {
      throw new TokenizeError(
        `Unknown keyword "${value}"`,
        startLine,
        startColumn,
        startIndex,
      );
    }

    addToken("KEYWORD", value, startLine, startColumn, startIndex);
  }

  function isRegexStart(): boolean {
    const ch = current();
    if (ch !== "/") return false;

    const prev = tokens[tokens.length - 1];
    if (!prev) return true;

    // Conservative rule: allow regex after delimiters, operators, newline, or keywords.
    return (
      prev.type === "NEWLINE" ||
      prev.type === "LPAREN" ||
      prev.type === "LBRACKET" ||
      prev.type === "LBRACE" ||
      prev.type === "COMMA" ||
      prev.type === "COLON" ||
      prev.type === "DCOLON" ||
      prev.type === "TCOLON" ||
      prev.type === "EQUALS" ||
      prev.type === "COLON_EQUALS" ||
      prev.type === "ARROW" ||
      prev.type === "PROJECT" ||
      prev.type === "KEYWORD"
    );
  }

  function readRegex(): void {
    const startLine = line;
    const startColumn = column;
    const startIndex = i;

    let value = "";
    let escaped = false;

    value += current();
    advance(); // initial /

    while (i < source.length) {
      const ch = current();

      value += ch;
      advance();

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === "/") {
        while (/[a-z]/i.test(current())) {
          value += current();
          advance();
        }

        addToken("REGEX", value, startLine, startColumn, startIndex);
        return;
      }

      if (ch === "\n") {
        throw new TokenizeError(
          "Unterminated regex literal",
          startLine,
          startColumn,
          startIndex,
        );
      }
    }

    throw new TokenizeError(
      "Unterminated regex literal",
      startLine,
      startColumn,
      startIndex,
    );
  }

  while (i < source.length) {
    const ch = current();

    if (isWhitespace(ch)) {
      advance();
      continue;
    }

    if (ch === "\n") {
      addToken("NEWLINE", "\n", line, column, i);
      advance();
      continue;
    }

    if (match("//")) {
      skipLineComment();
      continue;
    }

    if (match(":::")) {
      addToken("TCOLON", ":::", line, column, i);
      advance(3);
      continue;
    }

    if (match("::")) {
      addToken("DCOLON", "::", line, column, i);
      advance(2);
      continue;
    }
    if (match("===")) {
      addToken("EQ3", "===", line, column, i);
      advance(3);
      continue;
    }

    if (match("!==")) {
      addToken("NEQ3", "!==", line, column, i);
      advance(3);
      continue;
    }

    if (match("==")) {
      addToken("EQ2", "==", line, column, i);
      advance(2);
      continue;
    }

    if (match("!=")) {
      addToken("NEQ2", "!=", line, column, i);
      advance(2);
      continue;
    }

    if (match("&&")) {
      addToken("AND", "&&", line, column, i);
      advance(2);
      continue;
    }

    if (match("||")) {
      addToken("OR", "||", line, column, i);
      advance(2);
      continue;
    }

    if (ch === "!") {
      addToken("BANG", "!", line, column, i);
      advance();
      continue;
    }

    if (ch === "+") {
      addToken("PLUS", "+", line, column, i);
      advance();
      continue;
    }

    if (ch === "*") {
      addToken("STAR", "*", line, column, i);
      advance();
      continue;
    }

    if (match(":=")) {
      addToken("COLON_EQUALS", ":=", line, column, i);
      advance(2);
      continue;
    }

    if (match("->")) {
      addToken("ARROW", "->", line, column, i);
      advance(2);
      continue;
    }

    if (ch === "-") {
      addToken("MINUS", "-", line, column, i);
      advance();
      continue;
    }

    if (match("<>")) {
      addToken("PROJECT", "<>", line, column, i);
      advance(2);
      continue;
    }

    if (match("..")) {
      addToken("DDOT", "..", line, column, i);
      advance(2);
      continue;
    }

    if (ch === "=") {
      addToken("EQUALS", "=", line, column, i);
      advance();
      continue;
    }

    if (ch === ".") {
      addToken("DOT", ".", line, column, i);
      advance();
      continue;
    }

    if (ch === ":") {
      addToken("COLON", ":", line, column, i);
      advance();
      continue;
    }

    if (ch === "(") {
      addToken("LPAREN", "(", line, column, i);
      advance();
      continue;
    }

    if (ch === ")") {
      addToken("RPAREN", ")", line, column, i);
      advance();
      continue;
    }

    if (ch === "[") {
      addToken("LBRACKET", "[", line, column, i);
      advance();
      continue;
    }

    if (ch === "]") {
      addToken("RBRACKET", "]", line, column, i);
      advance();
      continue;
    }

    if (ch === "{") {
      addToken("LBRACE", "{", line, column, i);
      advance();
      continue;
    }

    if (ch === "}") {
      addToken("RBRACE", "}", line, column, i);
      advance();
      continue;
    }

    if (ch === "<") {
      addToken("LANGLE", "<", line, column, i);
      advance();
      continue;
    }

    if (ch === ">") {
      addToken("RANGLE", ">", line, column, i);
      advance();
      continue;
    }

    if (ch === ",") {
      addToken("COMMA", ",", line, column, i);
      advance();
      continue;
    }

    if (ch === "_") {
      addToken("WILDCARD", "_", line, column, i);
      advance();
      continue;
    }

    if (ch === '"' || ch === "'") {
      readString();
      continue;
    }

    if (ch === "@") {
      readKeyword();
      continue;
    }

    if (ch === "/") {
      if (isRegexStart()) {
        readRegex();
      } else {
        addToken("SLASH", "/", line, column, i);
        advance();
      }
      continue;
    }

    if (isDigit(ch)) {
      readNumber();
      continue;
    }

    if (isIdentStart(ch)) {
      readIdentifier();
      continue;
    }

    throw new TokenizeError(`Unexpected character "${ch}"`, line, column, i);
  }

  addToken("EOF", "", line, column, i);
  return tokens;
}
