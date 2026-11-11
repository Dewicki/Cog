# Cog

A tiny, embeddable programming language written in TypeScript. Programs run **step by step** and can **block** on host-provided functions, so a host (such as a game) can run many programs in lockstep. No I/O unless the host provides it.

> Status: work in progress. The lexer, parser and stepping interpreter work and are tested. See [docs/DESIGN.md](docs/DESIGN.md) for the design.

Companion project: **Cogworks**, a browser puzzle game where you program a network of small machines in Cog.

## Example

```
fn fib(n) {
  if n < 2 {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

print(fib(10))   // 55
```

## Try it

Requires Node.js 22.18 or newer. No dependencies are needed to run the code or the tests.

```
node src/cli.ts run examples/hello.cog
node src/cli.ts run examples/fib.cog
node --test "test/*.test.ts"
```

## Embedding

```ts
import { BLOCK, Machine } from "./src/index.ts";

const inbox: number[] = [];
const machine = new Machine("let x = recv()\nsend(x * 2)", {
  builtins: {
    recv: () => (inbox.length > 0 ? inbox.shift()! : BLOCK),
    send: (args) => console.log("out:", args[0]),
  },
});

machine.step();      // { status: "blocked" }: nothing to receive yet
inbox.push(21);
machine.step();      // { status: "running" }: let x = recv()
machine.step();      // prints "out: 42"
machine.step();      // { status: "halted" }
```

## Goals

- Small and readable: lexer, parser, AST, tree-walking interpreter, zero runtime dependencies.
- Steppable and blockable execution.
- Safe by default: step limits, host-defined built-in functions only.
- Helpful errors with line and column numbers.

## License

MIT
