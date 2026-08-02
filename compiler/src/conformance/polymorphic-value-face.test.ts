import { describe, expect, test } from "vitest";

import { compileProject, emitTypeScriptPreview, Source } from "../index";

/**
 * Conformance for FFI Part 7 §14.1: a declaration whose type is **not** a
 * function type has nowhere to put a quantifier, so a polymorphic one faces as
 * its `never` instantiation — quantified type variables at `never`, a
 * quantified row tail at the empty row.
 *
 * The defect this pins (#132) was not a naming blemish. Naming the source
 * binder produced `export declare const empty: Iterable<a>;`, and `a` is bound
 * by nothing: the *whole* declaration file stopped being TypeScript on account
 * of one row, and `stdlib/Seq.hex`'s `empty` shipped that way.
 *
 * So the assertions below do not stop at comparing strings. `describe("tsc
 * accepts …")` runs the real TypeScript compiler over the emitted text, which
 * is the property the issue is actually about, and carries a negative control
 * that feeds it the pre-fix spelling — a check that cannot fail proves nothing.
 */

/** Compiles one module and returns its generated `.d.ts` text. */
function declarations(source: string): string {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/main.hex", source),
  ]);
  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (main === undefined) throw new Error("no /main.hex in the compiled project");
  return main.declarations.text;
}

/** Compiles one module and returns the inspection-only preview text (§14.1 scope). */
function preview(source: string): string {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/main.hex", source),
  ]);
  // The preview describes a module whatever its diagnostics say, so without
  // this a specimen that stopped compiling would still produce text for the
  // assertions to match.
  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (main === undefined) throw new Error("no /main.hex in the compiled project");
  return emitTypeScriptPreview(main.core).text;
}

describe("a polymorphic non-function export faces as its `never` instantiation", () => {
  test("the quantified variable is instantiated, not named", () => {
    expect(declarations("export let empty: Seq(a) = Seq.empty\n")).toBe(
      "export declare const empty: Iterable<never>;\n",
    );
  });

  test("`stdlib/Seq.hex`'s `empty` — the live instance (#132)", () => {
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "export let e: Seq(Int) = Seq.empty\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const seq = project.modules.find(({ source }) => source.path.endsWith("Seq.hex"));
    if (seq === undefined) throw new Error("the prelude `Seq` module was not emitted");

    expect(seq.declarations.text).toContain("export declare const empty: Iterable<never>;");
    // The other polymorphic exports of the same module are function-typed and
    // keep §2.2's binders. Both rows in one assertion: the rule is about the
    // *shape of the declaration*, not about the module.
    expect(seq.declarations.text).toContain(
      "export declare const singleton: <a>(value: a) => Iterable<a>;",
    );
  });

  // `Seq` and `Option`, deliberately: both faces are decided and current. A
  // `Vector(Option(a))` specimen would read the same and pin `ReadonlyArray`,
  // which FFI Part 1 §4.1 decides against and #128 is filed to change — this
  // test has no business failing when that lands.
  test("an occurrence nested inside another face is instantiated too", () => {
    expect(declarations("export let table: Seq(Option(a)) = Seq.empty\n")).toContain(
      "export declare const table: Iterable<Option<never>>;",
    );
  });

  test("several quantified variables all instantiate", () => {
    expect(declarations("export let both: (Option(a), Option(b)) = (None, None)\n")).toContain(
      "export declare const both: [Option<never>, Option<never>];",
    );
  });

  test("a monomorphic value is untouched", () => {
    expect(declarations("export let version: String = \"1.0\"\n")).toBe(
      "export declare const version: string;\n",
    );
  });
});

describe("what the rule does not reach", () => {
  test("a function-typed polymorphic export still binds its quantifier (§2.2)", () => {
    expect(declarations("export let identity(x: a): a = x\n")).toBe(
      "export declare const identity: <a>(x: a) => a;\n",
    );
  });

  test("a generic nullary constructor keeps §12.1's face, which this generalizes", () => {
    expect(declarations("export union Box(a) = Full(value: a) | Empty\n")).toContain(
      "export declare const Empty: Box<never>;",
    );
  });
});

describe("a quantified row tail stands at the empty row, not `& never`", () => {
  // Only the preview meets this: an *exported* value must be annotated, and an
  // annotation cannot spell an open row. The preview describes un-annotated
  // private bindings too, and it is a surface a user reads (the Playground's
  // declarations pane), so it has to be TypeScript as well.
  test("the tail contributes no fields rather than collapsing the record", () => {
    const text = preview("let probe = ((r) => r.x, 1)\n");

    expect(text).toContain("declare const probe: [(arg0: { x: never }) => never, number];");
    expect(text).not.toContain("& never");
  });

  test("a named tail in a function-typed scheme is still bound and intersected", () => {
    expect(preview("let field = (r) => r.x\n")).toContain(
      "declare const field: <a, b>(r: ({ x: a } & b)) => a;",
    );
  });
});

/**
 * The declaration text run through the real compiler.
 *
 * This package carries no `@types/node` and its `lib` is `ES2024` — the
 * compiler core is platform-neutral and stays that way — so Node is reached
 * through non-literal specifiers, the escape hatch `seq-boundary-view.test.ts`
 * uses for the same reason. `tsc` is resolved from this package's own
 * `typescript` dependency rather than from `process.cwd()`, which differs
 * between a workspace run and a repository-root run.
 */
async function typeScriptErrors(
  files: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
  const fsName = "node:fs";
  const osName = "node:os";
  const pathName = "node:path";
  const moduleName = "node:module";
  const childProcessName = "node:child_process";
  const fs = await import(/* @vite-ignore */ fsName) as {
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
      fs.writeFileSync(path.join(directory, name), text);
    }
    try {
      execFileSync(
        execPath,
        [tsc, "--noEmit", "--strict", "--lib", "es2022", "--module", "nodenext", ...Object.keys(files)],
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

describe("tsc accepts the emitted declarations", () => {
  test("the face compiles, and a consumer uses it at a concrete instantiation", async () => {
    const emitted = declarations("export let empty: Seq(a) = Seq.empty\n");
    expect(emitted).toContain("Iterable<never>");

    expect(
      await typeScriptErrors({
        "empty.d.ts": emitted,
        "consumer.ts":
          'import { empty } from "./empty.js";\n' +
          "export const numbers: Iterable<number> = empty;\n" +
          "export const texts: Iterable<string> = empty;\n",
      }),
    ).toEqual([]);
  });

  test("the pre-fix spelling is rejected — TS2304, the control that makes the check real", async () => {
    const errors = await typeScriptErrors({
      "empty.d.ts": "export declare const empty: Iterable<a>;\n",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2304");
    expect(errors[0]).toContain("Cannot find name 'a'");
  });

  // §14.1 puts the preview in scope on the argument that a user reads it, so
  // the preview's own text has to survive the same compiler. Note what this
  // does *not* buy: `({ x: never } & never)` is valid TypeScript too, so the
  // empty-row half of the rule is pinned by the text assertion above and by
  // the mutation that produces it — never by `tsc`.
  test("the preview's forms compile too, generic and instantiated alike", async () => {
    const instantiated = preview("let probe = ((r) => r.x, 1)\n");
    const generic = preview("let field = (r) => r.x\n");
    expect(instantiated).toContain("{ x: never }");
    expect(generic).toContain("<a, b>");

    expect(await typeScriptErrors({ "instantiated.ts": instantiated })).toEqual([]);
    expect(await typeScriptErrors({ "generic.ts": generic })).toEqual([]);
  });

  test("`unknown` would not serve the consumer — why §14.1 instantiates at `never`", async () => {
    const errors = await typeScriptErrors({
      "unknown.ts":
        "export declare const empty: Iterable<unknown>;\n" +
        "export const numbers: Iterable<number> = empty;\n",
    });

    expect(errors[0]).toContain("error TS2322");
  });
});
