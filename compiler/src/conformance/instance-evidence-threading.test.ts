import { describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

/**
 * Evidence threads through parameterized instances and copied defaults (#271).
 *
 * The defect's whole signature was a clean compile followed by a `TypeError`
 * at module load: a non-rigid `honor` binder (or constraint subject) let a
 * match pattern's fresh variable become its class representative, and the
 * first concrete use then bound the shared subject to its own type. The
 * emitter tests pin the corrected evidence text; these run the emitted module,
 * because text pins catch that failure class only by proxy.
 *
 * Both specimens were verified against `main` before the fix: each compiled
 * with zero diagnostics, and the first threw
 * `TypeError: __dictDescribe_140.describe is not a function` at import.
 */

describe("instance evidence threads at runtime", () => {
  test("a recursive parameterized instance runs", async () => {
    const exports = await runMain("module Main\n\n" + "constraint Describe<a> =\n" +
        "    describe(value: a): String\n" +
        "honor Describe<Int> =\n" +
        '    describe(value) = "${value}"\n' +
        "union Tree(a) = Leaf | Node(left: Tree(a), item: a, right: Tree(a))\n" +
        "honor<a: Describe> Describe<Tree(a)> =\n" +
        "    describe(tree) = match tree\n" +
        '        Leaf => "leaf"\n' +
        // Constraints §4.6: the member's own name is refused in its own body,
        // and the dot call is the ruled rewrite. `left`/`right` dispatch through
        // this instance under construction; `item: a` through the binder.
        '        Node(left, item, right) => "(${left.describe()} ${item.describe()} ${right.describe()})"\n' +
        "let tree: Tree(Int) = Node(Leaf, 1, Leaf)\n" +
        "export let text: String = describe(tree)",
    );
    expect(exports.text).toBe("(leaf 1 leaf)");
  });

  test("copied defaults run against their own instance", async () => {
    const exports = await runMain("module Main\n\n" + "union Held(a) = Missing | Held2(value: a)\n" +
        "constraint Pick<a> =\n" +
        "    pick(value: a): a\n" +
        "    pickHeld(fallback: a, held: Held(a)): a = match held\n" +
        "        Missing => fallback\n" +
        "        Held2(value) => pick(value)\n" +
        "honor Pick<Int> =\n" +
        "    pick(value) = value\n" +
        "honor Pick<String> =\n" +
        "    pick(value) = value\n" +
        "export let picked: Int = pickHeld(0, Held2(42))\n" +
        'export let name: String = pickHeld("x", Held2("y"))',
    );
    expect([exports.picked, exports.name]).toEqual([42, "y"]);
  });
});
