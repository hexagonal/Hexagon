import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for **the generalisation law's reach** — #544, in the declaration
 * form #546 gave it; Modules §5.3's reach sentence, Constraints §4.6's boundary
 * paragraph and §4.7's form, Modules §3.1's door sentence.
 *
 * The law is **layer-blind**. The two power doors are its first instances, not
 * its extent: what decides where a `widens` declaration is writable is the
 * claim's own geography — the carve amends Constraints §4.6's honor-claim and
 * nothing else, so it is available in any honoring module where the member's
 * spelling is not already an *ordinary* binding. A constraint reached through a
 * namespace import (§3.3) therefore stands exactly as a prelude one does,
 * because that form binds the alias alone and leaves every member spelling free.
 *
 * This file pins that reading at a **user** constraint over a namespace import,
 * where nothing is prelude-gated and every verdict can be shown side by side:
 * the declaration compiles and all three faces run, a bare in-module use beside
 * the lawful pair resolves to the widens binding at both argument shapes, and
 * the carve — a spelling that is already an ordinary binding, in the declaring
 * module or anywhere else — keeps the prior refusal, the law unconsulted.
 * (An import brings only a module alias into scope now (#762), so the second
 * carve this file used to pin — a named import's members colliding with a
 * would-be door — has no program left that reaches it.)
 *
 * The behavioural half of the law is what makes the route pins necessary rather
 * than fussy: since #546 the door and the member agree on the whole shared
 * domain *by construction* — one body, restricted mechanically — so no observed
 * *value* can tell which face answered. The emitted JavaScript can.
 */

/** The declaring module: a user constraint with one widenable seat. */
function scaleModule(tag: string): string {
  return [
    "module Scale",
    "",
    `// scale ${tag}`,
    "export constraint Scale<a> =",
    "    scale(value: a, factor: Int): a",
    "",
    "// The genuinely polymorphic face, written on the declaring side: bare",
    "// `scale` here is the member's forwarder, and the evidence rides the call.",
    "export let scaledTwice<a: Scale>(value: a): a = scale(scale(value, 2), 2)",
    "",
  ].join("\n");
}

/**
 * The honoring module in the current form: **one written body**, the `widens`
 * declaration, with the member derived as its restriction — the `Int` factor
 * reaching the `Float` seat through Numeric Literals §5.1's exact conversion,
 * inserted by the seat rather than written anywhere.
 *
 * The declaration sits on **line 9** of every module this builds, which is the
 * line the refusals below name.
 */
function matrixModule(
  tag: string,
  door: string,
  ...extra: readonly string[]
): string {
  return [
    "module Matrix",
    "",
    `// matrix ${tag}`,
    "import Scale",
    "",
    "export record Matrix = {n: Float}",
    "",
    "// The one body. The member is this, restricted.",
    door,
    "",
    "honor Scale.Scale<Matrix> =",
    "    scale = widened",
    "",
    ...extra,
  ].join("\n");
}

/** The lawful door: same subject seat, same result, the factor properly wider. */
const DOOR = "widens Scale.scale(value: Matrix, factor: Float): Matrix = " +
  "Matrix({n = value.n * factor})";

/** One module's emitted JavaScript, with the whole project asserted clean. */
function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

/** Every diagnostic a two-module project produced, in order. */
function verdict(tag: string, door: string, ...extra: readonly string[]): readonly string[] {
  return compileFiles([
    ["/scale.hex", scaleModule(tag)],
    ["/matrix.hex", matrixModule(tag, door, ...extra)],
  ]).diagnostics.map(({ message }) => message);
}

describe("the control: the harness reports a failure rather than passing it", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let r: Int = noSuchName\n"))
      .toEqual(["unknown name `noSuchName`"]);
  });
});

describe("the law at a namespace-imported user constraint (Modules §5.3)", () => {
  test("the door compiles, and all three faces run", async () => {
    // Qualified and dotted reach the door — one claimant, not a §6 collision —
    // and the member is reached genuinely polymorphically from the declaring
    // side, through the constraint. Three spellings, one implementation.
    const exports = await runProject([
      ["/scale.hex", scaleModule("three faces")],
      ["/matrix.hex", matrixModule("three faces", DOOR)],
      ["/main.hex", "module Main\n\n" + [
        "// consumer, three faces",
        "import Matrix",
        "import Scale",
        "",
        "let m: Matrix.Matrix = Matrix.Matrix({n = 4.0})",
        "export let qualified: Float = Matrix.scale(m, 2.5).n",
        "export let dotted: Float = m.scale(2.5).n",
        "export let polymorphic: Float = Scale.scaledTwice(m).n",
        "",
      ].join("\n")],
    ]);

    expect(exports["qualified"]).toBe(10);
    expect(exports["dotted"]).toBe(10);
    // `scale(scale(m, 2), 2)` at `Matrix`, every step the member's.
    expect(exports["polymorphic"]).toBe(16);
  });

  test("a consumer's dot call is the door, and the polymorphic call is the member", () => {
    // The two routes distinguished in the emitted text: the dot call rewrites to
    // the companion operation (Modules §5.3's resolution order — exported terms
    // first), while the polymorphic call hands the instance dictionary across.
    const javascript = emitted([
      ["/scale.hex", scaleModule("routes")],
      ["/matrix.hex", matrixModule("routes", DOOR)],
      ["/main.hex", "module Main\n\n" + [
        "// consumer, routes",
        "import Matrix",
        "import Scale",
        "",
        "let m: Matrix.Matrix = Matrix.Matrix({n = 4.0})",
        "export let dotted: Float = m.scale(2.5).n",
        "export let polymorphic: Float = Scale.scaledTwice(m).n",
        "",
      ].join("\n")],
    ], "/main.hex");

    expect(javascript).toContain("const dotted = Matrix.scale(m, 2.5).n;");
    expect(javascript).toContain("const polymorphic = __scaledTwice(m, __Scale_Matrix).n;");
  });
});

describe("`honor` may stand above the declaration it accounts for (§4.7)", () => {
  /**
   * The same module with the two halves swapped: the block first, its `widens`
   * declaration below it. Legal by Declarations Preamble §7.2 — `honor` may
   * precede any declaration it mentions — and the one place in a module where a
   * body reads *downward*: the derived member names a binding written below its
   * own block, which no ordinary member body may do.
   *
   * Pinned behaviourally rather than through a guard. No single line enforces
   * it — what makes it hold is that derived members are checked at the end of
   * the module's items, and that deferral is there for a different measured
   * reason (a failed door must derive nothing). This is the pin that would
   * notice if the property were lost while that reason was served some other
   * way.
   */
  function blockFirst(tag: string): string {
    return [
      `// matrix ${tag}`,
      "import Scale",
      "",
      "export record Matrix = {n: Float}",
      "",
      "honor Scale.Scale<Matrix> =",
      "    scale = widened",
      "",
      DOOR,
      "",
    ].join("\n");
  }

  test("the block above its declaration compiles, and both faces answer", async () => {
    const exports = await runProject([
      ["/scale.hex", scaleModule("block first")],
      ["/matrix.hex", "module Matrix\n\n" + [
        blockFirst("block first"),
        "let two: Int = 2",
        "export let wider: Float = scale(Matrix({n = 4.0}), 0.5).n",
        "export let restricted: Float = Scale.scaledTwice(Matrix({n = 4.0})).n",
        "export let shared: Float = scale(Matrix({n = 4.0}), two).n",
        "",
      ].join("\n")],
    ], { entry: "/matrix.hex" });

    // The wider face, which only the declaration accepts; the member, reached
    // polymorphically from the declaring side; and the shared domain, where the
    // bare spelling is the declaration and both faces agree by construction.
    expect(exports["wider"]).toBe(2);
    expect(exports["restricted"]).toBe(16);
    expect(exports["shared"]).toBe(8);
  });

  test("the derived member is still the declaration restricted, in this order too", () => {
    // The order cannot be allowed to change *what* the member is, only when it
    // is checked: the seat is emitted and the polymorphic route reads it.
    const javascript = emitted([
      ["/scale.hex", scaleModule("block first route")],
      ["/matrix.hex", "module Matrix\n\n" + [
        blockFirst("block first route"),
        "export let restricted: Float = Scale.scaledTwice(Matrix({n = 4.0})).n",
        "",
      ].join("\n")],
    ], "/matrix.hex");

    expect(javascript).toContain("const __Scale_Matrix_scale = ");
    expect(javascript).toContain("scale(value, factor)");
  });
});

describe("a lawful pair's bare in-module use is the export (Constraints §4.6)", () => {
  const bare = [
    "let two: Int = 2",
    "export let wider: Float = scale(Matrix({n = 4.0}), 0.5).n",
    "export let shared: Float = scale(Matrix({n = 4.0}), two).n",
    "",
  ];

  test("both argument shapes compile and answer", async () => {
    // Wider-only (`0.5`, which only the door accepts) and shared-domain (an
    // established `Int`, which both faces accept). A lawful pair holds no
    // rivals, so neither is the two-bindings refusal.
    const exports = await runProject([
      ["/scale.hex", scaleModule("bare use")],
      ["/matrix.hex", matrixModule("bare use", DOOR, ...bare)],
    ], { entry: "/matrix.hex" });

    expect(exports["wider"]).toBe(2);
    expect(exports["shared"]).toBe(8);
  });

  test("the shared-domain call routes to the export, not the member's seat", () => {
    // The pin item 2 of #544 turns on. Both faces answer `8` — that is the
    // behavioural law — so the *route* is the only observable that can say which
    // one the bare spelling meant, and §4.6 says it means the export.
    const javascript = emitted([
      ["/scale.hex", scaleModule("bare route")],
      ["/matrix.hex", matrixModule("bare route", DOOR, ...bare)],
    ], "/matrix.hex");

    expect(javascript).toContain("const shared = scale({ n: 4.0 }, two).n;");
    expect(javascript).toContain("const wider = scale({ n: 4.0 }, 0.5).n;");
    // The instance's member seat exists — it is what the polymorphic route
    // reads — and no bare use calls it.
    expect(javascript).toContain("const __Scale_Matrix_scale = ");
    expect(javascript).not.toContain("__Scale_Matrix_scale(");
    expect(javascript).not.toContain("__Scale_Matrix.scale(");
  });
});

describe("what the law refuses at the same reach (Constraints §4.7)", () => {
  test("an identical signature generalises nothing", () => {
    expect(verdict(
      "identical",
      "widens Scale.scale(value: Matrix, factor: Int): Matrix = " +
        "Matrix({n = value.n * Float.fromInt(factor)})",
    )).toEqual([
      "this declaration does not widen `Scale.scale`: an identical signature " +
        "generalises nothing",
    ]);
  });

  test("a narrowing declaration is refused too — the law widens, never the reverse", () => {
    // The member takes an `Int` factor; this one takes only a `Nat`, so it does
    // not accept every call the member accepts.
    expect(verdict(
      "narrowing",
      "widens Scale.scale(value: Matrix, factor: Nat): Matrix = " +
        "Matrix({n = value.n * Float.fromNat(factor)})",
    )).toEqual([
      "this declaration does not widen `Scale.scale`: `Int` does not reach the " +
        "seat `Nat` exactly",
    ]);
  });

  test("an ordinary export of the spelling is refused, with the rewrite into the form", () => {
    // The claim is unconditional since #546; what a would-have-widened export
    // earns is the mechanical rewrite into the declaration.
    expect(compileFiles([
      ["/scale.hex", scaleModule("export rewrite")],
      ["/matrix.hex", "module Matrix\n\n" + [
        "// export rewrite",
        "import Scale",
        "",
        "export record Matrix = {n: Float}",
        "",
        "export let scale(value: Matrix, factor: Float): Matrix = " +
          "Matrix({n = value.n * factor})",
        "",
        "honor Scale.Scale<Matrix> =",
        "    scale(value, factor) = Matrix({n = value.n * factor})",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "the `Scale.Scale<Matrix>` instance binds `scale`, which is already bound " +
        "(line 8); a member's wider face is declared, not exported — write " +
        "`widens Scale.scale(…)` and account for the member with " +
        "`scale = widened`.",
    ]);
  });
});

describe("where the law is never consulted (Modules §5.3)", () => {
  // #762 retired the other carve this section used to pin: a named import
  // brought a constraint's members into scope as ordinary bindings, so a
  // would-be door collided with the *import item* and earned a hint of its
  // own ("it arrived with `import { Scale }`, and a named constraint import
  // brings its members …"). An import binds a module alias now and nothing
  // smaller (Modules §3.2) — there is no route left by which a member arrives
  // in scope unwritten, so that collision, its hint, and the aliased- and
  // coexisting-alias variants of it have no seat to re-aim at and are gone.
  // What remains is the carve that was never about imports at all: a name
  // already bound, in the plain rebinding form the law never gets asked
  // about.

  test("the declaring module's own spelling is the member's forwarder", () => {
    // Not the exemption's business at all: the spelling is already an ordinary
    // binding — the declaration's exported bare face — so the prior refusal
    // stands unamended, in the plain rebinding form with no law named.
    const diagnostics = compileFiles([["/main.hex", "module Main\n\n" + [
      "// declaring module carve",
      "export constraint Scale<a> =",
      "    scale(value: a, factor: Int): a",
      "",
      "export record Matrix = {n: Float}",
      "",
      "export let scale(value: Matrix, factor: Float): Matrix = " +
        "Matrix({n = value.n * factor})",
      "",
      "honor Scale<Matrix> =",
      "    scale(value, factor) = Matrix({n = value.n * factor})",
      "",
    ].join("\n")]]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scale` is already bound (line 5); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("an ordinary imported term keeps the plain refusal too", () => {
    // Modules §3.2's bare-declaration route (`let scaledTwice = Scale.scaledTwice`)
    // is an ordinary local binding, same as if it had been written out by hand —
    // so its collision with a later export is the plain refusal, with no import
    // machinery anywhere in the message.
    const diagnostics = compileFiles([
      ["/scale.hex", scaleModule("ordinary import")],
      ["/matrix.hex", "module Matrix\n\n" + [
        "// ordinary import",
        "import Scale",
        "",
        "let scaledTwice = Scale.scaledTwice",
        "",
        "export let scaledTwice(n: Int): Int = n",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scaledTwice` is already bound (line 6); Hexagon does not allow " +
        "rebinding — choose a different name.",
    ]);
  });
});
