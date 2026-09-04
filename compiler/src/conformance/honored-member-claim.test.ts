import { describe, expect, test } from "vitest";

import { projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Consequence 3 of #335: **an honored member's spelling is claimed in the
 * honoring module's term space.** A member definition is a module-level
 * binding, Hexagon has no overloading, so an ordinary module-level binding of
 * the same spelling is the rebinding error the language already owns.
 *
 * `show-member-boundary.test.ts` holds the flip of PR α's baseline (the
 * split-spelling defect, both orders). This file holds the rest of the claim's
 * surface — what it reaches beyond an exported `let`, and the two carve-outs
 * that keep it from reaching too far.
 */

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let r: Int = noSuchName\n"))
      .toEqual(["unknown name `noSuchName`"]);
  });
});

describe("what the claim reaches", () => {
  test("a private `let` collides — export status is not what is read", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Int}",
      "",
      "let show(box: Box): String = \"private ${box.value}\"",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
    ].join("\n"))).toEqual([
      "the `Show<Box>` instance binds `show`, which is already bound (line 3); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  /**
   * The claim reads *bindings*, so every module-level binding form is in it,
   * not just `let`. (`var` is absent because a module-level `var` is not a
   * binding form at all — Statements confines it to a function body.)
   */
  test("a `fun` collides, and so does a name a destructuring `let` binds", () => {
    const asFun = projectDiagnostics([
      "export record Box = {value: Int}",
      "",
      "fun show(box: Box): String = \"fun ${box.value}\"",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
    ].join("\n"));
    const asPattern = projectDiagnostics([
      "export record Box = {value: Int} derives (Eq)",
      "",
      "let (compare, other) = (1, 2)",
      "",
      "honor Ord<Box> =",
      "    compare(left, right) = Equal",
      "",
    ].join("\n"));

    expect(asFun).toContain(
      "the `Show<Box>` instance binds `show`, which is already bound (line 3); " +
        "Hexagon does not allow rebinding — choose a different name.",
    );
    expect(asPattern).toContain(
      "the `Ord<Box>` instance binds `compare`, which is already bound (line 3); " +
        "Hexagon does not allow rebinding — choose a different name.",
    );
  });

  /**
   * The claim is the constraint's member list, not the block's. A defaulted
   * member the instance inherits is bound in the honoring module just as much
   * as an overridden one — `notEquals` is a binding of this module whether or
   * not the block writes it — so the `let` below is a rebinding.
   */
  test("a defaulted member the instance never writes is claimed too", () => {
    expect(projectDiagnostics([
      "export record Odd = {n: Int}",
      "",
      "let notEquals(left: Odd, right: Odd): Bool = True",
      "",
      "honor Eq<Odd> =",
      "    equals(left, right) = left.n == right.n",
      "",
    ].join("\n"))).toEqual([
      "the `Eq<Odd>` instance binds `notEquals`, which is already bound (line 3); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  /**
   * `derives` is honoring. The instance a derivation expands to binds the same
   * names a hand-written block would, and the fact that the compiler wrote the
   * bodies changes nothing about the module's term space.
   */
  test("a `derives` clause claims its members", () => {
    expect(projectDiagnostics([
      "export union Colour derives (Eq) =",
      "    | Red",
      "    | Blue",
      "",
      "let equals(left: Colour, right: Colour): Bool = True",
      "",
    ].join("\n"))).toEqual([
      "`equals` is already bound: the `Eq<Colour>` instance binds it as a member " +
        "(line 1); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a derived `Show` claims `show` as a hand-written one does", () => {
    // The binding here is *exported*, and since #546 that changes nothing: the
    // claim is unconditional and the export grammar carries no exemption. A
    // member's wider face is declared, not exported (Constraints §4.7) — and
    // `show` has no remaining seat to widen, so no declaration could exist here.
    expect(projectDiagnostics([
      "export record Point derives (Show) = {x: Int}",
      "",
      "export let show(point: Point): String = \"x=${point.x}\"",
      "",
    ].join("\n"))).toEqual([
      "`show` is already bound: the `Show<Point>` instance binds it as a member " +
        "(line 1); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });
});

describe("what the claim does not reach", () => {
  /**
   * The note's consequence 5, and the carve-out consequence 3 states in the
   * same breath: member definitions from *distinct honor blocks* coexist. One
   * module honoring two constraints that share a member name is legal, and each
   * is selected by qualification or by evidence at the use.
   *
   * It falls out of the claim being read against *bindings*: an honor block
   * binds nothing at module level, so no claim can meet another claim. Measured
   * rather than reasoned, because refusing this program is precisely the way an
   * over-broad claim would fail.
   */
  test("two constraints with one member name, honored at one type", async () => {
    const exports = await runProject([
      ["/loud.hex", "module Loud\n\n" + "export constraint Loud<a> =\n    volume(value: a): Int\n"],
      ["/soft.hex", "module Soft\n\n" + "export constraint Soft<a> =\n    volume(value: a): Int\n"],
      ["/main.hex", "module Main\n\n" + [
        "import Loud",
        "import Soft",
        "",
        "export record Horn = {n: Int}",
        "",
        "honor Loud.Loud<Horn> =",
        "    volume(value) = value.n * 10",
        "",
        "honor Soft.Soft<Horn> =",
        "    volume(value) = value.n",
        "",
        "export let loudly: Int = Loud.volume(Horn({n = 2}))",
        "export let softly: Int = Soft.volume(Horn({n = 2}))",
        "",
      ].join("\n")],
    ]);

    expect(exports.loudly).toBe(20);
    expect(exports.softly).toBe(2);
  });

  /**
   * A declaring module's own declaration is not an honor (note §5 item 4). The
   * spelling a declaration binds is the polymorphic export; a module that both
   * declares and honors holds it twice on purpose, and the claim must not read
   * the declaration's binding as the ordinary one it collides with. Every
   * prelude constraint module would fail to compile otherwise the moment it
   * grew an honor block.
   */
  test("a module may declare a constraint and honor it", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" + [
      "export constraint Describe<a> =",
      "    describe(value: a): String",
      "",
      "export record Metre = {span: Int}",
      "",
      "honor Describe<Metre> =",
      "    describe(value) = \"${value.span}m\"",
      "",
      "export let rendered: String = describe(Metre({span = 5}))",
      "",
    ].join("\n")]]);

    expect(exports.rendered).toBe("5m");
  });

  /**
   * Modules §5.4's layer law is untouched: a module-level binder may occlude a
   * *prelude* name, and honoring nothing at that type leaves nothing to
   * collide with. The claim is about this module's own instances, never about
   * what the prelude exports.
   */
  test("a module-level `let show` with no `Show` instance of its own is fine", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" + [
      "export let show(n: Int): String = \"local ${n}\"",
      "",
      "export let local: String = show(7)",
      "export let prelude: String = Show.show(7)",
      "",
    ].join("\n")]]);

    expect(exports.local).toBe("local 7");
    expect(exports.prelude).toBe("7");
  });

  /**
   * `Rat.hex` is the shape the fold-in produced: five members across three
   * blocks, and module-level helpers (`create`, `reciprocal`) the member bodies
   * call by their bare names. Nothing there is claimed, so nothing there is
   * refused — the claim reaches member *spellings*, not the module's helpers.
   */
  test("helpers a member body calls are ordinary bindings", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" + [
      "export record Ratio = {top: Int, bottom: Int}",
      "",
      "let build(top: Int, bottom: Int): Ratio = Ratio({top = top, bottom = bottom})",
      "",
      "honor Num<Ratio> =",
      "    add(left, right) =",
      "        build(",
      "            left.top * right.bottom + right.top * left.bottom,",
      "            left.bottom * right.bottom",
      "        )",
      "    multiply(left, right) = build(left.top * right.top, left.bottom * right.bottom)",
      "    fromNat(value) = build(value, 1)",
      "",
      "export let summed: Int = (build(1, 2) + build(1, 3)).top",
      "",
    ].join("\n")]]);

    expect(exports.summed).toBe(5);
  });
});
