import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK, CogError, Machine, formatValue } from "../src/index.ts";
import type { MachineOptions, Value } from "../src/index.ts";

function exec(source: string, options: MachineOptions = {}) {
  const out: string[] = [];
  const machine = new Machine(source, {
    ...options,
    builtins: {
      print: (args) => {
        out.push(args.map(formatValue).join(" "));
        return null;
      },
      ...options.builtins,
    },
  });
  const result = machine.run();
  return { out, machine, result };
}

function printed(source: string, options?: MachineOptions): string[] {
  const { out, result } = exec(source, options);
  assert.equal(result.error?.message, undefined);
  assert.equal(result.status, "halted");
  return out;
}

function runtimeError(source: string, message: RegExp, line?: number, col?: number): void {
  const { result } = exec(source);
  assert.equal(result.status, "error");
  const err = result.error!;
  assert.ok(err instanceof CogError);
  assert.equal(err.kind, "runtime");
  assert.match(err.message, message);
  if (line !== undefined) assert.equal(err.line, line);
  if (col !== undefined) assert.equal(err.col, col);
}

// ---- expressions -------------------------------------------------------------

test("arithmetic", () => {
  assert.deepEqual(printed("print(1 + 2 * 3)"), ["7"]);
  assert.deepEqual(printed("print(10 / 4)"), ["2.5"]);
  assert.deepEqual(printed("print(7 % 3)"), ["1"]);
  assert.deepEqual(printed("print(-2 + 5)"), ["3"]);
  assert.deepEqual(printed("print((1 + 2) * 3)"), ["9"]);
});

test("strings", () => {
  assert.deepEqual(printed('print("a" + "b")'), ["ab"]);
  assert.deepEqual(printed('print("n=" + 3)'), ["n=3"]);
  assert.deepEqual(printed('print("x" + true + null)'), ["xtruenull"]);
  assert.deepEqual(printed('print("a" < "b", "b" < "a")'), ["true false"]);
});

test("equality does not coerce", () => {
  assert.deepEqual(printed('print(1 == 1, "1" == 1, null == null, true != false)'), [
    "true false true true",
  ]);
});

test("truthiness: false, null, 0 and empty string are falsy", () => {
  const src = (v: string) => `if ${v} { print("T") } else { print("F") }`;
  assert.deepEqual(printed(src("0")), ["F"]);
  assert.deepEqual(printed(src('""')), ["F"]);
  assert.deepEqual(printed(src("null")), ["F"]);
  assert.deepEqual(printed(src("false")), ["F"]);
  assert.deepEqual(printed(src("1")), ["T"]);
  assert.deepEqual(printed(src('"a"')), ["T"]);
});

test("and / or short-circuit and return an operand", () => {
  const prelude = 'fn boom() {\n print("boom")\n return true\n}\n';
  assert.deepEqual(printed(prelude + "print(false and boom())"), ["false"]);
  assert.deepEqual(printed(prelude + "print(true or boom())"), ["true"]);
  assert.deepEqual(printed('print(0 or "x")'), ["x"]);
  assert.deepEqual(printed("print(1 and 2)"), ["2"]);
  assert.deepEqual(printed("print(not 0, not 1)"), ["true false"]);
});

// ---- statements --------------------------------------------------------------

test("variables and block scope", () => {
  assert.deepEqual(printed("let x = 1\nif true {\n  let x = 2\n  print(x)\n}\nprint(x)"), ["2", "1"]);
  assert.deepEqual(printed("let n = 0\nwhile n < 3 { n = n + 1 }\nprint(n)"), ["3"]);
});

test("while with break and continue", () => {
  const src = `
let i = 0
let sum = 0
while true {
  i = i + 1
  if i > 5 { break }
  if i % 2 == 0 { continue }
  sum = sum + i
}
print(sum)
`;
  assert.deepEqual(printed(src), ["9"]);
});

test("else if chain", () => {
  const src = (n: number) => `
let n = ${n}
if n < 0 { print("neg") } else if n == 0 { print("zero") } else { print("pos") }
`;
  assert.deepEqual(printed(src(-1)), ["neg"]);
  assert.deepEqual(printed(src(0)), ["zero"]);
  assert.deepEqual(printed(src(9)), ["pos"]);
});

// ---- functions ---------------------------------------------------------------

test("recursion", () => {
  const src = `
fn fib(n) {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}
print(fib(10))
`;
  assert.deepEqual(printed(src), ["55"]);
});

test("functions return null by default", () => {
  assert.deepEqual(printed("fn f() { }\nprint(f())"), ["null"]);
  assert.deepEqual(printed("fn f() {\n return\n}\nprint(f())"), ["null"]);
});

test("closures keep their own state", () => {
  const src = `
fn counter() {
  let n = 0
  fn next() {
    n = n + 1
    return n
  }
  return next
}
let a = counter()
let b = counter()
print(a(), a(), a(), b())
`;
  assert.deepEqual(printed(src), ["1 2 3 1"]);
});

test("return from inside a loop", () => {
  const src = `
fn find(limit) {
  let i = 0
  while true {
    i = i + 1
    if i * i > limit { return i }
  }
}
print(find(50))
`;
  assert.deepEqual(printed(src), ["8"]);
});

test("functions are values", () => {
  assert.deepEqual(printed("fn f() { }\nprint(f == f, f == print)"), ["true false"]);
  assert.deepEqual(printed("fn f() { }\nprint(f)"), ["<fn f>"]);
});

// ---- host interface ----------------------------------------------------------

test("globals and builtins", () => {
  const options: MachineOptions = {
    globals: { LEFT: 0, RIGHT: 1 },
    builtins: { twice: (args) => (args[0] as number) * 2 },
  };
  assert.deepEqual(printed("print(twice(RIGHT + 20))", options), ["42"]);
});

test("a program may shadow a global", () => {
  assert.deepEqual(printed("let LEFT = 5\nprint(LEFT)", { globals: { LEFT: 0 } }), ["5"]);
});

test("a host function returning nothing yields null", () => {
  assert.deepEqual(printed("print(noop())", { builtins: { noop: () => {} } }), ["null"]);
});

test("machine.get reads top-level variables", () => {
  const { machine } = exec("let answer = 6 * 7");
  assert.equal(machine.get("answer"), 42);
  assert.equal(machine.get("missing"), undefined);
});

test("a throwing host function becomes a runtime error", () => {
  const { result } = exec("let a = 1\nboom()", {
    builtins: {
      boom: () => {
        throw new Error("kaboom");
      },
    },
  });
  assert.equal(result.status, "error");
  assert.equal(result.error?.message, "kaboom");
  assert.equal(result.error?.line, 2);
});

// ---- stepping ----------------------------------------------------------------

test("one statement per step", () => {
  const m = new Machine("let a = 1\nlet b = 2");
  assert.deepEqual([m.step().status, m.step().status, m.step().status], ["running", "running", "halted"]);
  assert.equal(m.steps, 2);
});

test("step counting for a loop", () => {
  const { machine } = exec("let i = 0\nwhile i < 3 {\n  i = i + 1\n}");
  // let (1) + 3 iterations * (condition + assignment) + final condition (1)
  assert.equal(machine.steps, 8);
});

test("if counts one step for its condition", () => {
  const { machine } = exec("if true {\n  let a = 1\n}");
  assert.equal(machine.steps, 2);
});

test("empty program halts immediately", () => {
  const m = new Machine("");
  assert.equal(m.step().status, "halted");
});

test("stepping a finished machine changes nothing", () => {
  const m = new Machine("let a = 1");
  m.run();
  const ticks = m.ticks;
  assert.equal(m.step().status, "halted");
  assert.equal(m.ticks, ticks);
});

test("line follows the statement just executed", () => {
  const m = new Machine("let a = 1\nlet b = 2\nlet c = 3");
  m.step();
  assert.equal(m.line, 1);
  m.step();
  assert.equal(m.line, 2);
  m.step();
  assert.equal(m.line, 3);
});

test("line returns to the caller after a function call", () => {
  const m = new Machine("fn f() {\n  return 1\n}\nlet x = 0\nlet y = f()\nlet z = 3");
  for (let i = 0; i < 20 && m.status !== "halted"; i++) {
    const before = m.get("y");
    m.step();
    if (before === undefined && m.get("y") !== undefined) assert.equal(m.line, 5);
  }
  assert.equal(m.get("y"), 1);
});

test("run stops at maxTicks", () => {
  const m = new Machine("while true { }");
  const r = m.run(10);
  assert.equal(r.status, "running");
  assert.equal(m.ticks, 10);
});

// ---- blocking ----------------------------------------------------------------

test("a blocked host call is retried on the next step", () => {
  const queue: number[] = [];
  const m = new Machine("let x = recv()\nlet y = x * 2", {
    builtins: { recv: () => (queue.length > 0 ? queue.shift()! : BLOCK) },
  });
  assert.equal(m.step().status, "blocked");
  assert.equal(m.step().status, "blocked");
  assert.equal(m.line, 1);
  queue.push(21);
  assert.equal(m.step().status, "running");
  assert.equal(m.get("x"), 21);
  assert.equal(m.step().status, "running");
  assert.equal(m.step().status, "halted");
  assert.equal(m.get("y"), 42);
  assert.equal(m.steps, 2);
  assert.equal(m.ticks, 5);
});

test("a call is not repeated while the program is blocked elsewhere", () => {
  let calls = 0;
  const m = new Machine("count()\nwait()", {
    builtins: {
      count: () => {
        calls++;
      },
      wait: () => BLOCK,
    },
  });
  m.run(10);
  assert.equal(calls, 1);
  assert.equal(m.status, "blocked");
});

test("two machines in lockstep form a pipeline", () => {
  const input = [1, 2, 3];
  const middle: number[] = [];
  const output: number[] = [];

  const doubler = new Machine("while true {\n  let x = recv()\n  send(x * 2)\n}", {
    builtins: {
      recv: () => (input.length > 0 ? input.shift()! : BLOCK),
      send: (args) => {
        middle.push(args[0] as number);
      },
    },
  });
  const incrementer = new Machine("while true {\n  let x = recv()\n  send(x + 1)\n}", {
    builtins: {
      recv: () => (middle.length > 0 ? middle.shift()! : BLOCK),
      send: (args) => {
        output.push(args[0] as number);
      },
    },
  });

  for (let tick = 0; tick < 60; tick++) {
    doubler.step();
    incrementer.step();
  }
  assert.deepEqual(output, [3, 5, 7]);
  assert.equal(doubler.status, "blocked");
  assert.equal(incrementer.status, "blocked");
});

// ---- limits ------------------------------------------------------------------

test("an infinite loop hits the step limit instead of hanging", () => {
  const m = new Machine("while true { }", { maxSteps: 100 });
  const r = m.run(Infinity);
  assert.equal(r.status, "error");
  assert.match(r.error!.message, /Step limit of 100 exceeded/);
});

test("runaway recursion hits the call depth limit", () => {
  const src = "fn f(n) {\n  return f(n + 1)\n}\nf(0)";
  const small = new Machine(src, { maxCallDepth: 50 });
  assert.match(small.run().error!.message, /Maximum call depth of 50 exceeded/);
  const byDefault = new Machine(src);
  assert.match(byDefault.run().error!.message, /Maximum call depth of 200 exceeded/);
});

test("the depth counter recovers after a call returns", () => {
  const src = `
fn id(x) { return x }
let i = 0
while i < 500 {
  id(i)
  i = i + 1
}
`;
  const m = new Machine(src, { maxCallDepth: 5 });
  assert.equal(m.run().status, "halted");
});

// ---- errors ------------------------------------------------------------------

test("syntax errors are thrown by the constructor", () => {
  assert.throws(() => new Machine("let"), (e: unknown) => e instanceof CogError && e.kind === "syntax");
});

test("runtime error: undefined variable", () => {
  runtimeError("let a = 1\nprint(b)", /Undefined variable 'b'/, 2, 7);
  runtimeError("y = 1", /Undefined variable 'y'/, 1, 1);
});

test("runtime error: division by zero", () => {
  runtimeError("print(1 / 0)", /Division by zero/, 1, 9);
  runtimeError("print(1 % 0)", /Division by zero/);
});

test("runtime error: bad operand types", () => {
  runtimeError('print("a" - 1)', /Operator '-' cannot be applied to string and number/);
  runtimeError('print(-"a")', /Operator '-' expects a number, got string/);
  runtimeError('print("a" < 1)', /Operator '<' cannot be applied to string and number/);
  runtimeError("print(null + 1)", /Operator '\+' cannot be applied to null and number/);
});

test("runtime error: calling something that is not a function", () => {
  runtimeError("let x = 1\nx()", /Cannot call a value of type number/, 2, 1);
});

test("runtime error: wrong number of arguments", () => {
  runtimeError("fn f(a) { return a }\nf(1, 2)", /expects 1 argument\(s\), got 2/);
});

test("errors format with a source excerpt", () => {
  const src = "let a = 1\nprint(b)";
  const { result } = exec(src);
  const text = result.error!.format(src);
  assert.match(text, /^Runtime error at 2:7: Undefined variable 'b'/);
  assert.match(text, /2 \| print\(b\)/);
  assert.match(text, /\^$/);
});

test("a machine that errored stays errored", () => {
  const m = new Machine("print(nope)", { builtins: { print: () => null } });
  assert.equal(m.step().status, "error");
  assert.equal(m.step().status, "error");
  assert.ok(m.error instanceof CogError);
});

// ---- types -------------------------------------------------------------------

test("values round-trip through host functions", () => {
  const seen: Value[] = [];
  exec('capture(1, "s", true, null)', {
    builtins: {
      capture: (args) => {
        seen.push(...args);
      },
    },
  });
  assert.deepEqual(seen, [1, "s", true, null]);
});
