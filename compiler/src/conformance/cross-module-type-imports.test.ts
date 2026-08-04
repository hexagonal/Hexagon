import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 7 §2.4: a generated `.d.ts` carries a type-only named
 * import for every other-module Hexagon type its faces mention.
 *
 * The defect (#227) is not really a TS2304. An unimported name is resolved by
 * the *consumer's* `lib` and `types` settings rather than by this compiler —
 * under the default lib set a bare `Option` binds to `lib.dom.d.ts`'s legacy
 * `Option` and describes the wrong thing. So the assertions here run the real
 * TypeScript compiler over whole emitted *sets*, which is the only way to see
 * whether a name is bound to what its module meant; the text assertions
 * alongside pin which channel bound it.
 *
 * Two channels put such a type in scope, and each import is owned by exactly
 * one: a source-written import owns every name it binds, and prelude-supplied
 * types ride the resolver's inventory filtered to what the faces reference.
 */

/** One compiled project, with its diagnostics asserted empty. */
function project(files: readonly (readonly [string, string])[]) {
  const compiled = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(compiled.diagnostics).toEqual([]);
  return compiled;
}

/**
 * Every emitted module's declarations, keyed for `typeScriptErrors`.
 *
 * The set, never one file: a declaration file that imports is only TypeScript
 * *together with* what it imports from, and checking one in isolation is what
 * left #227 undetected — the emitted text read fine line by line.
 */
function declarationSet(
  compiled: ReturnType<typeof project>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const module of compiled.modules) {
    const name = module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts");
    files[name] = module.declarations.text;
  }
  return files;
}

/** One emitted module, by the basename of its source path. */
function emitted(compiled: ReturnType<typeof project>, basename: string) {
  const module = compiled.modules.find(({ source }) => source.path.endsWith(basename));
  if (module === undefined) throw new Error(`${basename} was not emitted`);
  return module;
}

describe("prelude-supplied types are imported by the faces that reach them", () => {
  test("`Seq.d.ts` compiles — the filed acceptance (#227)", async () => {
    const compiled = project([["/main.hex", "export let e: Seq(Int) = Seq.empty\n"]]);
    const files = declarationSet(compiled);

    expect(files["Seq.d.ts"]).toContain('import type { Option } from "./Option.js";');
    expect(await typeScriptErrors(files)).toEqual([]);
  });

  test("a user module imports each prelude type from its own owning member", async () => {
    const compiled = project([[
      "/main.hex",
      "export let o: Option(Int) = None\n" +
        "export let g(a: Ordering, b: Ordering): Bool = a == b\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // One statement per type, not per module, and each from the member that
    // declares it: `Ordering` is `Prelude.hex`'s, `Option` is `Option.hex`'s.
    expect(text).toContain('import type { Ordering } from "./Prelude.js";');
    expect(text).toContain('import type { Option } from "./Option.js";');
    // Inventory order — the normative prelude order — not first-use order,
    // which the source above deliberately reverses.
    expect(text.indexOf("./Prelude.js")).toBeLessThan(text.indexOf("./Option.js"));
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("records and extern types ride the inventory too, one statement each", async () => {
    // Today's prelude exports exactly three importable types, all unions —
    // `Seq` is a record but faces as `Iterable` (§2.3), so nothing else would
    // reach the other two arms of §2.4's inventory. A project may supply its own
    // file at a prelude injection path, which is what makes them testable at
    // all; the member's real source is extended rather than replaced, so this
    // pins the rule and not a transcription of `Prelude.hex`.
    const compiled = project([
      ["/main.hex", "export let pick(p: Pair, h: Handle): Handle = h\n"],
      [
        "/Prelude.hex",
        `${PRELUDE_SOURCES["Prelude.hex"]!}\n` +
          "export opaque record Pair = {left: Int, right: Int}\n" +
          'extern from "./shapes.js"\n    export type Handle\n',
      ],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // One statement per type, not per module — two types from one member is two
    // statements, which is ordinary ESM.
    expect(text).toContain('import type { Pair } from "./Prelude.js";');
    expect(text).toContain('import type { Handle } from "./Prelude.js";');
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the module a face imports from is emitted, though no term reaches it", async () => {
    // A prelude module is emitted only when something emitted imports it, and
    // this channel's edges are decided during emission — the same shape as
    // `preludeInstanceImports` and `preludeTermImports`, and the only one of the
    // three with no JavaScript counterpart. The specimen below touches no
    // `Option` term at all, so nothing else would pull `Option.hex` in and the
    // `.d.ts` would import from a file that was never written.
    const compiled = project([["/main.hex", "export let f(o: Option(Int)): Option(Int) = o\n"]]);

    expect(compiled.modules.map(({ source }) => source.path)).toContain("/Option.hex");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a prelude type in scope but named by no face is not imported", () => {
    const compiled = project([["/main.hex", "export let n: Int = 1\n"]]);

    expect(emitted(compiled, "/main.hex").declarations.text).not.toContain("import type");
  });

  test("the pinned faces import nothing — `Bool` and `Seq` are not nominal here", () => {
    const compiled = project([[
      "/main.hex",
      "export let ok: Bool = True\nexport let s: Seq(Int) = Seq.empty\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    expect(text).toBe(
      "export declare const ok: boolean;\nexport declare const s: Iterable<number>;\n",
    );
  });
});

describe("a source-written import owns every name it binds", () => {
  test("a term+type name keeps its `.d.ts` type row, and its JavaScript term import", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      ["/app.hex", 'import { Point } from "./lib"\nexport let mk(): Point = Point({x = 1.0, y = 2.0})\n'],
    ]);
    const app = emitted(compiled, "/app.hex");

    // The record's name binds the constructor *and* the type. Before #227 the
    // type-only marking keyed off the term's absence, so the term half silently
    // cost the `.d.ts` its row.
    expect(app.declarations.text).toContain('import type { Point } from "./lib.js";');
    expect(app.javascript.text).toContain('import { Point } from "./lib.js";');
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a pure-term import still contributes no declaration row", () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      ["/app.hex", 'import { one } from "./lib"\nexport let two: Int = one + one\n'],
    ]);

    expect(emitted(compiled, "/app.hex").declarations.text).toBe(
      "export declare const two: number;\n",
    );
  });

  test("a rename is respected and the faces spell the local", async () => {
    const compiled = project([
      ["/lib.hex", "export union Color = Red | Green\n"],
      ["/app.hex", 'import { Color as LibColor } from "./lib"\nexport let pick(c: LibColor): LibColor = c\n'],
    ]);

    expect(emitted(compiled, "/app.hex").declarations.text).toBe(
      'import type { Color as LibColor } from "./lib.js";\n' +
        "export declare const pick: (c: LibColor) => LibColor;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an explicit import of a prelude type binds it once, not twice", async () => {
    const compiled = project([[
      "/main.hex",
      'import { Option } from "./Option"\nexport let o: Option(Int) = None\n',
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // Channel 1 took the entry over. A second line from the prelude channel
    // would be a duplicate identifier, which is why the take-over is by
    // identity rather than by whether a term came with it.
    expect(text.match(/import type \{ Option\b/gu)).toHaveLength(1);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an explicit prelude import under a rename moves the faces too", async () => {
    const compiled = project([[
      "/main.hex",
      'import { Option as Maybe } from "./Option"\nexport let o: Maybe(Int) = None\n',
    ]]);

    expect(emitted(compiled, "/main.hex").declarations.text).toBe(
      'import type { Option as Maybe } from "./Option.js";\n' +
        "export declare const o: Maybe<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("placement", () => {
  test("the runtime import, then §2.4's lines, then the module's own items", async () => {
    const compiled = project([
      ["/lib.hex", "export union Color = Red | Green\n"],
      [
        "/main.hex",
        'import { Color } from "./lib"\n' +
          "export let f(c: Color, v: Vector(Int)): Option(Int) = None\n",
      ],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // §2.4 Placement: a compiler-written import precedes the module's own
    // items. `tsc` cannot decide this — an ESM import is legal anywhere at top
    // level — so the order is pinned by the text.
    expect(text).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'import type { Option } from "./Option.js";\n' +
        'import type { Color } from "./lib.js";\n' +
        "export declare const f: (c: Color, v: Hex.Vector<number>) => Option<number>;\n",
    );
    expect(await typeScriptErrors({
      ...declarationSet(compiled),
      "hex.d.ts": compiled.runtimeDeclarations!.text,
    })).toEqual([]);
  });
});

describe("the generated local is probed, and only it moves", () => {
  test("a namespace alias spelling a prelude type's name forces `Option1`", async () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      ["/main.hex", 'import * as Option from "./lib"\nexport let o: Option(Int) = None\n'],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // §2.4 calls the probe a guard rather than decoration, and this is the
    // route that reaches it: a module alias occludes the prelude *term* layer
    // (Modules §5.4) without touching the type, so `Option(Int)` still names the
    // prelude union while the identifier `Option` is spoken for. The user's
    // alias keeps its spelling; only the generated one moves (Part 1 §10).
    expect(text).toContain('import type { Option as Option1 } from "./Option.js";');
    expect(text).toContain('import type * as Option from "./lib.js";');
    expect(text).toContain("export declare const o: Option1<number>;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("what the rule does not reach", () => {
  test("an occluding declaration renders and exports its own type, bare", async () => {
    const compiled = project([[
      "/main.hex",
      "export union Ordering = Asc | Desc\nexport let pick(o: Ordering): Ordering = o\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // Matching is by identity: this `Ordering` is the module's own, so the
    // prelude entry of the same name is never referenced and never imported.
    // The occluded identity cannot appear in an exported face at all — an
    // export's complete signature can only spell what is in scope.
    expect(text).not.toContain("import");
    expect(text).toContain("export type Ordering =");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the harness would notice", () => {
  test("the pre-fix spelling is rejected — TS2304, the control that makes the check real", async () => {
    const errors = await typeScriptErrors({
      "faces.d.ts": "export declare const o: Option<number>;\n",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2304");
    expect(errors[0]).toContain("Cannot find name 'Option'");
  });
});
