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
