import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for Statements §5.1's pending clause: a name whose definition is
 * in progress is reserved against sequential rebinding. The resolver unit
 * tests pin the `let`/`var`/pattern forms without a prelude; these compile the
 * full project because the member case only shows its mainline shape with the
 * prelude present — the member's spelling (`equals`) is then *bound* by the
 * prelude constraint, and the collision must still be attributed to the
 * definition in progress (Constraints §4.6), not to the prelude binding the
 * author cannot see.
 */

function diagnostics(entry: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("the pending clause under a full compile", () => {
  test("the specimen reports once, with the prelude in view", () => {
    expect(diagnostics(
      "let y =\n" +
        "    let y = 5\n" +
        "    y\n",
    )).toEqual([
      "`y` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a member body reserves the member's name past the prelude binding", () => {
    // `equals` is bound here — the prelude constraint exports it — yet the
    // nearest meaning is the member definition in progress, so the member
    // diagnostic wins over rule 1's "already bound (line N of stdlib/Eq.hex)",
    // and the define-anyway recovery keeps the trailing reference from
    // cascading into the member self-reference diagnostic: exactly one error.
    expect(diagnostics(
      "record Odd = {n: Int}\n" +
        "honor Eq<Odd> =\n" +
        "    equals(left, right) =\n" +
        "        let equals = True\n" +
        "        equals\n",
    )).toEqual([
      "`equals` is already being defined by the enclosing member definition " +
        "(line 3); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a module-level binding occluding a prelude name reserves it while pending", () => {
    // `export let show` occludes the prelude's `show` (Modules §5.4), so the
    // spelling's nearest meaning inside the RHS is the definition in progress:
    // the pending diagnostic — line 1 of this file — wins over rule 1's, whose
    // "previous binding" would be a line in stdlib/Show.hex, and the
    // define-anyway recovery keeps the trailing `show` from resolving to the
    // prelude function and manufacturing a phantom type error. Exactly one
    // diagnostic.
    expect(diagnostics(
      "export let show: Int =\n" +
        "    let show = 1\n" +
        "    show\n",
    )).toEqual([
      "`show` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);

    // The `fun` claimant gets the identical treatment — the diagnostic must
    // not turn on the inner binder's keyword.
    expect(diagnostics(
      "export let show: Int =\n" +
        "    fun show(n: Int): Int = n\n" +
        "    show(1)\n",
    )).toEqual([
      "`show` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a var claimant in a member body recovers like a let", () => {
    // Pins the Var site's define-anyway: without it the trailing reference
    // cascades into the Constraints §4.6 own-name diagnostic — two errors for
    // one mistake.
    expect(diagnostics(
      "record Odd = {n: Int}\n" +
        "honor Eq<Odd> =\n" +
        "    equals(left, right) =\n" +
        "        var equals = True\n" +
        "        equals\n",
    )).toEqual([
      "`equals` is already being defined by the enclosing member definition " +
        "(line 3); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a destructuring claimant recovers like a plain let", () => {
    // Pins #claimBinder's claim-despite-the-report: without it the refused
    // names stay undefined and every later reference manufactures a phantom
    // type error against the occluded prelude function.
    expect(diagnostics(
      "export let show: Int =\n" +
        "    let (show, z) = (1, 2)\n" +
        "    show + z\n",
    )).toEqual([
      "`show` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("each nested claimant names its nearest enclosing definition", () => {
    // Pins #findPending's innermost-first scan: reversed, both collisions
    // would blame line 1.
    expect(diagnostics(
      "let y =\n" +
        "    let y =\n" +
        "        let y = 5\n" +
        "        y\n" +
        "    y\n",
    )).toEqual([
      "`y` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
      "`y` is already being defined by the enclosing `let` (line 2); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a plain prelude export as the pending name takes the pending message", () => {
    // Pins the prelude-layer disjunct of the eclipse filter on its own: `map`
    // is a plain (and collided) prelude export, not a constraint member, so
    // only the layer test lets the pending arm past the in-scope hit. Without
    // it this reverts to rule 1 naming a stdlib line plus the collided-export
    // ambiguity refusal on the trailing reference.
    expect(diagnostics(
      "export let map: Int =\n" +
        "    let map = 1\n" +
        "    map\n",
    )).toEqual([
      "`map` is already being defined by the enclosing `let` (line 1); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a module-declared constraint's member body reserves the member's name", () => {
    // Pins the constraint-member disjunct on its own: `describe` is nowhere in
    // the prelude, so only the kind test lets the member arm past the in-scope
    // hit (the declaration's member symbol, owned by the module layer).
    expect(diagnostics(
      "constraint Describe<a> =\n" +
        "    describe(subject: a): String\n" +
        "\n" +
        "honor Describe<Int> =\n" +
        "    describe(n) =\n" +
        "        let describe = \"x\"\n" +
        "        describe\n",
    )).toEqual([
      "`describe` is already being defined by the enclosing member definition " +
        "(line 5); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("a sibling member's spelling is rule 1's collision, not the pending arm's", () => {
    // Pins the member arm's keying on the member *name*, not the symbol kind:
    // `first` is a constraint-member hit inside a member body, but the member
    // being defined is `second`, so the collision belongs to rule 1 and names
    // the declaration line.
    expect(diagnostics(
      "constraint Pair<a> =\n" +
        "    first(subject: a): String\n" +
        "    second(subject: a): String\n" +
        "\n" +
        "honor Pair<Int> =\n" +
        "    first(n) = \"x\"\n" +
        "    second(n) =\n" +
        "        let first = \"y\"\n" +
        "        \"z\"\n",
    )).toEqual([
      "`first` is already bound (line 2); Hexagon does not allow rebinding " +
        "— choose a different name.",
    ]);
  });

  test("a function-local binder still may not occlude a prelude name", () => {
    // No definition of `show` is in progress here, so the prelude collision is
    // genuine and rule 1 keeps it (Modules §5.4: function-local binders
    // occlude nothing) — the constraint-member kind alone must not hand the
    // collision to the pending machinery. The line number belongs to the
    // prelude source, so the assertion stays loose on it.
    const messages = diagnostics(
      "let f(): Int =\n" +
        "    let show = 1\n" +
        "    2\n",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^`show` is already bound \(line \d+\); Hexagon does not allow rebinding — choose a different name\.$/,
    );
  });

  test("a head binder eclipsing the member spelling hands the collision to rule 1", () => {
    // The lambda parameter `equals` legally shadows the pending member name;
    // an inner `let equals` then collides with the *parameter*, and the
    // ordinary rebinding diagnostic names it — not the member definition.
    expect(diagnostics(
      "record Odd = {n: Int}\n" +
        "honor Eq<Odd> =\n" +
        "    equals(left, right) =\n" +
        "        let pick = (equals =>\n" +
        "            let equals = 1\n" +
        "            equals)(left.n)\n" +
        "        pick == pick\n",
    )).toEqual([
      "`equals` is already bound (line 4); Hexagon does not allow rebinding " +
        "— choose a different name.",
    ]);
  });
});
