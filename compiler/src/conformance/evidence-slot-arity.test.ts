/**
 * Conformance for the call site's evidence **arity** (#443): a callee's ABI is
 * one trailing evidence slot per constrained variable, in `dictionaryEntries`'
 * order, and a call supplies exactly that many arguments — however many distinct
 * *values* they end up naming.
 *
 * The defect this pins dead is a deduplication applied to the wrong thing. Call
 * sites keyed their requirements by the type each one resolved to, so a callee
 * with two constrained variables called where both land on one type — `pair<a:
 * Show, b: Show>` at `pair(2, 3)` — was handed a single dictionary against a
 * two-parameter definition. Clean compile, then `TypeError: Cannot read
 * properties of undefined (reading 'show')` on the second slot.
 *
 * The discipline is a common-subexpression elimination's: it collapses
 * computations, never operands. Slots follow the scheme; sharing follows the
 * value. Two slots at one prelude instance is one *name* written twice, and that
 * is the correct emission — so most of these tests read the emitted text, where
 * an argument list that merely runs would not distinguish the two.
 *
 * **Every executed graph is made byte-distinct**, through the `distinct`
 * transform: emitted modules mount as `data:` URLs and the registry caches those
 * by text, so two tests compiling the same program would share one instance.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) {
    throw new Error(
      `no emitted module at ${path}; emitted: ${
        project.modules.map(({ source }) => source.path).join(", ")
      }`,
    );
  }
  return module.javascript.text;
}

const SHOW_PAIR =
  "export let pair<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

const LOCAL_PAIR =
  "module Main\n\n" +
  "let pair<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

/** A type outside Part 8's fundamental set, so no edition can hide the call. */
const POINT =
  "export record Point = {x: Int}\n" +
  "honor Show<Point> =\n" +
  "    show(value) = \"P\"\n";

describe("two constrained variables at one type keep two slots", () => {
  test("the issue's call runs, imported", async () => {
    const exports = await runProject(
      [
        ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
        [
          "/main.hex",
          "module Main\n\n" + 'import Pair\n' +
            "export let answer: String = Pair.pair(2, 3)\n",
        ],
      ],
      { transform: distinct("evidence slot arity: imported pair") },
    );

    expect(exports["answer"]).toBe("23");
  });

  test("the issue's call runs, same module", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        LOCAL_PAIR + "export let answer: String = pair(2, 3)\n",
      ]],
      { transform: distinct("evidence slot arity: local pair") },
    );

    expect(exports["answer"]).toBe("23");
  });

  /**
   * The claim in its own right, at a type Part 8 does not enumerate: no edition
   * exists to route to, so the generic path is what the reader sees, and it
   * carries two arguments naming the one dictionary the instance declares.
   */
  test("the generic path writes the shared dictionary once per slot", () => {
    const javascript = emitted([
      ["/point.hex", "module Point\n\n" + POINT],
      ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
      [
        "/main.hex",
        "module Main\n\n" + 'import Point\n' +
          'import Pair\n' +
          "export let answer: String = Pair.pair(Point.Point({x = 1}), Point.Point({x = 2}))\n",
      ],
    ]);

    expect(javascript).toContain(
      "const answer = __pair({ x: 1 }, { x: 2 }, __Show_Point, __Show_Point);",
    );
  });

  /**
   * Three variables, two of them at one type: the slots stay in the callee's
   * declared order, so the repeated dictionary lands in the first and third and
   * not merely at the end.
   */
  test("three variables keep three slots, in declared order", () => {
    const javascript = emitted([[
      "/main.hex",
      "module Main\n\n" + "let trio<a: Show, b: Show, c: Show>(x: a, y: b, z: c): String =\n" +
        "    show(x) ++ show(y) ++ show(z)\n" +
        'export let answer: String = trio(1, "s", 2)\n',
    ]]);

    expect(javascript).toContain(
      "const trio = (x, y, z, __Show_a, __Show_b, __Show_c) =>",
    );
    expect(javascript).toContain(
      'const answer = trio(1, "s", 2, __Show_Int, __Show_String, __Show_Int);',
    );
  });

  test("three variables run", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + "let trio<a: Show, b: Show, c: Show>(x: a, y: b, z: c): String =\n" +
          "    show(x) ++ show(y) ++ show(z)\n" +
          'export let answer: String = trio(1, "s", 2)\n',
      ]],
      { transform: distinct("evidence slot arity: trio") },
    );

    expect(exports["answer"]).toBe("1s2");
  });

  /**
   * The same collapse, reached through the *sibling* filter rather than through
   * the uniqueness map: `Signed` entails `Num`, so keying by resolved type made
   * the two variables' requirements siblings of each other and dropped the
   * `Num` one — which is a different constraint on a different slot.
   */
  test("distinct constraints on distinct variables are not siblings", () => {
    const javascript = emitted([[
      "/main.hex",
      "module Main\n\n" + "let mix<a: Num, b: Signed>(x: a, y: b): b = y - y\n" +
        "export let answer: Int = mix(1, 2)\n",
    ]]);

    expect(javascript).toContain("const mix = (x, y, __Num_a, __Signed_b) =>");
    expect(javascript).toContain(
      "const answer = mix(1, 2, __Num_Int, __Signed_Int);",
    );
  });

  /**
   * A constrained function referenced as a **value** eta-expands and supplies
   * the evidence inside the wrapper, so it reads the same list and had the same
   * short argument list.
   */
  test("a value reference's wrapper supplies both slots", () => {
    const javascript = emitted([[
      "/main.hex",
      LOCAL_PAIR +
        "let both: (Int, Int) -> String = pair\n" +
        "export let answer: String = both(2, 3)\n",
    ]]);

    expect(javascript).toMatch(
      /const both = \(__arg0, __arg1\) => pair\(__arg0, __arg1, __Show_Int, __Show_Int\);/u,
    );
  });
});

describe("routing, once the arity is right", () => {
  /**
   * `#specializedCallee` refuses a call whose evidence count disagrees with the
   * scheme's, so before the fix these sites fell through to the generic path —
   * the broken one. With two slots supplied the guard is satisfied and the site
   * reaches the edition, which takes no evidence at all.
   */
  test("both variables at one fundamental reach the edition", () => {
    const javascript = emitted([
      ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
      [
        "/main.hex",
        "module Main\n\n" + 'import Pair\n' +
          "export let answer: String = Pair.pair(2, 3)\n",
      ],
    ]);

    expect(javascript).toContain("const answer = pairIntInt(2, 3);");
    expect(javascript).not.toContain("__Show_Int");
  });

  test("the edition it reaches computes the same answer", async () => {
    const exports = await runProject(
      [
        ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
        [
          "/main.hex",
          "module Main\n\n" + 'import Pair\n' +
            "export let cartesian: String = Pair.pair(1, \"x\")\n" +
            "export let repeated: String = Pair.pair(2, 3)\n",
        ],
      ],
      { transform: distinct("evidence slot arity: routed editions") },
    );

    expect(exports["cartesian"]).toBe("1x");
    expect(exports["repeated"]).toBe("23");
  });
});

describe("evidence threaded from an enclosing polymorphic body", () => {
  /**
   * One slot ground and one still a variable was never affected — the two key
   * differently under either rule — and is pinned here as the control the
   * same-type twist below is read against.
   */
  test("one ground slot beside one parameter is unchanged", () => {
    const javascript = emitted([
      ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
      [
        "/main.hex",
        "module Main\n\n" + 'import Pair\n' +
          "export let half<b: Show>(y: b): String = Pair.pair(1, y)\n",
      ],
    ]);

    expect(javascript).toMatch(
      /const half = \(y, (__Show_a)\) => __pair\(1, y, __Show_Int, \1\);/u,
    );
  });

  /**
   * The twist: both of the callee's variables unify with the *caller's* one
   * parameter. Two slots, one name — the sharing is in the value, exactly as it
   * is for a ground instance.
   */
  test("both slots at one caller parameter are two arguments, one name", () => {
    const javascript = emitted([
      ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
      [
        "/main.hex",
        "module Main\n\n" + 'import Pair\n' +
          "export let twin<b: Show>(y: b): String = Pair.pair(y, y)\n",
      ],
    ]);

    expect(javascript).toMatch(
      /const twin = \(y, (__Show_a)\) => __pair\(y, y, \1, \1\);/u,
    );
  });

  test("the threaded shape runs at a caller's chosen type", async () => {
    const exports = await runProject(
      [
        ["/pair.hex", "module Pair\n\n" + SHOW_PAIR],
        [
          "/main.hex",
          "module Main\n\n" + 'import Pair\n' +
            "let twin<b: Show>(y: b): String = Pair.pair(y, y)\n" +
            'export let answer: String = twin("q")\n',
        ],
      ],
      { transform: distinct("evidence slot arity: threaded twin") },
    );

    expect(exports["answer"]).toBe("qq");
  });
});

describe("what must not change", () => {
  /**
   * Several constraints on **one** variable are a different axis: their slots
   * are ordered among themselves (FFI Part 9 §6.2) and the redundant ones are
   * eliminated. Pinned as an exact emission, since the change here rewrites the
   * key both of those decisions are made under.
   */
  test("conjuncts on one variable keep their own slots and order", () => {
    const javascript = emitted([[
      "/main.hex",
      "module Main\n\n" + "let twice<a: (Num, Show)>(x: a): String = show(x + x)\n" +
        "export let answer: String = twice(2)\n",
    ]]);

    expect(javascript).toContain(
      "const twice = (x, __Num_a, __Show_a) => show(__Num_a.add(x, x), __Show_a);",
    );
    expect(javascript).toContain(
      "const answer = twice(2, __Num_Int, __Show_Int);",
    );
  });

  test("a redundant sibling on one variable is still eliminated", () => {
    // Defect 16: the body accumulates `Num` beside the `Signed` that entails
    // it, and the definition declares a parameter only for the maximal one.
    const javascript = emitted([[
      "/main.hex",
      "module Main\n\n" + "let negate(a) = 0 - a\n" + "export let answer: Int = negate(5)\n",
    ]]);

    expect(javascript).toContain("const negate = (a, __Signed_a) =>");
    expect(javascript).toContain("const answer = negate(5, __Signed_Int);");
  });

  test("two variables at two types are unchanged", () => {
    const javascript = emitted([[
      "/main.hex",
      LOCAL_PAIR + 'export let answer: String = pair(1, "x")\n',
    ]]);

    expect(javascript).toContain(
      "const answer = pair(1, \"x\", __Show_Int, __Show_String);",
    );
  });

  test("a fully polymorphic call passes its caller's parameters through", () => {
    const javascript = emitted([[
      "/main.hex",
      LOCAL_PAIR +
        "export let relay<c: Show, d: Show>(u: c, v: d): String = pair(u, v)\n",
    ]]);

    expect(javascript).toMatch(
      /const relay = \(u, v, (__Show_a), (__Show_b)\) => pair\(u, v, \1, \2\);/u,
    );
  });
});
