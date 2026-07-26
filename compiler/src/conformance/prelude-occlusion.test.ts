import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the prelude occlusion rule (Modules §5.4;
 * `spec/notes/compiler-conformance-defects.md` defect 9).
 *
 * §5.4 is layered, and both halves are normative:
 *
 * - A **module-level** `let`/`fun` **may occlude a prelude name** — the local one
 *   wins unqualified module-wide, and the prelude's stays reachable qualified.
 * - A **function-local** binder may occlude **nothing**, prelude included. Inside
 *   a function body the rebinding ban is absolute and layer-blind.
 *
 * The section exists precisely so that adding a name to the prelude cannot break
 * a program already using it: "Without occlusion, every addition to the prelude
 * in a future release would break any program already using that name."
 *
 * That guarantee had never been exercised for *value* names. The shipped prelude
 * exports `Ordering`/`Option`/`Result` and their capitalized constructors only,
 * so no lowercase prelude binding existed for a module-level `let` to occlude.
 * `stdlib/Seq.hex` is the first prelude module that will export lowercase names
 * (`empty`, `map`, `filter`, `fold`, …), which is how the defect surfaced.
 *
 * These tests substitute their own prelude member rather than waiting for `Seq`
 * to join the set, so the rule is pinned independently of that migration.
 */

/** `Result.hex` supplied by the project — the injected fallback then stands down. */
const RESULT_WITH_VALUE = [
  "/Result.hex",
  "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
  "export let combine(left: Int, right: Int): Int = left + right\n" +
  "export let tally: Int = 0\n",
] as const;

function diagnostics(entry: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(1), RESULT_WITH_VALUE[0], RESULT_WITH_VALUE[1]),
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("a module-level binder may occlude a prelude value", () => {
  test("`let` occludes, and the local binding is what the module sees", () => {
    // Before the fix this reported "`tally` is already bound", because the
    // module-level `let` path looked the name up through the prelude layer
    // instead of stopping at the module's own.
    expect(diagnostics(
      "export let tally: String = \"mine\"\n" +
      "export let use: String = tally\n",
    )).toEqual([]);
  });

  test("`fun` occludes too (the half that already worked)", () => {
    expect(diagnostics(
      "export fun combine(left: String, right: String): String = left ++ right\n" +
      "export let use: String = combine(\"a\", \"b\")\n",
    )).toEqual([]);
  });

  test("an occluding `let` wins over the prelude at its own type", () => {
    // The discriminator: if the prelude binding were still winning, `use` would
    // be `Int` and this annotation would fail.
    expect(diagnostics(
      "export let combine: String = \"not a function\"\n" +
      "export let use: String = combine\n",
    )).toEqual([]);
  });

  test("a module that does not occlude still sees the prelude value", () => {
    expect(diagnostics("export let three: Int = combine(1, 2)\n")).toEqual([]);
  });
});

describe("a function-local binder may occlude nothing", () => {
  test("a local `let` over a prelude name is still a hard error", () => {
    expect(diagnostics(
      "export fun use(): Int =\n" +
      "    let combine = 1\n" +
      "    combine\n",
    )).not.toEqual([]);
  });

  test("a local `let` over a *module* name is still a hard error", () => {
    // The layer-blind half of the ban, unchanged: this never involved the
    // prelude, and must not have been loosened by the fix.
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "export fun use(): Int =\n" +
      "    let mine = 2\n" +
      "    mine\n",
    )).not.toEqual([]);
  });

  test("two module-level bindings of the same name are still a hard error", () => {
    // The fix narrows *which layer* is consulted, not whether the ban applies
    // within a layer.
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "let mine: Int = 2\n" +
      "export let use: Int = mine\n",
    )).not.toEqual([]);
  });
});

describe("`module level` is scope identity, not nesting depth (PR #89 finding F1)", () => {
  // The first fix gated on lambda depth. A block body of a module-level `let`
  // runs at depth 0 and yet is an inner layer, so that gate licensed shadowing
  // there — silently, and as a regression against the pre-fix compiler, which
  // rejected both of these. The predicate is now the identity of the one scope
  // whose parent is the prelude layer.

  test("a block at module init may not shadow a module binding", () => {
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "export let use: Int =\n" +
      "    let mine = 2\n" +
      "    mine\n",
    )).not.toEqual([]);
  });

  test("a block at module init may not shadow a prelude value", () => {
    expect(diagnostics(
      "export let use: Int =\n" +
      "    let tally = 2\n" +
      "    tally\n",
    )).not.toEqual([]);
  });

  test("the module-level occlusion it must not disturb still works", () => {
    // Guards the trade the first fix made: closing the hole must not reopen
    // defect 9. This and the two above have to pass *together*.
    expect(diagnostics(
      "export let tally: String = \"mine\"\n" +
      "export let use: String = tally\n",
    )).toEqual([]);
  });
});
