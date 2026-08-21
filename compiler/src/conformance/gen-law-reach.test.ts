import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for **the generalisation law's reach** — #544; Modules §5.3's
 * reach sentence, Constraints §4.6's boundary paragraph, Modules §3.1's door
 * sentence.
 *
 * The law is **layer-blind**. The two power doors are its first instances, not
 * its extent: what decides where it is writable is the claim's own geography —
 * the exemption amends Constraints §4.6's honor-claim and nothing else, so it is
 * available in any honoring module where the member's spelling is not already an
 * *ordinary* binding. A constraint reached through a namespace import (§3.3)
 * therefore stands exactly as a prelude one does, because that form binds the
 * alias alone and leaves every member spelling free.
 *
 * This file pins that reading at a **user** constraint over a namespace import,
 * where nothing is prelude-gated and every verdict can be shown side by side:
 * the door compiles and all three faces run, a bare in-module use beside the
 * lawful pair resolves to the export at both argument shapes, and the two
 * carves — the declaring module and the named import — keep the prior refusals,
 * the law unconsulted.
 *
 * The behavioural half of the law is what makes the route pins necessary rather
 * than fussy: the door and the member agree on the whole shared domain, by
 * construction here (one implementation, `core`), so no observed *value* can
 * tell which face answered. The emitted JavaScript can.
 */

/** The declaring module: a user constraint with one widenable seat. */
function scaleModule(tag: string): string {
  return [
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
 * The honoring module, in the blessed idiom: one implementation under a private
 * in-module name taking the wide `Float` factor, the door as its thin face, and
 * the member as the same implementation restricted — the `Int` factor reaching
 * the `Float` seat through Numeric Literals §5.1's exact conversion.
 *
 * The door sits on **line 9** of every module this builds, which is the line the
 * refusals below name.
 */
function matrixModule(
  tag: string,
  door: string,
  ...extra: readonly string[]
): string {
  return [
    `// matrix ${tag}`,
    "import * as Scale from \"./scale\"",
    "",
    "export record Matrix = {n: Float}",
    "",
    "// The one implementation. Both faces are this function.",
    "let core(value: Matrix, factor: Float): Matrix = Matrix({n = value.n * factor})",
    "",
    door,
    "",
    "honor Scale.Scale<Matrix> =",
    "    scale(value, factor) = core(value, factor)",
    "",
    ...extra,
  ].join("\n");
}

/** The lawful door: same subject seat, same result, the factor properly wider. */
const DOOR = "export let scale(value: Matrix, factor: Float): Matrix = core(value, factor)";

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
    expect(projectDiagnostics("export let r: Int = noSuchName\n"))
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
      ["/main.hex", [
        "// consumer, three faces",
        "import * as Matrix from \"./matrix\"",
        "import * as Scale from \"./scale\"",
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
      ["/main.hex", [
        "// consumer, routes",
        "import * as Matrix from \"./matrix\"",
        "import * as Scale from \"./scale\"",
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

describe("what the law refuses at the same reach (Constraints §4.6)", () => {
  const refusal = "the `Scale.Scale<Matrix>` instance binds `scale`, which is " +
    "already bound (line 9); an exported binding of a member's spelling is " +
    "legal only when it properly generalises the member (Modules §5.3) — same " +
    "subject seat, same result, at least one remaining seat properly wider — " +
    "so widen it or choose a different name.";

  test("an identical signature generalises nothing", () => {
    expect(verdict(
      "identical",
      "export let scale(value: Matrix, factor: Int): Matrix = " +
        "core(value, Float.fromInt(factor))",
    )).toEqual([refusal]);
  });

  test("a narrowing export is refused too — the law widens, never the reverse", () => {
    // The member takes an `Int` factor; this export takes only a `Nat`, so it
    // does not accept every call the member accepts.
    expect(verdict(
      "narrowing",
      "export let scale(value: Matrix, factor: Nat): Matrix = " +
        "core(value, Float.fromNat(factor))",
    )).toEqual([refusal]);
  });
});

describe("the two carves: where the law is never consulted (Modules §5.3)", () => {
  test("the declaring module's own spelling is the member's forwarder", () => {
    // Not the exemption's business at all: the spelling is already an ordinary
    // binding — the declaration's exported bare face — so the prior refusal
    // stands unamended, in the plain rebinding form with no law named.
    const diagnostics = compileFiles([["/main.hex", [
      "// declaring module carve",
      "export constraint Scale<a> =",
      "    scale(value: a, factor: Int): a",
      "",
      "export record Matrix = {n: Float}",
      "",
      "let core(value: Matrix, factor: Float): Matrix = Matrix({n = value.n * factor})",
      "",
      "export let scale(value: Matrix, factor: Float): Matrix = core(value, factor)",
      "",
      "honor Scale<Matrix> =",
      "    scale(value, factor) = core(value, factor)",
      "",
    ].join("\n")]]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scale` is already bound (line 3); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("a named constraint import brings its members, and the door is that collision", () => {
    // Modules §3.1's family, with the repair taught (#544): the members arrive
    // as ordinary bindings, so the would-be door is an ordinary rebinding — and
    // the prior binding it names is the *import item*, in this module, rather
    // than the member's line in the imported file.
    const diagnostics = compileFiles([
      ["/scale.hex", scaleModule("named import carve")],
      ["/matrix.hex", [
        "// named import carve",
        "import { Scale } from \"./scale\"",
        "",
        "export record Matrix = {n: Float}",
        "",
        "let core(value: Matrix, factor: Float): Matrix = Matrix({n = value.n * factor})",
        "",
        "export let scale(value: Matrix, factor: Float): Matrix = core(value, factor)",
        "",
        "honor Scale<Matrix> =",
        "    scale(value, factor) = core(value, factor)",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scale` is already bound (line 2); it arrived with `import { Scale }`, " +
        "and a named constraint import brings its members — to widen `scale` " +
        "lawfully, import the module instead (`import * as …`), or choose a " +
        "different export name (Modules §5.3's generalisation law).",
    ]);
  });

  test("the hint follows the import item's spelling, aliased or not", () => {
    // §3.2: an alias renames the constraint only, and the members arrive under
    // their declared names — so the repair has to quote the item as written.
    const diagnostics = compileFiles([
      ["/scale.hex", scaleModule("aliased carve")],
      ["/matrix.hex", [
        "// aliased carve",
        "import { Scale as Sizing } from \"./scale\"",
        "",
        "export record Matrix = {n: Float}",
        "",
        "export let scale(value: Matrix, factor: Float): Matrix = value",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scale` is already bound (line 2); it arrived with " +
        "`import { Scale as Sizing }`, and a named constraint import brings its " +
        "members — to widen `scale` lawfully, import the module instead " +
        "(`import * as …`), or choose a different export name (Modules §5.3's " +
        "generalisation law).",
    ]);
  });

  test("a private binding beside an arriving member keeps the plain refusal", () => {
    // The hint is the *door*-builder's: only an exported binding could have been
    // a generalising export, so a private one has nothing to be told about the
    // law and keeps the refusal it always had.
    const diagnostics = compileFiles([
      ["/scale.hex", scaleModule("private beside member")],
      ["/matrix.hex", [
        "// private beside member",
        "import { Scale } from \"./scale\"",
        "",
        "export record Matrix = {n: Float}",
        "",
        "let scale(value: Matrix, factor: Float): Matrix = value",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scale` is already bound (line 3); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("an ordinary imported term keeps the plain refusal too", () => {
    // The hint reads *how the name arrived*, not merely that an import bound it.
    // `scaledTwice` is an ordinary export, so its collision has no door to build
    // and no constraint to re-import.
    const diagnostics = compileFiles([
      ["/scale.hex", scaleModule("ordinary import")],
      ["/matrix.hex", [
        "// ordinary import",
        "import { scaledTwice } from \"./scale\"",
        "",
        "export let scaledTwice(n: Int): Int = n",
        "",
      ].join("\n")],
    ]).diagnostics.map(({ message }) => message);

    expect(diagnostics).toEqual([
      "`scaledTwice` is already bound (line 7); Hexagon does not allow " +
        "rebinding — choose a different name.",
    ]);
  });
});
