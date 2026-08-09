import { describe, expect, test } from "vitest";

import {
  compileProject,
  emitTypeScriptPreview,
  Source,
  type CompiledProject,
} from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 1 §8.3 (issue #128): the runtime collections face
 * TypeScript as the branded `Hex.*` interfaces §4.1 decided, declared in a
 * runtime declaration module the compiler emits into the program's own output.
 *
 * What was wrong before this landed was worse than a naming mismatch. The
 * emitter wrote `ReadonlyArray`/`ReadonlyMap`/`ReadonlySet` and a bare
 * `Iterable<number>`, which lose two decided properties: the brand (an
 * arbitrary iterable satisfied the face) and honesty (`ReadonlyMap` promises
 * `get`/`has`/`keys`, and the runtime HAMT implements none of them — so
 * `map.get(k)` typechecked and failed at run time). Both losses are pinned
 * below by tests that fail if the old faces come back.
 *
 * The four faces are §8.3's; `Seq(a)` deliberately keeps the structural
 * `Iterable<a>` (§8.2's carve-out) and is pinned here too, because the whole
 * point of the carve-out is that a sweep does not take it with the rest.
 */

function project(files: Readonly<Record<string, string>>): CompiledProject {
  const compiled = compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
  expect(compiled.diagnostics).toEqual([]);
  return compiled;
}

/** One module's generated `.d.ts` text. */
function declarationsOf(compiled: CompiledProject, path: string): string {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`no ${path} in the compiled project`);
  return module.declarations.text;
}

/** The generated `.d.ts` of a one-module program at `/src/main.hex`. */
function declarations(source: string): string {
  return declarationsOf(project({ "/src/main.hex": source }), "/src/main.hex");
}

/** The inspection-only preview text of a one-module program (§14.1 scope). */
function preview(source: string): string {
  const compiled = project({ "/src/main.hex": source });
  const module = compiled.modules.find(({ source: file }) => file.path === "/src/main.hex");
  if (module === undefined) throw new Error("no /src/main.hex in the compiled project");
  return emitTypeScriptPreview(module.core).text;
}

/** A program exercising all four faces, in every position §8.3 obligation 5 names. */
const ALL_FOUR_FACES =
  "let emptyMap: Map(String, Int) = Map.empty\n" +
  "let emptySet: Set(Int) = Set.empty\n" +
  "export let rows: Vector(Int) = [1, 2, 3]\n" +
  "export let span: Range = 0..3\n" +
  "export let counts: Map(String, Int) = Map.set(emptyMap, \"a\", 1)\n" +
  "export let seen: Set(Int) = Set.add(emptySet, 1)\n" +
  "export fun widen(source: Vector(Int), extra: Int): Vector(Int) =\n" +
  "    Vector.append(source, extra)\n" +
  "export fun mark(known: Set(Int), tally: Map(String, Int), over: Range): Int = 0\n";

describe("the four faces are the branded `Hex.*` interfaces (obligation 1)", () => {
  test("`Vector(a)` faces as `Hex.Vector<a>`, not `ReadonlyArray<a>`", () => {
    const text = declarations("export let rows: Vector(Int) = [1, 2]\n");
    expect(text).toContain("export declare const rows: Hex.Vector<number>;");
    expect(text).not.toContain("ReadonlyArray");
  });

  test("`Map(k, v)` and `Set(a)` face as `Hex.Map<k, v>` / `Hex.Set<a>`", () => {
    const text = declarations(
      "let emptyMap: Map(String, Int) = Map.empty\n" +
        "let emptySet: Set(Int) = Set.empty\n" +
        "export let counts: Map(String, Int) = Map.set(emptyMap, \"a\", 1)\n" +
        "export let seen: Set(Int) = Set.add(emptySet, 1)\n",
    );
    expect(text).toContain("export declare const counts: Hex.Map<string, number>;");
    expect(text).toContain("export declare const seen: Hex.Set<number>;");
    expect(text).not.toContain("ReadonlyMap");
    expect(text).not.toContain("ReadonlySet");
  });

  test("`Range` faces as `Hex.Range`, not a bare `Iterable<number>`", () => {
    const text = declarations("export let span: Range = 0..3\n");
    expect(text).toContain("export declare const span: Hex.Range;");
    expect(text).not.toContain("Iterable<number>");
  });

  test("a face nested in another type is rendered the same way", () => {
    expect(declarations("export let grid: Vector(Vector(Int)) = [[1], [2]]\n")).toContain(
      "export declare const grid: Hex.Vector<Hex.Vector<number>>;",
    );
  });

  test("parameter and result positions both take the face", () => {
    expect(
      declarations(
        "export fun widen(source: Vector(Int), extra: Int): Vector(Int) =\n" +
          "    Vector.append(source, extra)\n",
      ),
    ).toContain(
      "export declare function widen(source: Hex.Vector<number>, extra: number): Hex.Vector<number>;",
    );
  });

  test("a generic function's binders survive beside the faces", () => {
    expect(
      declarations("export fun pair<a>(left: Vector(a), right: Set(a)): Map(Int, a) =\n" +
        "    Map.empty\n"),
    ).toContain(
      "export declare function pair<a>(left: Hex.Vector<a>, right: Hex.Set<a>): Hex.Map<number, a>;",
    );
  });

  test("`Seq(a)` is not swept up: its face stays the structural `Iterable<a>` (§8.2)", () => {
    const text = declarations("export let items: Seq(Int) = Seq.singleton(1)\n");
    expect(text).toContain("export declare const items: Iterable<number>;");
    expect(text).not.toContain("Hex.");
    // And with nothing to import, nothing is imported — the same file proves
    // both halves, which is why the assertion lives here rather than below.
    expect(text).not.toContain("import type");
  });
});

describe("one type-only import of the runtime declaration module (obligation 2)", () => {
  test("exactly one import, however many faces the file mentions", () => {
    const text = declarationsOf(project({ "/src/main.hex": ALL_FOUR_FACES }), "/src/main.hex");
    expect(text.split("\n").filter((line) => line.includes("hex.js"))).toEqual([
      'import type * as Hex from "./hex.js";',
    ]);
  });

  test("a file mentioning no face carries no import", () => {
    expect(declarations("export let version: String = \"1.0\"\n")).toBe(
      "export declare const version: string;\n",
    );
  });

  // A private union's shape still reaches the `.d.ts` (it may be named by an
  // exported signature), so a module can render a face while exporting
  // nothing. The import alone makes the file a module, so no `export {};`
  // follows it — the marker exists for a file that has neither.
  test("a file whose only face is in a private declaration needs no `export {};`", () => {
    expect(declarations("union Holder = Held(rows: Vector(Int))\n")).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'type Holder = { tag: "Held"; rows: Hex.Vector<number> };\n',
    );
  });

  test("the import leads the file, ahead of the module's own imports", () => {
    const compiled = project({
      "/src/main.hex": "import * as Other from \"./other\"\n" +
        "export let rows: Vector(Int) = Other.rows\n",
      "/src/other.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(declarationsOf(compiled, "/src/main.hex")).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'import type * as Other from "./other.js";\n' +
        "export declare const rows: Hex.Vector<number>;\n",
    );
  });

  // §8.3 obligation 2 names this collision class explicitly, and records that
  // it is live before the ruling rather than created by it: the emitter has
  // always written `import type * as <alias>` for a source-level namespace
  // import, so the §10 probe has to see those aliases and not only the
  // module's declared names.
  test("a source namespace import aliased `Hex` pushes the generated alias to `Hex1`", () => {
    const compiled = project({
      "/src/main.hex": "import * as Hex from \"./other\"\n" +
        "export let rows: Vector(Int) = Hex.rows\n",
      "/src/other.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(declarationsOf(compiled, "/src/main.hex")).toBe(
      'import type * as Hex1 from "./hex.js";\n' +
        'import type * as Hex from "./other.js";\n' +
        "export declare const rows: Hex1.Vector<number>;\n",
    );
  });

  test("a user type named `Hex` pushes it too, and keeps its own spelling", () => {
    const text = declarations(
      "export record Hex = { digits: String }\n" +
        "export let rows: Vector(Int) = [1]\n",
    );
    expect(text).toContain('import type * as Hex1 from "./hex.js";');
    expect(text).toContain("export type Hex = { digits: string };");
    expect(text).toContain("export declare const rows: Hex1.Vector<number>;");
  });

  test("the probe keeps counting: `Hex` and `Hex1` both taken gives `Hex2`", () => {
    const text = declarations(
      "export record Hex = { digits: String }\n" +
        "export record Hex1 = { digits: String }\n" +
        "export let rows: Vector(Int) = [1]\n",
    );
    expect(text).toContain('import type * as Hex2 from "./hex.js";');
    expect(text).toContain("export declare const rows: Hex2.Vector<number>;");
  });
});

describe("the program-scoped runtime declaration module (obligation 3)", () => {
  test("its content is exactly §8.3's four interfaces", () => {
    expect(project({ "/src/main.hex": ALL_FOUR_FACES }).runtimeDeclarations).toEqual({
      kind: "RuntimeDeclarations",
      path: "/src/hex.d.ts",
      text: 'export interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }\n' +
        'export interface Set<a> extends Iterable<a> { readonly "~hex": "Set"; }\n' +
        'export interface Map<k, v> extends Iterable<[k, v]> { readonly "~hex": "Map"; }\n' +
        'export interface Range extends Iterable<number> { readonly "~hex": "Range"; }\n',
    });
  });

  test("it is absent when no generated `.d.ts` imports it", () => {
    expect(project({ "/src/main.hex": "export let n: Int = 1\n" }).runtimeDeclarations)
      .toBeUndefined();
  });

  test("it sits at the source common root, and importers path-adjust to it", () => {
    const compiled = project({
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
      "/src/deep/inner.hex": "export let more: Vector(String) = [\"a\"]\n",
      "/src/deep/deeper/most.hex": "export let most: Vector(Bool) = [True]\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/src/hex.d.ts");
    expect(declarationsOf(compiled, "/src/main.hex"))
      .toContain('from "./hex.js";');
    expect(declarationsOf(compiled, "/src/deep/inner.hex"))
      .toContain('from "../hex.js";');
    expect(declarationsOf(compiled, "/src/deep/deeper/most.hex"))
      .toContain('from "../../hex.js";');
  });

  // §8.3 records this as a price rather than a property: the common root is the
  // longest shared prefix over *all* sources, so a distant file shortens it and
  // the artefact moves. The prelude modules already inject at that same root
  // and already move the same way, which is why the ruling accepts it — but
  // "accepted" is only checkable if the behaviour is pinned.
  test("adding a distant source moves the root, the artefact, and every specifier", () => {
    const compiled = project({
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
      "/tools/aside.hex": "export let n: Int = 1\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/hex.d.ts");
    expect(declarationsOf(compiled, "/src/main.hex")).toContain('from "../hex.js";');
  });

  test("a user module claiming the name at the root wins; the generated file moves", () => {
    const compiled = project({
      "/src/hex.hex": "export let n: Int = 1\n",
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/src/hex1.d.ts");
    expect(declarationsOf(compiled, "/src/main.hex")).toContain('from "./hex1.js";');
    // Only the generated file moves. The user module keeps its own emission.
    expect(declarationsOf(compiled, "/src/hex.hex")).toBe("export declare const n: number;\n");
  });

  test("the filename probe is case-insensitive — case-colliding filesystems exist", () => {
    const compiled = project({
      "/src/Hex.hex": "export let n: Int = 1\n",
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/src/hex1.d.ts");
  });

  test("a same-named module in another directory does not collide", () => {
    const compiled = project({
      "/src/deep/hex.hex": "export let n: Int = 1\n",
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/src/hex.d.ts");
  });
});

describe("what the ruling leaves alone (obligation 4)", () => {
  // The brand is what this ruling decided, and `Array(a)` is outside it: a
  // borrowed foreign JS array is an ordinary array, so its face stays
  // structural. #228 later corrected the same row's *mutability* — the face is
  // §4.1's `ReadonlyArray<a>` — which leaves the branding question untouched.
  test("`Array(a)` stays structural: no brand, whatever its mutability", () => {
    const text = declarations(
      "extern from \"./host.js\"\n" +
        "    export fun rows(): Array(Int)\n",
    );
    expect(text).toContain("export declare function rows(): ReadonlyArray<number>;");
    expect(text).not.toContain("Hex.");
  });

  test("no emitted JavaScript changes: the marker is a TypeScript-only phantom", () => {
    const compiled = project({ "/src/main.hex": ALL_FOUR_FACES });
    for (const module of compiled.modules) {
      expect(module.javascript.text).not.toContain("~hex");
      expect(module.javascript.text).not.toContain("hex.js");
    }
  });
});

describe("the preview declares the namespace inline (obligation 6)", () => {
  test("the header appears, with the same four interface bodies", () => {
    const text = preview("export let rows: Vector(Int) = [1]\n");
    expect(text).toContain("declare namespace Hex {");
    expect(text).toContain('interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }');
    expect(text).toContain("declare const rows: Hex.Vector<number>;");
    // The pane has no file to import from, so it must not pretend otherwise.
    expect(text).not.toContain("hex.js");
  });

  test("a preview mentioning no face carries no header", () => {
    expect(preview("export let version: String = \"1.0\"\n")).not.toContain("namespace");
  });

  test("the preview's alias is probed the same way", () => {
    expect(preview(
      "export record Hex = { digits: String }\n" +
        "export let rows: Vector(Int) = [1]\n",
    )).toContain("declare namespace Hex1 {");
  });
});

describe("tsc accepts the emitted program (obligation 5)", () => {
  /** The text of a program's runtime declaration module, which must be present. */
  function runtimeText(source: string): string {
    const runtime = project({ "/src/main.hex": source }).runtimeDeclarations;
    if (runtime === undefined) throw new Error("the program emitted no runtime declarations");
    return runtime.text;
  }

  /** The emitted program as a `tsc` input set, plus whatever the test adds. */
  function emittedFiles(
    source: string,
    extra: Readonly<Record<string, string>> = {},
  ): Readonly<Record<string, string>> {
    const compiled = project({ "/src/main.hex": source });
    const runtime = compiled.runtimeDeclarations;
    if (runtime === undefined) throw new Error("the program emitted no runtime declarations");
    return { "hex.d.ts": runtime.text, "main.d.ts": declarationsOf(compiled, "/src/main.hex"), ...extra };
  }

  test("all four faces compile, in result, parameter, and `declare const` positions", async () => {
    expect(await typeScriptErrors(emittedFiles(ALL_FOUR_FACES))).toEqual([]);
  });

  // The specifiers the path adjustment produces, through the real compiler
  // rather than through a substring match. `tsc` resolving `"../hex.js"` from
  // a nested declaration file is the whole content of that rule, and a program
  // whose every module sits at the root — which is what every other run here
  // uses — exercises none of it.
  test("a multi-directory program resolves its path-adjusted specifiers", async () => {
    const compiled = project({
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
      "/src/deep/inner.hex": "export let more: Map(String, Int) = Map.empty\n",
      "/src/deep/deeper/most.hex": "export let most: Set(Int) = Set.empty\n",
    });
    expect(
      await typeScriptErrors({
        "hex.d.ts": compiled.runtimeDeclarations?.text ?? "",
        "main.d.ts": declarationsOf(compiled, "/src/main.hex"),
        "deep/inner.d.ts": declarationsOf(compiled, "/src/deep/inner.hex"),
        "deep/deeper/most.d.ts": declarationsOf(compiled, "/src/deep/deeper/most.hex"),
      }),
    ).toEqual([]);
  });

  test("a program whose runtime module was renamed resolves the probed name", async () => {
    const compiled = project({
      "/src/hex.hex": "export let n: Int = 1\n",
      "/src/main.hex": "export let rows: Vector(Int) = [1]\n",
    });
    expect(compiled.runtimeDeclarations?.path).toBe("/src/hex1.d.ts");
    expect(
      await typeScriptErrors({
        "hex1.d.ts": compiled.runtimeDeclarations?.text ?? "",
        "hex.d.ts": declarationsOf(compiled, "/src/hex.hex"),
        "main.d.ts": declarationsOf(compiled, "/src/main.hex"),
      }),
    ).toEqual([]);
  });

  test("a consumer names the faces through the emitted module and iterates them", async () => {
    expect(
      await typeScriptErrors(emittedFiles(ALL_FOUR_FACES, {
        "consumer.ts":
          'import type * as Hex from "./hex.js";\n' +
          'import { rows, counts, seen, span, widen } from "./main.js";\n' +
          "export const wider: Hex.Vector<number> = widen(rows, 4);\n" +
          "export function total(): number {\n" +
          "  let sum = 0;\n" +
          "  for (const n of rows) sum += n;\n" +
          "  for (const [, count] of counts) sum += count;\n" +
          "  for (const n of seen) sum += n;\n" +
          "  for (const n of span) sum += n;\n" +
          "  return sum;\n" +
          "}\n",
      })),
    ).toEqual([]);
  });

  // The brand's whole job (§8.1, §8.2). Without it the face is satisfied by any
  // iterable, which is the property the old structural spelling had and the
  // reason it was rejected (§8.4 item 1).
  test("an arbitrary iterable does not satisfy a face — the brand, doing its work", async () => {
    const errors = await typeScriptErrors(emittedFiles(ALL_FOUR_FACES, {
      "forge.ts":
        'import type * as Hex from "./hex.js";\n' +
        "export const fake: Hex.Vector<number> = [1, 2, 3];\n",
    }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2741");
    expect(errors[0]).toContain('"~hex"');
  });

  // The other half of what #128 was filed for: the old face promised an API the
  // runtime value does not implement, so this call used to typecheck and throw.
  test("`get` on a crossed `Map` no longer typechecks — the false promise is gone", async () => {
    const errors = await typeScriptErrors(emittedFiles(ALL_FOUR_FACES, {
      "consumer.ts":
        'import { counts } from "./main.js";\n' +
        "export const one = counts.get(\"a\");\n",
    }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2339");
  });

  test("the faces are cross-program assignable — why the brand is not a `unique symbol`", async () => {
    const runtime = runtimeText(ALL_FOUR_FACES);
    expect(
      await typeScriptErrors({
        // Two programs' outputs, side by side, each with its own copy.
        "hex.d.ts": runtime,
        "other/hex.d.ts": runtime,
        "cross.ts":
          'import type * as Mine from "./hex.js";\n' +
          'import type * as Theirs from "./other/hex.js";\n' +
          "export function hand(v: Theirs.Vector<number>): Mine.Vector<number> { return v; }\n",
      }),
    ).toEqual([]);
  });

  test("the preview text compiles on its own, with nothing to resolve", async () => {
    expect(await typeScriptErrors({ "preview.ts": preview(ALL_FOUR_FACES) })).toEqual([]);
  });

  // §8.3 decides the floor rather than repairing it with a `/// <reference lib>`
  // directive, on the ground that an emitted declaration file has no business
  // widening its consumer's `lib`. That is only a decision if the floor is real.
  test("the declared floor is es2015: `es5` fails on `Iterable`, `es2015` passes", async () => {
    const runtime = runtimeText(ALL_FOUR_FACES);
    const errors = await typeScriptErrors({ "hex.d.ts": runtime }, { lib: "es5" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.includes("error TS2304"))).toBe(true);
    expect(errors[0]).toContain("Iterable");

    expect(await typeScriptErrors({ "hex.d.ts": runtime }, { lib: "es2015" })).toEqual([]);
  });

  // Recorded in §8.3 as the marker's second price, not as a defect: `"~hex"`
  // carries a string-literal type, so TypeScript treats the faces as a
  // discriminated union and narrows on a property that is `undefined` at run
  // time. A consumer telling the faces apart must use the values' own
  // protocols. The test exists so the trap is visible rather than rediscovered.
  test("the marker is a working TypeScript discriminant the runtime always answers wrongly", async () => {
    const runtime = runtimeText(ALL_FOUR_FACES);
    expect(
      await typeScriptErrors({
        "hex.d.ts": runtime,
        "narrow.ts":
          'import type * as Hex from "./hex.js";\n' +
          "export function pick(x: Hex.Vector<number> | Hex.Set<number>): string {\n" +
          '  if (x["~hex"] === "Vector") { const v: Hex.Vector<number> = x; return "vector"; }\n' +
          '  const s: Hex.Set<number> = x; return "set";\n' +
          "}\n",
      }),
    ).toEqual([]);
  });
});
