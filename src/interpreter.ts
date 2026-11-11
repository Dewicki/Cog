import type { Binary, Block, Expr, Program, Stmt } from "./ast.ts";
import { CogError } from "./errors.ts";
import { parse } from "./parser.ts";

/**
 * Returned by a host function to say "not ready, try this call again on the
 * next step". The machine stays on the call and reports status "blocked".
 */
export const BLOCK: unique symbol = Symbol("cog.block");

/** A function defined in a Cog program. */
export interface CogFunction {
  readonly kind: "function";
  readonly name: string;
  readonly params: readonly string[];
  readonly body: Block;
  readonly closure: Env;
}

/** A function supplied by the host. May return BLOCK to wait. */
export type HostFunction = (args: Value[]) => Value | typeof BLOCK | void;

export type Value = number | boolean | string | null | CogFunction | HostFunction;

export type Status = "running" | "blocked" | "halted" | "error";

export interface StepResult {
  readonly status: Status;
  readonly error?: CogError;
}

export interface MachineOptions {
  /** Extra global values visible to the program (for example LEFT, RIGHT). */
  globals?: Record<string, Value>;
  /** Host functions visible to the program (for example send, recv). */
  builtins?: Record<string, HostFunction>;
  /** Maximum number of executed steps before a runtime error. Default 1,000,000. */
  maxSteps?: number;
  /** Maximum depth of nested Cog function calls. Default 200. */
  maxCallDepth?: number;
}

type Signal = "step" | "blocked";

type Completion =
  | undefined
  | { readonly type: "return"; readonly value: Value }
  | { readonly type: "break" }
  | { readonly type: "continue" };

const BREAK: Completion = { type: "break" };
const CONTINUE: Completion = { type: "continue" };

class Env {
  readonly vars = new Map<string, Value>();
  readonly parent: Env | null;

  constructor(parent: Env | null) {
    this.parent = parent;
  }

  /** The environment that declares `name`, or null. */
  find(name: string): Env | null {
    for (let env: Env | null = this; env !== null; env = env.parent) {
      if (env.vars.has(name)) return env;
    }
    return null;
  }
}
export type { Env };

// ---- value helpers ---------------------------------------------------------

export function typeName(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "function" || typeof v === "object") return "function";
  return typeof v === "boolean" ? "bool" : typeof v;
}

/** Text form of a value, as used by string concatenation and print. */
export function formatValue(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "function") return "<host function>";
  if (typeof v === "object") return `<fn ${v.name}>`;
  return String(v);
}

function isTruthy(v: Value): boolean {
  return !(v === false || v === null || v === 0 || v === "");
}

function runtimeError(message: string, node: { line: number; col: number }): CogError {
  return new CogError("runtime", message, node.line, node.col);
}

function applyBinary(node: Binary, l: Value, r: Value): Value {
  const op = node.op;
  switch (op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "+":
      if (typeof l === "number" && typeof r === "number") return l + r;
      if (typeof l === "string" || typeof r === "string") return formatValue(l) + formatValue(r);
      break;
    case "-":
    case "*":
    case "/":
    case "%":
      if (typeof l === "number" && typeof r === "number") {
        if ((op === "/" || op === "%") && r === 0) throw runtimeError("Division by zero", node);
        if (op === "-") return l - r;
        if (op === "*") return l * r;
        if (op === "/") return l / r;
        return l % r;
      }
      break;
    case "<":
    case "<=":
    case ">":
    case ">=":
      if ((typeof l === "number" && typeof r === "number") || (typeof l === "string" && typeof r === "string")) {
        if (op === "<") return l < r;
        if (op === "<=") return l <= r;
        if (op === ">") return l > r;
        return l >= r;
      }
      break;
  }
  throw runtimeError(`Operator '${op}' cannot be applied to ${typeName(l)} and ${typeName(r)}`, node);
}

// ---- machine ---------------------------------------------------------------

/**
 * One running Cog program. Advance it with step(); each step executes one
 * statement (or retries one blocked host call).
 *
 * What counts as one step: a let, assignment, expression statement, fn
 * declaration, return, break or continue; evaluating the condition of an if;
 * and evaluating the condition of a while on every iteration.
 */
export class Machine {
  private readonly program: Program;
  private readonly scope: Env;
  private readonly maxSteps: number;
  private readonly maxCallDepth: number;
  private readonly gen: Generator<Signal, void, void>;

  private _status: Status = "running";
  private _error: CogError | undefined;
  private _steps = 0;
  private _ticks = 0;
  private _line = 1;
  private _col = 1;
  private depth = 0;

  /** Throws CogError (kind "syntax") if the source does not parse. */
  constructor(source: string, options: MachineOptions = {}) {
    this.program = parse(source);
    this.maxSteps = options.maxSteps ?? 1_000_000;
    this.maxCallDepth = options.maxCallDepth ?? 200;

    const root = new Env(null);
    for (const [name, value] of Object.entries(options.globals ?? {})) root.vars.set(name, value);
    for (const [name, fn] of Object.entries(options.builtins ?? {})) root.vars.set(name, fn);
    this.scope = new Env(root);

    this.gen = this.main();
  }

  get status(): Status {
    return this._status;
  }

  get error(): CogError | undefined {
    return this._error;
  }

  /** Statements executed so far (blocked retries do not count). */
  get steps(): number {
    return this._steps;
  }

  /** Calls to step() so far, including blocked ones. */
  get ticks(): number {
    return this._ticks;
  }

  /** Line of the statement being executed or waiting (for highlighting). */
  get line(): number {
    return this._line;
  }

  /** Value of a top-level variable or global, if defined. */
  get(name: string): Value | undefined {
    return this.scope.find(name)?.vars.get(name);
  }

  /** Advance by one step. Calling it after halt or error changes nothing. */
  step(): StepResult {
    if (this._status === "halted" || this._status === "error") return this.result();
    this._ticks++;
    try {
      const r = this.gen.next();
      this._status = r.done ? "halted" : r.value === "blocked" ? "blocked" : "running";
    } catch (e) {
      this._status = "error";
      this._error =
        e instanceof CogError
          ? e
          : new CogError("runtime", e instanceof Error ? e.message : String(e), this._line, this._col);
    }
    return this.result();
  }

  /**
   * Step until the program halts, fails, or maxTicks steps have been made.
   * The returned status is "running" or "blocked" if the limit was hit.
   */
  run(maxTicks = 1_000_000): StepResult {
    let result = this.result();
    for (let i = 0; i < maxTicks; i++) {
      result = this.step();
      if (result.status === "halted" || result.status === "error") break;
    }
    return result;
  }

  private result(): StepResult {
    return this._error === undefined
      ? { status: this._status }
      : { status: this._status, error: this._error };
  }

  // ---- evaluation (generators: every yield is a pause point) ---------------

  private *main(): Generator<Signal, void, void> {
    yield* this.execStatements(this.program.body, this.scope);
  }

  private *stepPoint(): Generator<Signal, void, void> {
    this._steps++;
    if (this._steps > this.maxSteps) {
      throw new CogError(
        "runtime",
        `Step limit of ${this.maxSteps} exceeded (infinite loop?)`,
        this._line,
        this._col,
      );
    }
    yield "step";
  }

  private *execStatements(list: readonly Stmt[], env: Env): Generator<Signal, Completion, void> {
    for (const stmt of list) {
      const c = yield* this.execStmt(stmt, env);
      if (c !== undefined) return c;
    }
    return undefined;
  }

  private *execBlock(block: Block, env: Env): Generator<Signal, Completion, void> {
    return yield* this.execStatements(block.body, new Env(env));
  }

  private mark(node: { line: number; col: number }): void {
    this._line = node.line;
    this._col = node.col;
  }

  private *execStmt(stmt: Stmt, env: Env): Generator<Signal, Completion, void> {
    this.mark(stmt);
    switch (stmt.kind) {
      case "let": {
        const value = yield* this.evalExpr(stmt.init, env);
        env.vars.set(stmt.name, value);
        yield* this.stepPoint();
        return undefined;
      }
      case "assign": {
        const value = yield* this.evalExpr(stmt.value, env);
        const target = env.find(stmt.name);
        if (target === null) {
          throw runtimeError(`Undefined variable '${stmt.name}' (declare it with 'let')`, stmt);
        }
        target.vars.set(stmt.name, value);
        yield* this.stepPoint();
        return undefined;
      }
      case "expr": {
        yield* this.evalExpr(stmt.expr, env);
        yield* this.stepPoint();
        return undefined;
      }
      case "if": {
        const test = yield* this.evalExpr(stmt.test, env);
        yield* this.stepPoint();
        if (isTruthy(test)) return yield* this.execBlock(stmt.consequent, env);
        if (stmt.alternate === null) return undefined;
        if (stmt.alternate.kind === "if") return yield* this.execStmt(stmt.alternate, env);
        return yield* this.execBlock(stmt.alternate, env);
      }
      case "while": {
        for (;;) {
          this.mark(stmt);
          const test = yield* this.evalExpr(stmt.test, env);
          yield* this.stepPoint();
          if (!isTruthy(test)) return undefined;
          const c = yield* this.execBlock(stmt.body, env);
          if (c === undefined || c.type === "continue") continue;
          if (c.type === "break") return undefined;
          return c;
        }
      }
      case "fn": {
        env.vars.set(stmt.name, {
          kind: "function",
          name: stmt.name,
          params: stmt.params,
          body: stmt.body,
          closure: env,
        });
        yield* this.stepPoint();
        return undefined;
      }
      case "return": {
        const value = stmt.value === null ? null : yield* this.evalExpr(stmt.value, env);
        yield* this.stepPoint();
        return { type: "return", value };
      }
      case "break":
        yield* this.stepPoint();
        return BREAK;
      case "continue":
        yield* this.stepPoint();
        return CONTINUE;
    }
  }

  private *evalExpr(expr: Expr, env: Env): Generator<Signal, Value, void> {
    switch (expr.kind) {
      case "number":
      case "string":
      case "bool":
        return expr.value;
      case "null":
        return null;
      case "ident": {
        const owner = env.find(expr.name);
        if (owner === null) throw runtimeError(`Undefined variable '${expr.name}'`, expr);
        return owner.vars.get(expr.name)!;
      }
      case "unary": {
        const v = yield* this.evalExpr(expr.operand, env);
        if (expr.op === "not") return !isTruthy(v);
        if (typeof v !== "number") {
          throw runtimeError(`Operator '-' expects a number, got ${typeName(v)}`, expr);
        }
        return -v;
      }
      case "logical": {
        const left = yield* this.evalExpr(expr.left, env);
        if (expr.op === "and") return isTruthy(left) ? yield* this.evalExpr(expr.right, env) : left;
        return isTruthy(left) ? left : yield* this.evalExpr(expr.right, env);
      }
      case "binary": {
        const left = yield* this.evalExpr(expr.left, env);
        const right = yield* this.evalExpr(expr.right, env);
        return applyBinary(expr, left, right);
      }
      case "call":
        return yield* this.evalCall(expr, env);
    }
  }

  private *evalCall(
    expr: Extract<Expr, { kind: "call" }>,
    env: Env,
  ): Generator<Signal, Value, void> {
    const callee = yield* this.evalExpr(expr.callee, env);
    const args: Value[] = [];
    for (const arg of expr.args) args.push(yield* this.evalExpr(arg, env));

    if (typeof callee === "function") {
      for (;;) {
        let r: Value | typeof BLOCK | void;
        try {
          r = callee(args);
        } catch (e) {
          if (e instanceof CogError) throw e;
          throw runtimeError(e instanceof Error ? e.message : String(e), expr);
        }
        if (r !== BLOCK) return r === undefined ? null : r;
        yield "blocked";
      }
    }

    if (callee !== null && typeof callee === "object") {
      if (args.length !== callee.params.length) {
        throw runtimeError(
          `Function '${callee.name}' expects ${callee.params.length} argument(s), got ${args.length}`,
          expr,
        );
      }
      if (this.depth >= this.maxCallDepth) {
        throw runtimeError(`Maximum call depth of ${this.maxCallDepth} exceeded`, expr);
      }
      const fnEnv = new Env(callee.closure);
      callee.params.forEach((name, i) => fnEnv.vars.set(name, args[i]!));

      const savedLine = this._line;
      const savedCol = this._col;
      this.depth++;
      try {
        const c = yield* this.execStatements(callee.body.body, fnEnv);
        this._line = savedLine;
        this._col = savedCol;
        return c !== undefined && c.type === "return" ? c.value : null;
      } finally {
        this.depth--;
      }
    }

    throw runtimeError(`Cannot call a value of type ${typeName(callee)}`, expr);
  }
}
