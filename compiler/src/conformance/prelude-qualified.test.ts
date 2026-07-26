import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/** Minimal ESM linker: rewrite compiler-owned relative imports to data-URL modules. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/** Compiles a project and executes it, returning `/main.hex`'s exports. */
async function run(files: readonly (readonly [string, string])[]): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls);
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  // By path, never `modules[0]`: the prelude members share the project.
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

/**
 * Conformance for the qualified reachability of prelude names (Modules §6.4;
 * `spec/notes/compiler-conformance-defects.md` defect 10).
 *
 * §6.4 exists to underwrite §5.4: "The occlusion rule's *prelude version stays
 * reachable qualified* only works if every prelude name has a qualified home — a
 * companion module it also lives in." §5.4 leans on exactly that, promising that
 * after a module occludes `show`, "the prelude's version remains reachable
 * qualified."
 *
 * The prelude was seeded as *bare* names only. Terms went into a fallback scope
 * and type identities were registered, but the member module itself could not be
 * named, so no qualified path to it existed at all — `Option.Some` reported
 * `unknown name \`Option\``.
 *
 * Nothing depended on it while a module-level binder could not occlude a prelude
 * value (defect 9): no program could shadow `Some`, so the escape hatch had
 * nothing to protect. Fixing defect 9 made occlusion real, which makes this the
 * half that has to work.
 *
 * A prelude member is addressable as a **fallback** layer: an explicit
 * `import * as` of the same name is a module-level binding and wins (§5.4).
 */

function diagnostics(source: string): readonly string[] {
  return compileProject([new Source.File(Source.fileId(0), "/main.hex", source)])
    .diagnostics.map((diagnostic) => diagnostic.message);
}

function withModule(path: string, text: string, entry: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(1), path, text),
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("a prelude member is reachable by name", () => {
  test("its terms are, with no import line", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Option.Some(1)\n" +
      "export let b: Option(Int) = Option.None\n" +
      "export let c: Result(Int, String) = Result.Ok(1)\n" +
      "export let d: Ordering = Prelude.Less\n",
    )).toEqual([]);
  });

  test("its types are", () => {
    expect(diagnostics(
      "export let a: Option.Option(Int) = Some(1)\n" +
      "export let b: Result.Result(Int, String) = Ok(1)\n",
    )).toEqual([]);
  });

  test("the bare spellings are untouched", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: Result(Int, String) = Ok(1)\n" +
      "export let c: Ordering = Less\n",
    )).toEqual([]);
  });

  test("a member that does not export the name still says so", () => {
    // The qualifier resolves; the *member* is what rejects the field. Before the
    // fix this reported `unknown name \`Option\`` — a different, misleading error.
    expect(diagnostics("export let a: Int = Option.notThere(1)\n")).toEqual([
      "module `Option` does not export `notThere`",
    ]);
  });
});

describe("qualified access is what makes occlusion survivable (§5.4 + §6.4)", () => {
  test("an occluding module still reaches the prelude version qualified", () => {
    // The whole point of §6.4. `Some` is occluded module-wide by a local
    // binding; `Option.Some` must still be the prelude's constructor.
    expect(withModule(
      "/Result.hex",
      "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
      "export let tally: Int = 7\n",
      "export let tally: String = \"mine\"\n" +
      "export let local: String = tally\n" +
      "export let prelude: Int = Result.tally\n",
    )).toEqual([]);
  });
});

describe("an explicit alias is a module-level binding and wins", () => {
  test("`import * as Option` of a different module shadows the prelude member", () => {
    // §5.4: explicit imports enter the same layer as local bindings. The prelude
    // member is only a fallback, so this must resolve to the imported module —
    // and must not collide, which is what a same-layer registration would cause.
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import * as Option from \"./mine\"\n" +
      "export let a: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });

  test("the shadowed prelude type is still nameable unqualified", () => {
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import * as Option from \"./mine\"\n" +
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });
});

describe("the qualified spelling runs (PR #90 finding F1)", () => {
  // Resolving the name is half the job. A prelude member has no namespace object
  // to dot into — unlike an explicit `import * as`, nothing declares one — so the
  // first fix emitted a bare `Option.Some(1)` with no import at all: a clean
  // compile and a `ReferenceError` on load. These assertions are on *values*
  // produced by executing the emitted module, which is the only level at which
  // that failure is visible.

  test("a qualified constructor produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "export let wrapped: Option(Int) = Option.Some(41)\n" +
      "export let unwrapped: Int = match wrapped\n" +
      "    None => 0\n" +
      "    Some(value) => value + 1\n",
    ]]);
    expect(module["unwrapped"]).toBe(42);
  });

  test("a qualified nullary constructor produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "export let nothing: Option(Int) = Option.None\n" +
      "export let isNothing: Bool = nothing == None\n",
    ]]);
    expect(module["isNothing"]).toBe(true);
  });

  test("a qualified value from a second member produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "export let ordered: Ordering = Prelude.Less\n" +
      "export let isLess: Bool = ordered == Less\n",
    ]]);
    expect(module["isLess"]).toBe(true);
  });

  test("the occluding module gets BOTH values, distinct", async () => {
    // The case that forbids the lazy fix. Importing the prelude's `tally` under
    // its own name would collide with the module-level binding that occludes it —
    // the very binding the qualified spelling exists to see past. Both values
    // have to survive to runtime, and be different.
    const module = await run([
      ["/Result.hex",
        "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
        "export let tally: Int = 7\n"],
      ["/main.hex",
        "export let tally: Int = 1\n" +
        "export let mine: Int = tally\n" +
        "export let theirs: Int = Result.tally\n"],
    ]);
    expect(module["mine"]).toBe(1);
    expect(module["theirs"]).toBe(7);
  });

  test("a qualified reference and a bare one share one import", async () => {
    // No occlusion here, so both spellings denote the same symbol and must not
    // produce two conflicting local bindings.
    const module = await run([[
      "/main.hex",
      "export let viaBare: Option(Int) = Some(1)\n" +
      "export let viaQualified: Option(Int) = Option.Some(2)\n" +
      "export let same: Bool = viaBare != viaQualified\n",
    ]]);
    expect(module["same"]).toBe(true);
  });
});
