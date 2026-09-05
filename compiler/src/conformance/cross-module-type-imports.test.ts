import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { STDLIB_SOURCES } from "../stdlib-sources.js";
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
    const name = module.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts");
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
    const compiled = project([["/main.hex", "module Main\n\n" + "export let e: Seq(Int) = Seq.empty\n"]]);
    const files = declarationSet(compiled);

    expect(files["Hex/Seq.d.ts"]).toContain('import type { Option } from "./Option.js";');
    expect(await typeScriptErrors(files)).toEqual([]);
  });

  test("a user module imports each prelude type from its own owning member", async () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + "export let o: Option(Int) = None\n" +
        "export let g(a: Ordering, b: Ordering): Bool = a == b\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // One statement per type, not per module, and each from the member that
    // declares it: `Ordering` is `Ordering.hex`'s (#742 rehomed it there from
    // `Prelude.hex`, so its constructors have a module to be spelled through),
    // `Option` is `Option.hex`'s.
    expect(text).toContain('import type { Ordering } from "./Hex/Ordering.js";');
    expect(text).toContain('import type { Option } from "./Hex/Option.js";');
    // Inventory order — the normative prelude order — not first-use order,
    // which the source above deliberately reverses.
    expect(text.indexOf("./Hex/Ordering.js")).toBeLessThan(text.indexOf("./Hex/Option.js"));
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
      ["/main.hex", "module Main\n\n" + "export let pick(p: Pair, h: Handle): Handle = h\n"],
      [
        "/Prelude.hex",
        `${STDLIB_SOURCES["Prelude"]!}\n` +
          "opaque record Pair = {left: Int, right: Int}\n" +
          'extern from "./shapes.js"\n    export type Handle\n',
      ],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // One statement per type, not per module — two types from one member is two
    // statements, which is ordinary ESM.
    expect(text).toContain('import type { Pair } from "./Hex/Prelude.js";');
    expect(text).toContain('import type { Handle } from "./Hex/Prelude.js";');
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the module a face imports from is emitted, though no term reaches it", async () => {
    // A prelude module is emitted only when something emitted imports it, and
    // this channel's edges are decided during emission — the same shape as
    // `preludeInstanceImports` and `preludeTermImports`, and the only one of the
    // three with no JavaScript counterpart. The specimen below touches no
    // `Option` term at all, so nothing else would pull `Option.hex` in and the
    // `.d.ts` would import from a file that was never written.
    const compiled = project([["/main.hex", "module Main\n\n" + "export let f(o: Option(Int)): Option(Int) = o\n"]]);

    expect(compiled.modules.map(({ source }) => source.path)).toContain("/Hex/Option.hex");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a prelude type in scope but named by no face is not imported", () => {
    const compiled = project([["/main.hex", "module Main\n\n" + "export let n: Int = 1\n"]]);

    expect(emitted(compiled, "/main.hex").declarations.text).not.toContain("import type");
  });

  test("the pinned faces import nothing — `Bool` and `Seq` are not nominal here", () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + "export let ok: Bool = True\nexport let s: Seq(Int) = Seq.empty\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    expect(text).toBe(
      "export declare const ok: boolean;\nexport declare const s: Iterable<number>;\n",
    );
  });
});

describe("a source-written import owns every name it binds", () => {
  // #762: an import binds a module alias, never a name. What used to be "a
  // source-written *named* import" is now the companion fallback (Modules
  // §3.2, rule 2/3) — a module alias reached bare, same spelling as its
  // module's export — and that is the only route left that puts a
  // *type-only* `.d.ts` row for a user module's declaration, the way channel
  // 1's automatic prelude routing does. A qualified use (`Lib.Point`)
  // instead imports the whole namespace (`import type * as Lib`), which is a
  // different — and already covered — shape (see "placement" below).
  test("a term+type name keeps its `.d.ts` type row, and its JavaScript module import", async () => {
    const compiled = project([
      ["/lib.hex", "module Lib\n\n" + "export record Point = {x: Float, y: Float}\n"],
      ["/app.hex", "module App\n\n" + 'import Lib as Point\nexport let mk(): Point = Point.Point({x = 1.0, y = 2.0})\n'],
    ]);
    const app = emitted(compiled, "/app.hex");

    // The record's name binds the constructor *and* the type. Before #227 the
    // type-only marking keyed off the term's absence, so the term half silently
    // cost the `.d.ts` its row. The bare `Point` type still gets that row
    // through the fallback; the constructor is reached qualified (`Point.Point`)
    // since a rule-3-resolved bare term that is actually called crashes at
    // runtime today — a confirmed emission bug, irrelevant here since this test
    // only inspects text — but qualifying keeps the specimen unambiguous.
    expect(app.declarations.text).toContain('import type { Point } from "./Lib.js";');
    expect(app.javascript.text).toContain('import * as Point from "./Lib.js";');
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a pure-term import still contributes no declaration row", () => {
    const compiled = project([
      ["/lib.hex", "module Lib\n\n" + "export let one: Int = 1\n"],
      ["/app.hex", "module App\n\n" + 'import Lib\nlet one = Lib.one\nexport let two: Int = one + one\n'],
    ]);

    expect(emitted(compiled, "/app.hex").declarations.text).toBe(
      "export declare const two: number;\n",
    );
  });

  // Deleted: "a rename is respected and the faces spell the local". #762
  // removes renamed named imports outright, and their §3.2 replacement for a
  // type — `type LibColor = Lib.Color` — is a transparent alias: the emitted
  // face prints the resolved type (`Lib.Color`), not the alias's own spelling.
  // Confirmed empirically. There is no surviving route by which an imported
  // type's *local* rename shows up in an exported face, so the property this
  // test existed to pin no longer holds under any spelling — it is not
  // re-aimable without asserting something the compiler correctly refuses.

  test("an explicit import of a prelude type binds it once, not twice", async () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + 'import Option\nexport let o: Option(Int) = None\n',
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // Channel 1 took the entry over. A second line from the prelude channel
    // would be a duplicate identifier, which is why the take-over is by
    // identity rather than by whether a term came with it.
    expect(text.match(/import type \{ Option\b/gu)).toHaveLength(1);
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  // Deleted: "an explicit prelude import under a rename moves the faces too".
  // Same defect as the rename test above, one prelude module over: the §3.2
  // replacement for a renamed type import is `type Maybe(a) = Opt.Option(a)`,
  // a transparent alias, so the emitted face prints `Opt.Option`, never
  // `Maybe` — confirmed empirically. No route makes a renamed type's local
  // spelling appear in a face any more.
});

describe("placement", () => {
  test("the runtime import, then §2.4's lines, then the module's own items", async () => {
    const compiled = project([
      ["/lib.hex", "module Lib\n\n" + "export union Color = Red | Green\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Lib as Color\n' +
          "export let f(c: Color, v: Vector(Int)): Option(Int) = None\n",
      ],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // §2.4 Placement: a compiler-written import precedes the module's own
    // items. `tsc` cannot decide this — an ESM import is legal anywhere at top
    // level — so the order is pinned by the text.
    expect(text).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'import type { Option } from "./Hex/Option.js";\n' +
        'import type { Color } from "./Lib.js";\n' +
        "export declare const f: (c: Color, v: Hex.Vector<number>) => Option<number>;\n",
    );
    expect(await typeScriptErrors({
      ...declarationSet(compiled),
      "hex.d.ts": compiled.runtimeDeclarations!.text,
    })).toEqual([]);
  });
});

// §2.4 counts at least three routes to the probe, and all three are live. It is
// a guard rather than decoration, so each is pinned here — the alias one below
// is the least surprising of them and was the only one the ruling foresaw.
describe("the generated local is probed, and only it moves", () => {
  test("an exported constructor sharing a prelude type's name forces `Option_1`", async () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + "export union MyU = Option(Int) | Nother\nexport let o: Option(Int) = None\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // No import alias in sight: a constructor is an uppercase top-level `.d.ts`
    // identifier (§3–§4), so it collides with a prelude type's name on its own.
    // The constructor is a user name and keeps its spelling; only the generated
    // local moves (Part 1 §10).
    expect(text).toContain('import type { Option as Option_1 } from "./Hex/Option.js";');
    expect(text).toContain("export declare const Option: (item1: number) => MyU;");
    expect(text).toContain("export declare const o: Option_1<number>;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an occluding declaration beside a qualified face of the occluded identity", async () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + "export union Ordering = Asc | Desc\n" +
        "export let f(x: Ordering.Ordering): Int = 0\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // Occlusion takes the bare spelling only: `Ordering.Ordering` still names
    // the prelude union (Modules §5.4, §6.4) — the module alias is a namespace
    // of its own, which a type declaration does not occlude — so the occluded
    // identity does reach an exported face. Both types then live in one file:
    // the module's own under the bare name, the prelude's under a probed local.
    expect(text).toContain('import type { Ordering as Ordering_1 } from "./Hex/Ordering.js";');
    expect(text).toContain('export type Ordering = { tag: "Asc" } | { tag: "Desc" };');
    expect(text).toContain("export declare const f: (x: Ordering_1) => number;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a namespace alias spelling a prelude type's name forces `Option_1`", async () => {
    const compiled = project([
      ["/lib.hex", "module Lib\n\n" + "export record Row = {n: Int}\nexport let one: Int = 1\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Lib as Option\n' +
          "export let o: Option(Int) = None\nexport let r(x: Option.Row): Int = 1\n",
      ],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // §2.4 calls the probe a guard rather than decoration, and this is the
    // route that reaches it: a module alias occludes the prelude *term* layer
    // (Modules §5.4) without touching the type, so `Option(Int)` still names the
    // prelude union while the identifier `Option` is spoken for. The user's
    // alias keeps its spelling; only the generated one moves (Part 1 §10).
    //
    // The alias is spoken for **because a face qualifies through it**: that is
    // what puts its line in the file. Without the `Option.Row` seat below the
    // line is not written and the alias contests nothing — the case beneath.
    expect(text).toContain('import type { Option as Option_1 } from "./Hex/Option.js";');
    expect(text).toContain('import type * as Option from "./Lib.js";');
    expect(text).toContain("export declare const o: Option_1<number>;");
    expect(text).toContain("export declare const r: (x: Option.Row) => number;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a gated alias moves nothing — the probe counts what the file carries", async () => {
    const compiled = project([
      ["/lib.hex", "module Lib\n\n" + "export let one: Int = 1\n"],
      ["/main.hex", "module Main\n\n" + 'import Lib as Option\nexport let o: Option(Int) = None\n'],
    ]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // The alias serves terms only, so no face qualifies through it, so its line
    // is not written and the identifier is free. Counting it anyway would move
    // a minted local aside for a name the reader cannot find — the failure the
    // rung order exists to avoid.
    expect(text).toBe(
      'import type { Option } from "./Hex/Option.js";\n' +
        "export declare const o: Option<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("what the rule does not reach", () => {
  test("an occluding declaration renders and exports its own type, bare", async () => {
    const compiled = project([[
      "/main.hex",
      "module Main\n\n" + "export union Ordering = Asc | Desc\nexport let pick(o: Ordering): Ordering = o\n",
    ]]);
    const text = emitted(compiled, "/main.hex").declarations.text;

    // Matching is by identity: this `Ordering` is the module's own, so the
    // prelude entry of the same name is never referenced and never imported.
    // Occlusion takes only the *bare spelling*, which is all this pins — the
    // prelude identity stays reachable qualified (Modules §5.4, §6.4) and can
    // still appear in an exported face, which the probe block covers.
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
