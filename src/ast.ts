interface Base {
  readonly line: number;
  readonly col: number;
}

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface NumberLit extends Base { readonly kind: "number"; readonly value: number }
export interface StringLit extends Base { readonly kind: "string"; readonly value: string }
export interface BoolLit extends Base { readonly kind: "bool"; readonly value: boolean }
export interface NullLit extends Base { readonly kind: "null" }
export interface Ident extends Base { readonly kind: "ident"; readonly name: string }
export interface Unary extends Base { readonly kind: "unary"; readonly op: "-" | "not"; readonly operand: Expr }
export interface Binary extends Base { readonly kind: "binary"; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
export interface Logical extends Base { readonly kind: "logical"; readonly op: "and" | "or"; readonly left: Expr; readonly right: Expr }
export interface Call extends Base { readonly kind: "call"; readonly callee: Expr; readonly args: readonly Expr[] }

export type Expr = NumberLit | StringLit | BoolLit | NullLit | Ident | Unary | Binary | Logical | Call;

export interface Block extends Base { readonly kind: "block"; readonly body: readonly Stmt[] }

export interface Let extends Base { readonly kind: "let"; readonly name: string; readonly init: Expr }
export interface Assign extends Base { readonly kind: "assign"; readonly name: string; readonly value: Expr }
export interface If extends Base {
  readonly kind: "if";
  readonly test: Expr;
  readonly consequent: Block;
  readonly alternate: Block | If | null;
}
export interface While extends Base { readonly kind: "while"; readonly test: Expr; readonly body: Block }
export interface FnDecl extends Base {
  readonly kind: "fn";
  readonly name: string;
  readonly params: readonly string[];
  readonly body: Block;
}
export interface Return extends Base { readonly kind: "return"; readonly value: Expr | null }
export interface Break extends Base { readonly kind: "break" }
export interface Continue extends Base { readonly kind: "continue" }
export interface ExprStmt extends Base { readonly kind: "expr"; readonly expr: Expr }

export type Stmt = Let | Assign | If | While | FnDecl | Return | Break | Continue | ExprStmt;

export interface Program {
  readonly body: readonly Stmt[];
}
