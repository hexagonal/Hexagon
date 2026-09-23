import packageMetadata from "../package.json" with { type: "json" };

export const VERSION = packageMetadata.version;

export const HELP = `Usage:
  hexc check <root.hex> [more-roots.hex ...]
  hexc build <root.hex> [more-roots.hex ...] [--out-dir <directory>]
  hexc --help
  hexc --version

Commands:
  check  Check selected roots and their transitive imports without writing output
  build  Compile selected roots and write the complete emitted graph

Options:
  --out-dir <directory>  Build output directory (default: <project>/dist)
  --help                 Show this help
  --version              Show the compiler version
  --                     Treat all following arguments as root paths
`;

export type Invocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "check" | "build";
      readonly roots: readonly string[];
      readonly outputDirectory?: string;
    };

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export function parseArguments(arguments_: readonly string[]): Invocation {
  if (arguments_.length === 1 && arguments_[0] === "--help") return { kind: "help" };
  if (arguments_.length === 1 && arguments_[0] === "--version") return { kind: "version" };

  const [command, ...rest] = arguments_;
  if (command !== "check" && command !== "build") {
    if (command === undefined) throw new UsageError("a command is required");
    throw new UsageError(`unknown command or option: ${command}`);
  }

  const roots: string[] = [];
  let outputDirectory: string | undefined;
  let options = true;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument === "--help") return { kind: "help" };
    if (options && argument === "--version") return { kind: "version" };
    if (options && argument === "--out-dir") {
      if (command !== "build") throw new UsageError("--out-dir is only valid with build");
      if (outputDirectory !== undefined) throw new UsageError("--out-dir may be specified only once");
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError("--out-dir requires a directory");
      }
      outputDirectory = value;
      index += 1;
      continue;
    }
    if (options && argument.startsWith("-")) throw new UsageError(`unknown option: ${argument}`);
    roots.push(argument);
  }
  if (roots.length === 0) throw new UsageError(`${command} requires at least one .hex root`);
  return outputDirectory === undefined
    ? { kind: command, roots }
    : { kind: command, roots, outputDirectory };
}
