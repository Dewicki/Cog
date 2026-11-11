import test from "node:test";
import assert from "node:assert/strict";
import { CogError, parse } from "../src/index.ts";
import type { Expr } from "../src/index.ts";

function show(e: Expr): string {
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "string":
      return JSON.stringify(e.value);
    case "bool":
      return String(e.value);
    case "null":
      return "null";
    case "ident":
      return e.name;
    case "unary":
      return `(${e.op} ${show(e.operand)})`;
    case "binary":
    case "logical":
      return `(${e.op} ${show(e.left)} ${show(e.right)})`;
    case "call":
      return `(call ${show(e.callee)}${e.args.map((a) => " " + show(a)).join("")})`;
  }
}

function expr(src: string): string {
  const stmt = parse(src).body[0]!;
  assert.equal(stmt.kind, "expr");
  return show((stmt as Extract<typeof stmt, { kind: "expr" }>).expr);
}

function syntaxError(src: string, message: RegExp, line?: number, col?: number): void {
  assert.throws(
    () => parse(src),
    (e: unknown) =>
      e instanceof CogError &&
      e.kind === "syntax" &&
      message.test(e.message) &&
      (line === undefined || e.line === line) &&
      (col === undefined || e.col === col),
  );
}

test("operator precedence and associativity", () => {
  assert.equal(expr("1 + 2 * 3"), "(+ 1 (* 2 3))");
  assert.equal(expr("(1 + 2) * 3"), "(* (+ 1 2) 3)");
  assert.equal(expr("1 - 2 - 3"), "(- (- 1 2) 3)");
  assert.equal(expr("8 / 4 / 2"), "(/ (/ 8 4) 2)");
  assert.equal(expr("-a * b"), "(* (- a) b)");
  assert.equal(expr("a + b < c"), "(< (+ a b) c)");
  assert.equal(expr("a < b == c"), "(== (< a b) c)");
});

test("logical operators and not", () => {
  assert.equal(expr("a or b and c"), "(or a (and b c))");
  assert.equal(expr("not a == b"), "(not (== a b))");
  assert.equal(expr("not not a"), "(not (not a))");
});

test("calls", () => {
  assert.equal(expr("f()"), "(call f)");
  assert.equal(expr("f(1, g(2))"), "(call f 1 (call g 2))");
  assert.equal(expr("f(1)(2)"), "(call (call f 1) 2)");
});

test("literals", () => {
  assert.equal(expr('"hi"'), '"hi"');
  assert.equal(expr("true"), "true");
  assert.equal(expr("null"), "null");
  assert.equal(expr("2.5"), "2.5");
});

test("a binary operator may continue on the next line", () => {
  assert.equal(expr("1 +\n  2"), "(+ 1 2)");
  assert.equal(expr("a and\n b"), "(and a b)");
});

test("let and assignment", () => {
  const p = parse("let x = 1\nx = x + 1");
  assert.deepEqual(p.body.map((s) => s.kind), ["let", "assign"]);
});

test("if / else if / else chain", () => {
  const stmt = parse("if a { }\nelse if b { }\nelse { }").body[0]!;
  assert.equal(stmt.kind, "if");
  if (stmt.kind !== "if") return;
  assert.equal(stmt.alternate?.kind, "if");
  const inner = stmt.alternate;
  if (inner === null || inner.kind !== "if") return assert.fail();
  assert.equal(inner.alternate?.kind, "block");
});

test("an if without else leaves the next statement alone", () => {
  const p = parse("if a {\n}\nlet b = 1");
  assert.equal(p.body.length, 2);
  const first = p.body[0]!;
  assert.equal(first.kind === "if" && first.alternate, null);
});

test("while, fn, return, break, continue", () => {
  const p = parse(`
fn add(a, b) {
  return a + b
}
while true {
  if add(1, 2) == 3 { break }
  continue
}
`);
  assert.deepEqual(p.body.map((s) => s.kind), ["fn", "while"]);
  const fn = p.body[0]!;
  assert.deepEqual(fn.kind === "fn" && fn.params, ["a", "b"]);
});

test("bare return", () => {
  const fn = parse("fn f() {\n  return\n}").body[0]!;
  assert.equal(fn.kind, "fn");
  if (fn.kind !== "fn") return;
  const ret = fn.body.body[0]!;
  assert.equal(ret.kind === "return" && ret.value, null);
});

test("blank lines and comments between statements", () => {
  const p = parse("\n// one\nlet a = 1\n\n\n// two\nlet b = 2\n");
  assert.equal(p.body.length, 2);
});

test("empty program", () => {
  assert.deepEqual(parse("").body, []);
});

test("nodes carry positions", () => {
  const stmt = parse("\n  let x = 5").body[0]!;
  assert.equal(stmt.line, 2);
  assert.equal(stmt.col, 3);
});

test("error: let needs a name and '='", () => {
  syntaxError("let = 1", /Expected a name after 'let'/, 1, 5);
  syntaxError("let x 1", /Expected '=' after variable name 'x'/, 1, 7);
});

test("error: missing expression", () => {
  syntaxError("x = ", /Expected an expression, found end of line/);
  syntaxError("f(1,)", /Expected an expression, found '\)'/, 1, 5);
  syntaxError("}", /Expected an expression, found '}'/, 1, 1);
});

test("error: unclosed brace points at the opening brace", () => {
  syntaxError("if x {\n  y", /Unclosed '\{'/, 1, 6);
});

test("error: missing brace after condition", () => {
  syntaxError("while x\n  y", /Expected '\{' after the while condition/);
});

test("error: two expressions on one line", () => {
  syntaxError("1 2", /expected end of line/, 1, 3);
});

test("error: unclosed parenthesis", () => {
  syntaxError("(1 + 2", /Expected '\)'/);
});

test("error: return outside a function", () => {
  syntaxError("return 1", /'return' outside of a function/, 1, 1);
});

test("error: break and continue outside a loop", () => {
  syntaxError("break", /'break' outside of a loop/);
  syntaxError("continue", /'continue' outside of a loop/);
  syntaxError("while true { fn f() { break } }", /'break' outside of a loop/);
  syntaxError("fn f() {\n  while true { }\n  break\n}", /'break' outside of a loop/, 3, 3);
});

test("error: stray else", () => {
  syntaxError("else { }", /'else' without a matching 'if'/, 1, 1);
});

test("error: duplicate parameter", () => {
  syntaxError("fn f(a, a) { }", /Duplicate parameter 'a'/, 1, 9);
});

test("error: assigning to a non-name", () => {
  syntaxError("f() = 1", /expected end of line/);
});
