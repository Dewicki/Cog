import type { BinaryOp, Block, Expr, If, Program, Stmt } from "./ast.ts";
import { CogError } from "./errors.ts";
import { tokenize } from "./lexer.ts";
import type { Token } from "./lexer.ts";

/** Parses source text into a Program. Throws CogError (kind "syntax"). */
export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}

function describe(tok: Token): string {
  switch (tok.type) {
    case "newline":
      return "end of line";
    case "eof":
      return "end of file";
    case "string":
      return `string "${tok.value}"`;
    default:
      return `'${tok.value}'`;
  }
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private loopDepth = 0;
  private fnDepth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseProgram(): Program {
    const body: Stmt[] = [];
    this.skipNewlines();
    while (this.peek().type !== "eof") {
      body.push(this.parseStatement());
      this.endStatement();
      this.skipNewlines();
    }
    return { body };
  }

  // ---- token helpers -------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private advance(): Token {
    const tok = this.peek();
    if (tok.type !== "eof") this.pos++;
    return tok;
  }

  private isOp(value: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok.type === "op" && tok.value === value;
  }

  private isKeyword(value: string): boolean {
    const tok = this.peek();
    return tok.type === "keyword" && tok.value === value;
  }

  private matchOp(value: string): boolean {
    if (!this.isOp(value)) return false;
    this.pos++;
    return true;
  }

  private expectOp(value: string, context: string): Token {
    if (!this.isOp(value)) {
      throw this.error(this.peek(), `Expected '${value}' ${context}, found ${describe(this.peek())}`);
    }
    return this.advance();
  }

  private expectName(context: string): Token {
    const tok = this.peek();
    if (tok.type !== "ident") {
      throw this.error(tok, `Expected a name ${context}, found ${describe(tok)}`);
    }
    return this.advance();
  }

  private error(tok: Token, message: string): CogError {
    return new CogError("syntax", message, tok.line, tok.col);
  }

  private skipNewlines(): void {
    while (this.peek().type === "newline") this.pos++;
  }

  private endStatement(): void {
    const tok = this.peek();
    if (tok.type === "newline") {
      this.pos++;
      return;
    }
    if (tok.type === "eof" || (tok.type === "op" && tok.value === "}")) return;
    throw this.error(tok, `Unexpected ${describe(tok)}; expected end of line`);
  }

  // ---- statements ----------------------------------------------------------

  private parseBlock(context: string): Block {
    const open = this.expectOp("{", context);
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.isOp("}")) {
      if (this.peek().type === "eof") {
        throw this.error(open, "Unclosed '{': expected a matching '}'");
      }
      body.push(this.parseStatement());
      this.endStatement();
      this.skipNewlines();
    }
    this.advance();
    return { kind: "block", body, line: open.line, col: open.col };
  }

  private parseStatement(): Stmt {
    const tok = this.peek();

    if (tok.type === "keyword") {
      switch (tok.value) {
        case "let":
          return this.parseLet();
        case "if":
          return this.parseIf();
        case "while":
          return this.parseWhile();
        case "fn":
          return this.parseFn();
        case "return":
          return this.parseReturn();
        case "break":
        case "continue": {
          this.advance();
          if (this.loopDepth === 0) {
            throw this.error(tok, `'${tok.value}' outside of a loop`);
          }
          return { kind: tok.value as "break" | "continue", line: tok.line, col: tok.col };
        }
        case "else":
          throw this.error(tok, "'else' without a matching 'if'");
      }
    }

    if (tok.type === "ident" && this.isOp("=", 1)) {
      this.advance();
      this.advance();
      const value = this.parseExpression();
      return { kind: "assign", name: tok.value, value, line: tok.line, col: tok.col };
    }

    const expr = this.parseExpression();
    return { kind: "expr", expr, line: tok.line, col: tok.col };
  }

  private parseLet(): Stmt {
    const kw = this.advance();
    const name = this.expectName("after 'let'");
    this.expectOp("=", `after variable name '${name.value}'`);
    const init = this.parseExpression();
    return { kind: "let", name: name.value, init, line: kw.line, col: kw.col };
  }

  private parseIf(): If {
    const kw = this.advance();
    const test = this.parseExpression();
    const consequent = this.parseBlock("after the if condition");
    let alternate: Block | If | null = null;

    const save = this.pos;
    this.skipNewlines();
    if (this.isKeyword("else")) {
      this.advance();
      alternate = this.isKeyword("if") ? this.parseIf() : this.parseBlock("after 'else'");
    } else {
      this.pos = save;
    }
    return { kind: "if", test, consequent, alternate, line: kw.line, col: kw.col };
  }

  private parseWhile(): Stmt {
    const kw = this.advance();
    const test = this.parseExpression();
    this.loopDepth++;
    const body = this.parseBlock("after the while condition");
    this.loopDepth--;
    return { kind: "while", test, body, line: kw.line, col: kw.col };
  }

  private parseFn(): Stmt {
    const kw = this.advance();
    const name = this.expectName("after 'fn'");
    this.expectOp("(", `after function name '${name.value}'`);
    const params: string[] = [];
    if (!this.isOp(")")) {
      do {
        const p = this.expectName("in the parameter list");
        if (params.includes(p.value)) {
          throw this.error(p, `Duplicate parameter '${p.value}'`);
        }
        params.push(p.value);
      } while (this.matchOp(","));
    }
    this.expectOp(")", "after the parameters");

    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    this.fnDepth++;
    const body = this.parseBlock("before the function body");
    this.fnDepth--;
    this.loopDepth = savedLoop;
    return { kind: "fn", name: name.value, params, body, line: kw.line, col: kw.col };
  }

  private parseReturn(): Stmt {
    const kw = this.advance();
    if (this.fnDepth === 0) {
      throw this.error(kw, "'return' outside of a function");
    }
    const next = this.peek();
    const bare = next.type === "newline" || next.type === "eof" || this.isOp("}");
    const value = bare ? null : this.parseExpression();
    return { kind: "return", value, line: kw.line, col: kw.col };
  }

  // ---- expressions ---------------------------------------------------------

  private parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      const op = this.advance();
      this.skipNewlines();
      const right = this.parseAnd();
      left = { kind: "logical", op: "or", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword("and")) {
      const op = this.advance();
      this.skipNewlines();
      const right = this.parseNot();
      left = { kind: "logical", op: "and", left, right, line: op.line, col: op.col };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isKeyword("not")) {
      const op = this.advance();
      const operand = this.parseNot();
      return { kind: "unary", op: "not", operand, line: op.line, col: op.col };
    }
    return this.parseEquality();
  }

  private binaryLevel(ops: readonly string[], next: () => Expr): Expr {
    let left = next();
    for (;;) {
      const tok = this.peek();
      if (tok.type !== "op" || !ops.includes(tok.value)) return left;
      this.advance();
      this.skipNewlines();
      const right = next();
      left = { kind: "binary", op: tok.value as BinaryOp, left, right, line: tok.line, col: tok.col };
    }
  }

  private parseEquality(): Expr {
    return this.binaryLevel(["==", "!="], () => this.parseComparison());
  }

  private parseComparison(): Expr {
    return this.binaryLevel(["<", "<=", ">", ">="], () => this.parseTerm());
  }

  private parseTerm(): Expr {
    return this.binaryLevel(["+", "-"], () => this.parseFactor());
  }

  private parseFactor(): Expr {
    return this.binaryLevel(["*", "/", "%"], () => this.parseUnary());
  }

  private parseUnary(): Expr {
    if (this.isOp("-")) {
      const op = this.advance();
      const operand = this.parseUnary();
      return { kind: "unary", op: "-", operand, line: op.line, col: op.col };
    }
    return this.parseCall();
  }

  private parseCall(): Expr {
    let expr = this.parsePrimary();
    while (this.isOp("(")) {
      this.advance();
      const args: Expr[] = [];
      if (!this.isOp(")")) {
        do {
          args.push(this.parseExpression());
        } while (this.matchOp(","));
      }
      this.expectOp(")", "after call arguments");
      expr = { kind: "call", callee: expr, args, line: expr.line, col: expr.col };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    switch (tok.type) {
      case "number":
        this.advance();
        return { kind: "number", value: Number(tok.value), line: tok.line, col: tok.col };
      case "string":
        this.advance();
        return { kind: "string", value: tok.value, line: tok.line, col: tok.col };
      case "ident":
        this.advance();
        return { kind: "ident", name: tok.value, line: tok.line, col: tok.col };
      case "keyword":
        if (tok.value === "true" || tok.value === "false") {
          this.advance();
          return { kind: "bool", value: tok.value === "true", line: tok.line, col: tok.col };
        }
        if (tok.value === "null") {
          this.advance();
          return { kind: "null", line: tok.line, col: tok.col };
        }
        break;
      case "op":
        if (tok.value === "(") {
          this.advance();
          const inner = this.parseExpression();
          this.expectOp(")", "to close the parenthesis");
          return inner;
        }
        break;
    }
    throw this.error(tok, `Expected an expression, found ${describe(tok)}`);
  }
}
