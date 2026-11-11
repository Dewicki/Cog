import { CogError } from "./errors.ts";

export type TokenType = "number" | "string" | "ident" | "keyword" | "op" | "newline" | "eof";

export interface Token {
  readonly type: TokenType;
  /** Source text; for strings, the unescaped content. */
  readonly value: string;
  readonly line: number;
  readonly col: number;
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  "let", "if", "else", "while", "fn", "return", "break", "continue",
  "true", "false", "null", "and", "or", "not",
]);

const TWO_CHAR_OPS: ReadonlySet<string> = new Set(["==", "!=", "<=", ">="]);
const ONE_CHAR_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "{", "}", ","]);

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9" && c.length === 1;
}

function isIdentStart(c: string): boolean {
  return c.length === 1 && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

/**
 * Splits source text into tokens. Newlines are tokens (they end statements),
 * except inside parentheses. Consecutive newlines collapse into one.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let col = 1;
  let parenDepth = 0;

  const push = (type: TokenType, value: string, l: number, c: number): void => {
    tokens.push({ type, value, line: l, col: c });
  };
  const fail = (message: string, l: number, c: number): CogError => new CogError("syntax", message, l, c);

  while (i < n) {
    const ch = source.charAt(i);

    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }

    if (ch === "\n") {
      const last = tokens[tokens.length - 1];
      if (parenDepth === 0 && last !== undefined && last.type !== "newline") {
        push("newline", "\n", line, col);
      }
      i++;
      line++;
      col = 1;
      continue;
    }

    if (ch === "/" && source.charAt(i + 1) === "/") {
      while (i < n && source.charAt(i) !== "\n") {
        i++;
        col++;
      }
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      while (isDigit(source.charAt(i))) i++;
      if (source.charAt(i) === "." && isDigit(source.charAt(i + 1))) {
        i++;
        while (isDigit(source.charAt(i))) i++;
      }
      if (isIdentStart(source.charAt(i))) {
        throw fail(`Invalid number near '${source.slice(start, i + 1)}'`, line, col);
      }
      push("number", source.slice(start, i), line, col);
      col += i - start;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (isIdentPart(source.charAt(i))) i++;
      const word = source.slice(start, i);
      push(KEYWORDS.has(word) ? "keyword" : "ident", word, line, col);
      col += i - start;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let value = "";
      for (;;) {
        const c = source.charAt(j);
        if (j >= n || c === "\n") throw fail("Unterminated string", line, col);
        if (c === '"') break;
        if (c === "\\") {
          const next = source.charAt(j + 1);
          const mapped = ESCAPES[next];
          if (mapped === undefined) throw fail(`Unknown escape '\\${next}'`, line, col + (j - i));
          value += mapped;
          j += 2;
        } else {
          value += c;
          j++;
        }
      }
      j++; // closing quote
      push("string", value, line, col);
      col += j - i;
      i = j;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      push("op", two, line, col);
      i += 2;
      col += 2;
      continue;
    }

    if (ONE_CHAR_OPS.has(ch)) {
      if (ch === "(") parenDepth++;
      if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      push("op", ch, line, col);
      i++;
      col++;
      continue;
    }

    if (ch === "!") {
      throw fail("Unexpected '!': use 'not' for negation ('!=' is not-equal)", line, col);
    }
    throw fail(`Unexpected character '${ch}'`, line, col);
  }

  const last = tokens[tokens.length - 1];
  if (last !== undefined && last.type !== "newline") push("newline", "\n", line, col);
  push("eof", "", line, col);
  return tokens;
}
