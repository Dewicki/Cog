export type ErrorKind = "syntax" | "runtime";

/** An error in a Cog program, with the position it refers to (1-based). */
export class CogError extends Error {
  readonly kind: ErrorKind;
  readonly line: number;
  readonly col: number;

  constructor(kind: ErrorKind, message: string, line: number, col: number) {
    super(message);
    this.name = "CogError";
    this.kind = kind;
    this.line = line;
    this.col = col;
  }

  /** Human-readable message; pass the source to include the offending line. */
  format(source?: string): string {
    const label = this.kind === "syntax" ? "Syntax error" : "Runtime error";
    let out = `${label} at ${this.line}:${this.col}: ${this.message}`;
    if (source !== undefined) {
      const text = source.split(/\r?\n/)[this.line - 1];
      if (text !== undefined) {
        const gutter = String(this.line);
        const pad = " ".repeat(gutter.length);
        out += `\n  ${gutter} | ${text}\n  ${pad} | ${" ".repeat(Math.max(0, this.col - 1))}^`;
      }
    }
    return out;
  }
}
