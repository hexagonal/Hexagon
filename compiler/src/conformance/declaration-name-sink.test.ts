import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **FFI Part 7 §2.4's one sink** — the five rungs a generated
 * `.d.ts` names a nominal through, and the rule that the file's imports are
 * exactly what those answers owe (#574, #268, #617, #618; correction record
 * §14.3).
 *
 * The declaration emitter named every nominal by `type.name` — the type's
 * *declared* name — with no record of how the file it was writing spells that
 * identity. That is right for a type the module declares and right for a prelude
 * type, and wrong for everything else, which is one defect wearing four faces.
 * §14.3 tabulates six failing shapes; each is a `describe` below, and each is
 * checked twice — by text, which says *which rung* answered, and by real `tsc`
 * over the whole emitted set, which says whether the name is bound at all.
 *
 * **Never one file alone.** A declaration file that imports is only TypeScript
 * *together with* what it imports from; checking one in isolation is the lesson
 * §14.2 already paid for, and every `tsc` assertion here runs over the set.
 */

/** One compiled project, with its diagnostics asserted empty. */
function project(files: readonly (readonly [string, string])[]) {
  const compiled = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled;
}

/** Every emitted module's declarations, plus `hex.d.ts` where one was emitted. */
function declarationSet(
  compiled: ReturnType<typeof project>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const module of compiled.modules) {
    const name = module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts");
    files[name] = module.declarations.text;
  }
  if (compiled.runtimeDeclarations !== undefined) {
    files["hex.d.ts"] = compiled.runtimeDeclarations.text;
  }
  return files;
}

/** One emitted module, by source path. */
function emitted(compiled: ReturnType<typeof project>, path: string) {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module;
}

/** One module's `.d.ts` text. */
function declarations(
  compiled: ReturnType<typeof project>,
  path = "/main.hex",
): string {
  return emitted(compiled, path).declarations.text;
}

const POINT = ["/point.hex", "export record Point = {x: Float, y: Float}\n"] as const;

describe("row 1 — a namespace alias beside a same-spelled declaration (TS2440, #574)", () => {
  test("the alias line is not written, because no face qualifies through it", async () => {
    const compiled = project([
      [
        "/point.hex",
        "opaque record Point = {x: Float, y: Float}\n" +
          "export fun getX(p: Point): Float = p.x\n" +
          "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n",
      ],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export fun mine(p: Point): Int = p.n\n" +
          "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
      ],
    ]);

    // The alias serves terms only. §2.4's headline rule — a line no answer owes
    // is not written — dissolves the collision with no renaming at all, which is
    // what §14.3 records as the measurement that relocated the repair.
    expect(declarations(compiled)).toBe(
      "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n" +
        "export declare function mine(p: Point): number;\n" +
        "export declare const far: number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the emitted JavaScript is untouched — the two files decide independently", () => {
    const compiled = project([
      [
        "/point.hex",
        "opaque record Point = {x: Float, y: Float}\n" +
          "export fun getX(p: Point): Float = p.x\n" +
          "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n",
      ],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
      ],
    ]);

    // #569's plan governs the `.js` against that file's contestants, and this
    // collision is real there: the emitted file binds a `Point` const. §2.4 says
    // outright that the two files decide independently, so the alias moves in
    // one and vanishes from the other.
    expect(emitted(compiled, "/main.hex").javascript.text).toContain(
      'import * as Point_1 from "./point.js";',
    );
  });
});

describe("row 2 — a namespace alias beside a named import of the same spelling (#574)", () => {
  test("only the line an answer owes survives", async () => {
    const compiled = project([
      POINT,
      ["/other.hex", "export record Point = {n: Int}\n"],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          'import { Point } from "./other"\n' +
          "export fun mine(p: Point): Int = p.n\n",
      ],
    ]);

    // Two lines bound one identifier before this landed — TS2300 twice, plus a
    // TS2709 for the face, which described the wrong type. The named import is
    // what the face answered through, so its line stays and the alias's does not.
    expect(declarations(compiled)).toBe(
      'import type { Point } from "./other.js";\n' +
        "export declare function mine(p: Point): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 3 — a qualified face, nothing contesting (TS2304, #268)", () => {
  test("rung 3 spells the alias the author wrote", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module Lib from "./lib"\nexport fun mk(p: Lib.Point): Lib.Point = p\n',
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as Lib from "./lib.js";\n' +
        "export declare function mk(p: Lib.Point): Lib.Point;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an annotated `let` keeps its written qualifier too", async () => {
    // The one seat where the checker had the occurrence and dropped it: an
    // annotated `let` unifies two concrete nominal nodes and then publishes the
    // *value's*, which carries its writer's spellings and so none of this
    // module's. §2.4 rests rung 3's totality on every nominal in an exported
    // face having a written occurrence, so the qualifier is carried across.
    const compiled = project([
      [
        "/lib.hex",
        "export record Point = {x: Float, y: Float}\n" +
          "export union Color = Red | Green\n" +
          "export let origin: Point = Point({x = 0.0, y = 0.0})\n" +
          "export let identity(p: Point): Point = p\n",
      ],
      [
        "/main.hex",
        'import module Lib from "./lib"\n' +
          "export let o: Lib.Point = Lib.origin\n" +
          "export let c: Lib.Color = Lib.Red\n" +
          "export let arrow: (Lib.Point) -> Lib.Point = Lib.identity\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain("export declare const o: Lib.Point;");
    expect(text).toContain("export declare const c: Lib.Color;");
    expect(text).toContain("export declare const arrow: (arg0: Lib.Point) => Lib.Point;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a derived declaration inherits its scheme's qualifiers", async () => {
    // A record's constructor arrow, a union's constructor arrow and an
    // exception's payload are all *derived* from a written signature rather than
    // rendered from one. The qualifiers ride the type and survive substitution,
    // so each is emitted by the module that wrote its signature and nothing is
    // lost (§2.4 rung 3's second paragraph).
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module Lib from "./lib"\n' +
          "export record Wrap = {inner: Lib.Point}\n" +
          "export union Holder = Held(p: Lib.Point)\n" +
          "export exception Bad(p: Lib.Point)\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain("export declare const Wrap: (record: { inner: Lib.Point }) => Wrap;");
    expect(text).toContain("export declare const Held: (p: Lib.Point) => Holder;");
    expect(text).toContain("export declare function Bad(p: Lib.Point): Bad;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a qualifier is readable only in the module that wrote it", async () => {
    // §2.4's counterexample, and §14.3's third rejected alternative. `/mid.hex`
    // writes `Lib.Point` into a type alias; `/main.hex` binds the same *spelling*
    // `Lib` to a different module. Reading the travelling qualifier would emit
    // `Lib.Point` here and name `/other.hex`'s `Point` — a real type that is the
    // wrong one, with nothing to report it.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      ["/other.hex", "export record Point = {n: Int}\nexport let one: Int = 1\n"],
      [
        "/mid.hex",
        'import module Lib from "./lib"\nexport type Carried = Lib.Point\n' +
          "export fun pass(p: Carried): Carried = p\n",
      ],
      [
        "/main.hex",
        'import module Lib from "./other"\nimport { pass, Carried } from "./mid"\n' +
          "export fun here(p: Carried): Carried = pass(p)\n" +
          "export fun mine(p: Lib.Point): Lib.Point = p\n" +
          "export let n: Int = Lib.one\n",
      ],
    ]);
    const text = declarations(compiled);

    // This module's *own* `Lib` is bound and qualified, so its line is in the
    // file and `Lib.Point` is a spelling that resolves — to `/other.hex`'s
    // record. Reading the travelling qualifier would therefore not fail loudly;
    // it would publish `/other.hex`'s type where the source said `/lib.hex`'s,
    // with nothing to report it. `tsc` cannot see that, so the text must.
    expect(text).toContain('import type { Point } from "./lib.js";');
    expect(text).toContain("export declare function here(p: Point): Point;");
    expect(text).toContain("export declare function mine(p: Lib.Point): Lib.Point;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("two aliases onto one module each spell their own seats", async () => {
    // Neither alias is *the* alias for the identity, which is why the rung reads
    // the occurrence: keyed on the identity, one of them would spell both seats.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module A from "./lib"\nimport module B from "./lib"\n' +
          "export fun first(p: A.Point): A.Point = p\n" +
          "export fun second(p: B.Point): B.Point = p\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as A from "./lib.js";\n' +
        'import type * as B from "./lib.js";\n' +
        "export declare function first(p: A.Point): A.Point;\n" +
        "export declare function second(p: B.Point): B.Point;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 4 — a bare face in scope only by the companion fallback (TS2709, #268)", () => {
  test("a bare occurrence is not rung 3's; it falls to rung 5", async () => {
    // Modules §5.1 rule 2 puts the exported member's own name in scope, so the
    // source wrote `Shape` and not `Shape.Shape`. Keying rung 3 on the identity
    // would render `Shape.Shape` here — something the author did not write — and
    // the emitter used to render the *alias* in type position, which TypeScript
    // rejects outright.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "export fun width(s: Shape): Int = s.s + Shape.unit\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare function width(s: Shape): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the gated alias moves nothing — the minted local keeps the bare name", () => {
    // §14.3's fourth rejected alternative, measured: counting the alias in the
    // probe's universe would push this file's own face to `Shape1`, against a
    // `Shape` the file does not contain.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "export fun width(s: Shape): Int = s.s + Shape.unit\n",
      ],
    ]);

    expect(declarations(compiled)).not.toContain("Shape1");
  });
});

describe("row 5 — a renamed type import (TS2304, #617)", () => {
  test("the face spells the local, not the imported name", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/main.hex",
        'import { Shape as S } from "./shape"\nexport let c: S = S({s = 1})\n',
      ],
    ]);

    // The import line was already right and the face was wrong, so the two
    // halves of one channel disagreed inside a single file.
    expect(declarations(compiled)).toBe(
      'import type { Shape as S } from "./shape.js";\n' +
        "export declare const c: S;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a rename of a union and of an extern type answer the same way", async () => {
    const compiled = project([
      [
        "/lib.hex",
        "export union Color = Red | Green\n" +
          'extern from "./host.js"\n    export type Handle\n',
      ],
      [
        "/main.hex",
        'import { Color as C, Handle as H } from "./lib"\n' +
          "export fun both(c: C, h: H): H = h\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Color as C, Handle as H } from "./lib.js";\n' +
        "export declare function both(c: C, h: H): H;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 6 — a type alias's expansion (TS2304, #618)", () => {
  test("the file mints its own import of a type it names under no spelling", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/mid.hex",
        'import { Shape } from "./shape"\nexport type Wrapped = Shape\n' +
          "export fun one(): Wrapped = Shape({s = 1})\n",
      ],
      ["/main.hex", 'import { one, Wrapped } from "./mid"\nexport let c: Wrapped = one()\n'],
    ]);

    // A face carries an alias's expansion and never its name, so `/main.hex`
    // names `Shape` under no spelling whatever: it binds `Wrapped`, and rung 2
    // owns the names an import *binds*. The `Wrapped` row goes with the same
    // rule — no face mentions it — which is one of the three text changes §14.3
    // names as expected.
    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare const c: Shape;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the minted edge is reported, and adds no JavaScript import", async () => {
    // §2.4's Reachability, extended by §14.3: rung 5's edges reach modules the
    // source never imported at all, and they count toward what gets emitted
    // exactly as the inventory's do — or the declarations import from a file
    // that was never written. What is pinned here is the *report*, which is what
    // `compileProject`'s walk consumes.
    //
    // No shape reaches the walk today: every non-injected module is emitted
    // unconditionally, and a user module's prelude inventory carries every
    // prelude nominal it could name, so a minted line's target is always a
    // module that was going to be written anyway. The channel is wired for the
    // rule rather than for a case, and this is the half of it that can be seen.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/mid.hex",
        'import { Shape } from "./shape"\nexport type Wrapped = Shape\n' +
          "export fun one(): Wrapped = Shape({s = 1})\n",
      ],
      ["/main.hex", 'import { one, Wrapped } from "./mid"\nexport let c: Wrapped = one()\n'],
    ]);

    expect(emitted(compiled, "/main.hex").declarations.mintedTypeImports).toEqual(["./shape"]);
    expect(compiled.modules.map(({ source }) => source.path)).toContain("/shape.hex");
    // Declaration-side only: no JavaScript import is added, which would be a
    // load-order dependency the source never wrote (the #263 doctrine).
    expect(emitted(compiled, "/main.hex").javascript.text).not.toContain("./shape.js");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("minted lines are ordered by home specifier, then by imported name", async () => {
    const compiled = project([
      ["/a.hex", "export record Alpha = {n: Int}\nexport record Beta = {n: Int}\n"],
      ["/b.hex", "export record Gamma = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Alpha, Beta } from "./a"\nimport { Gamma } from "./b"\n' +
          "export type A = Alpha\nexport type B = Beta\nexport type G = Gamma\n" +
          "export fun mk(g: G, b: B, a: A): Int = 0\n",
      ],
      [
        "/main.hex",
        'import { mk, A, B, G } from "./mid"\nexport fun use(g: G, b: B, a: A): Int = mk(g, b, a)\n',
      ],
    ]);

    // Rung 5 has no inventory to follow and must not fall back on first
    // reference: the source above reverses the order deliberately.
    expect(declarations(compiled)).toBe(
      'import type { Alpha } from "./a.js";\n' +
        'import type { Beta } from "./a.js";\n' +
        'import type { Gamma } from "./b.js";\n' +
        "export declare function use(g: Gamma, b: Beta, a: Alpha): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("where the alias is contested, the alias yields", () => {
  test("a qualified face beside a same-spelled declaration takes `Point_1`", async () => {
    const compiled = project([
      POINT,
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export fun mine(p: Point): Int = p.n\n" +
          "export fun theirs(p: Point.Point): Float = p.x\n",
      ],
    ]);

    // Rung 1's declaration keeps the bare spelling — it is, or may become, the
    // module's public face — and the alias takes the collision-only `_1` its
    // emitted-JavaScript counterpart takes, being a source name stepping aside
    // rather than a spelling the compiler minted.
    expect(declarations(compiled)).toBe(
      'import type * as Point_1 from "./point.js";\n' +
        "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n" +
        "export declare function mine(p: Point): number;\n" +
        "export declare function theirs(p: Point_1.Point): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("one identity at two rungs carries two lines and two spellings", async () => {
    const compiled = project([
      POINT,
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export fun qualified(p: Point.Point): Float = p.x\n" +
          "export fun bare(p: Point): Float = p.x\n",
      ],
    ]);

    // One seat is qualified and the other is the companion fallback's bare one,
    // so one identity reaches both rung 3 and rung 5. The alias is uncontested
    // here and keeps its own spelling; the minted local moves instead, the
    // alias's line now being present to contest it. TypeScript binds both to the
    // same declaration, which is what the `tsc` run below establishes.
    expect(declarations(compiled)).toBe(
      'import type { Point as Point1 } from "./point.js";\n' +
        'import type * as Point from "./point.js";\n' +
        "export declare function qualified(p: Point.Point): number;\n" +
        "export declare function bare(p: Point1): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("placement, and one probe for both minting rungs", () => {
  test("the runtime import, then rung 4's lines, then rung 5's, then the module's own", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Point } from "./lib"\nexport type Wrapped = Point\n' +
          "export fun one(): Wrapped = Point({n = 1})\n",
      ],
      ["/other.hex", "export union Color = Red | Green\n"],
      [
        "/main.hex",
        'import { Color } from "./other"\nimport { one, Wrapped } from "./mid"\n' +
          "export fun f(c: Color, w: Wrapped, v: Vector(Int)): Option(Int) = None\n",
      ],
    ]);

    // §2.4's Placement, in one file: the compiler's own lines lead, in the order
    // the section fixes, and a line the module wrote keeps its source seat.
    // `tsc` cannot decide this — an ESM import is legal anywhere at top level —
    // so the order is pinned by the text.
    expect(declarations(compiled)).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'import type { Option } from "./Option.js";\n' +
        'import type { Point } from "./lib.js";\n' +
        'import type { Color } from "./other.js";\n' +
        "export declare function f(c: Color, w: Point, v: Hex.Vector<number>): Option<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a minted local and an inventory local cannot land on each other", async () => {
    const compiled = project([
      ["/lib.hex", "export record Option = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Option as LibOption } from "./lib"\nexport type Held = LibOption\n' +
          "export fun one(): Held = LibOption({n = 1})\n",
      ],
      [
        "/main.hex",
        'import { one, Held } from "./mid"\n' +
          "export let a: Held = one()\nexport let b: Option(Int) = None\n",
      ],
    ]);

    // Rung 4 and rung 5 both mint into one file, and both probe the same
    // universe: whichever is asked first takes the unsuffixed name and the other
    // moves. Two probes over two sets would put one declaration under two names.
    expect(declarations(compiled)).toBe(
      'import type { Option as Option1 } from "./Option.js";\n' +
        'import type { Option } from "./lib.js";\n' +
        "export declare const a: Option;\n" +
        "export declare const b: Option1<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("what the sink is not asked", () => {
  test("§2.3's pins are settled first — a qualified `Seq` faces as `Iterable`", async () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      [
        "/main.hex",
        'import module S from "./Seq"\nimport module B from "./Bool"\n' +
          "export fun pass(s: S.Seq(Int), flag: B.Bool): S.Seq(Int) = s\n",
      ],
    ]);

    // A pin governs the face, not the spelling that reached it: neither
    // occurrence imports anything, and no rung ever sees them.
    expect(declarations(compiled)).toBe(
      "export declare function pass(s: Iterable<number>, flag: boolean): Iterable<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a prelude identity the source qualified is rung 3's, not rung 4's", async () => {
    const compiled = project([[
      "/main.hex",
      'import module O from "./Option"\nexport fun pick(o: O.Option(Int)): O.Option(Int) = o\n',
    ]]);

    // A take-over of the channel §14.2 established, in the direction §14.2 did
    // not anticipate: rung 3 answered, so the inventory line it would otherwise
    // owe is not written and the face reads `O.Option`.
    expect(declarations(compiled)).toBe(
      'import type * as O from "./Option.js";\n' +
        "export declare function pick(o: O.Option<number>): O.Option<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("a module whose whole `.d.ts` was one dead line", () => {
  test("it becomes `export {};`", async () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      ["/main.hex", 'import module Lib from "./lib"\nlet n: Int = Lib.one\n'],
    ]);

    // The third of §14.3's expected text changes: a module that exports nothing
    // and namespace-imports for terms had a `.d.ts` consisting of that one line,
    // which made the file a module. With the line gone the marker is what says so.
    expect(declarations(compiled)).toBe("export {};\n");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a named import whose type half no face mentions is left out on the same rule", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {n: Int}\n"],
      ["/main.hex", 'import { Point } from "./lib"\nexport let n: Int = Point({n = 1}).n\n'],
    ]);

    expect(declarations(compiled)).toBe("export declare const n: number;\n");
    // The JavaScript still imports the constructor: the two files are decided
    // by different questions.
    expect(emitted(compiled, "/main.hex").javascript.text).toContain(
      'import { Point } from "./lib.js";',
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the harness would notice", () => {
  test("each pre-fix spelling is rejected — the controls that make the checks real", async () => {
    expect(
      (await typeScriptErrors({ "faces.d.ts": "export declare const c: Shape;\n" })).join("\n"),
    ).toContain("error TS2304");

    const collision = await typeScriptErrors({
      "point.d.ts": "export type Point = { x: number };\n" +
        "export declare const Point: (record: { x: number }) => Point;\n",
      "faces.d.ts": 'import type * as Point from "./point.js";\n' +
        "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n",
    });
    expect(collision.join("\n")).toContain("error TS2440");

    const namespaceAsType = await typeScriptErrors({
      "point.d.ts": "export type Point = { x: number };\n",
      "faces.d.ts": 'import type * as Shape from "./point.js";\n' +
        "export declare const c: Shape;\n",
    });
    expect(namespaceAsType.join("\n")).toContain("error TS2709");
  });
});
