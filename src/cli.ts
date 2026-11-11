import { readFileSync } from "node:fs";
import { CogError, Machine, formatValue, parse } from "./index.ts";

const USAGE = `Usage:
  node src/cli.ts run <file.cog> [--max-steps N]   run a program
  node src/cli.ts ast <file.cog>                   print the syntax tree as JSON`;

function main(argv: string[]): number {
  const [command, file, ...rest] = argv;
  if ((command !== "run" && command !== "ast") || file === undefined) {
    console.error(USAGE);
    return 2;
  }

  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`Cannot read file: ${file}`);
    return 2;
  }

  try {
    if (command === "ast") {
      console.log(JSON.stringify(parse(source), null, 2));
      return 0;
    }

    const options: ConstructorParameters<typeof Machine>[1] = {
      builtins: {
        print: (args) => {
          console.log(args.map(formatValue).join(" "));
          return null;
        },
      },
    };
    const flag = rest.indexOf("--max-steps");
    if (flag !== -1) {
      const n = Number(rest[flag + 1]);
      if (!Number.isInteger(n) || n <= 0) {
        console.error("--max-steps needs a positive integer");
        return 2;
      }
      options.maxSteps = n;
    }

    const result = new Machine(source, options).run(Infinity);
    if (result.error !== undefined) {
      console.error(result.error.format(source));
      return 1;
    }
    return 0;
  } catch (e) {
    if (e instanceof CogError) {
      console.error(e.format(source));
      return 1;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
