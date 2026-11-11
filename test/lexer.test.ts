import test from "node:test";
import assert from "node:assert/strict";
import { CogError, tokenize } from "../src/index.ts";

const kinds = (src: string): string[] => tokenize(src).map((t) => `${t.type}:${t.value}`);

function syntaxError(src: string, message: RegExp, line: number, col: number): void {
  assert.throws(
    () => tokenize(src),
    (e: unknown) =>
      e instanceof CogError &&
      e.kind === "syntax" &&
      message.test(e.message) &&
      e.line === line &&
      e.col === col,
  );
}

test("tokenizes a simple statement", () => {
  assert.deepEqual(kinds("let x = 1 + 2"), [
    "keyword:let", "ident:x", "op:=", "number:1", "op:+", "number:2", "newline:\n", "eof:",
  ]);
});

test("tracks line and column (1-based)", () => {
  const toks = tokenize("let x\n  y");
  const y = toks.find((t) => t.value === "y")!;
  assert.equal(y.line, 2);
  assert.equal(y.col, 3);
  const x = toks.find((t) => t.value === "x")!;
  assert.equal(x.line, 1);
  assert.equal(x.col, 5);
});

test("skips comments and keeps the newline", () => {
  assert.deepEqual(kinds("a // hi there\nb"), [
    "ident:a", "newline:\n", "ident:b", "newline:\n", "eof:",
  ]);
});

test("collapses blank lines and drops leading ones", () => {
  assert.deepEqual(kinds("\n\na\n\n\nb"), ["ident:a", "newline:\n", "ident:b", "newline:\n", "eof:"]);
});

test("ignores newlines inside parentheses", () => {
  assert.deepEqual(kinds("f(1,\n 2)"), [
    "ident:f", "op:(", "number:1", "op:,", "number:2", "op:)", "newline:\n", "eof:",
  ]);
});

test("two-character operators", () => {
  assert.deepEqual(kinds("a == b != c <= d >= e").filter((k) => k.startsWith("op:")), [
    "op:==", "op:!=", "op:<=", "op:>=",
  ]);
});

test("numbers: integers and decimals", () => {
  assert.deepEqual(kinds("3.14 42").slice(0, 2), ["number:3.14", "number:42"]);
});

test("strings with escapes", () => {
  const toks = tokenize(String.raw`"a\nb\"c\\d"`);
  assert.equal(toks[0]!.type, "string");
  assert.equal(toks[0]!.value, 'a\nb"c\\d');
});

test("keywords versus identifiers", () => {
  assert.deepEqual(kinds("while whiles").slice(0, 2), ["keyword:while", "ident:whiles"]);
});

test("empty source is just eof", () => {
  assert.deepEqual(kinds(""), ["eof:"]);
});

test("error: unterminated string", () => {
  syntaxError('let s = "abc', /Unterminated string/, 1, 9);
  syntaxError('"abc\ndef"', /Unterminated string/, 1, 1);
});

test("error: unknown escape", () => {
  syntaxError(String.raw`"a\qb"`, /Unknown escape/, 1, 3);
});

test("error: unexpected character", () => {
  syntaxError("let x = @", /Unexpected character '@'/, 1, 9);
});

test("error: '!' suggests 'not'", () => {
  syntaxError("!x", /use 'not'/, 1, 1);
});

test("error: malformed numbers", () => {
  syntaxError("12abc", /Invalid number/, 1, 1);
  syntaxError("1.", /Unexpected character '\.'/, 1, 2);
});
