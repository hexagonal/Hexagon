/**
 * Runs the real TypeScript compiler over emitted text.
 *
 * Conformance for a `.d.ts` rule is only worth as much as the compiler's
 * opinion of the result: asserting on substrings pins the spelling, and a
 * spelling can be pinned exactly while the file as a whole stops being
 * TypeScript (#132, where one unbound binder invalidated a whole declaration
 * file whose every individual line read fine).
 *
 * This package carries no `@types/node` and its `lib` is `ES2024` — the
 * compiler core is platform-neutral and stays that way — so Node is reached
 * through non-literal specifiers, the escape hatch `seq-boundary-view.test.ts`
 * uses for the same reason. `tsc` is resolved from this package's own
 * `typescript` dependency rather than from `process.cwd()`, which differs
 * between a workspace run and a repository-root run.
 */
export async function typeScriptErrors(
  files: Readonly<Record<string, string>>,
  options: { readonly lib?: string } = {},
): Promise<readonly string[]> {
  const fsName = "node:fs";
  const osName = "node:os";
  const pathName = "node:path";
  const moduleName = "node:module";
  const childProcessName = "node:child_process";
  const fs = await import(/* @vite-ignore */ fsName) as {
    mkdirSync: (path: string, options: { recursive: boolean }) => void;
    mkdtempSync: (prefix: string) => string;
    writeFileSync: (path: string, data: string) => void;
    rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  };
  const os = await import(/* @vite-ignore */ osName) as { tmpdir: () => string };
  const path = await import(/* @vite-ignore */ pathName) as {
    join: (...parts: string[]) => string;
    dirname: (of: string) => string;
  };
  const { createRequire } = await import(/* @vite-ignore */ moduleName) as {
    createRequire: (from: string) => { resolve: (specifier: string) => string };
  };
  const { execFileSync } = await import(/* @vite-ignore */ childProcessName) as {
    execFileSync: (
      file: string,
      args: readonly string[],
      options: { cwd: string; encoding: "utf8"; stdio: readonly string[] },
    ) => string;
  };
  const { execPath } = (globalThis as unknown as { process: { execPath: string } }).process;

  // `import.meta.url` is real at runtime under `"module": "ESNext"`; the cast
  // is because no `@types/node` declares it on `ImportMeta` here.
  const here = (import.meta as unknown as { url: string }).url;
  const tsc = path.join(
    path.dirname(createRequire(here).resolve("typescript/package.json")),
    "bin",
    "tsc",
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hexagon-dts-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(directory, name);
      // A key may name a subdirectory: an emitted program's declaration files
      // sit at their own relative depths, and one side of a two-program layout
      // has to live under the other.
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    try {
      execFileSync(
        execPath,
        [
          tsc,
          "--noEmit",
          "--strict",
          "--lib",
          options.lib ?? "es2022",
          "--module",
          "nodenext",
          ...Object.keys(files),
        ],
        { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return [];
    } catch (failure) {
      const { stdout } = failure as { stdout?: string };
      return (stdout ?? "").split("\n").filter((line) => line.includes("error TS"));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
