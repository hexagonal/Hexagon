import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * The vector pattern at Pattern Matching §1's `let` position — the fifth seat,
 * and the one it could not reach (#603).
 *
 * Two defects met here, opposite in direction. The **parser** never listed `[`
 * among the tokens that open a pattern binding, so `let [...all] = xs` — which
 * Collections Part 3 §3.4 spells out as legal — died at "`let` requires a
 * non-uppercase-start name", and so did the refutable form whose §5.3 gate the
 * same section mandates. Conservative: nothing unsound, a mandated form that did
 * not exist. The **emitter** answered a vector pattern with the empty
 * destructuring string, which on the `let` path means "binds nothing": three
 * routes already reached it without the blocked opener — a pattern *parameter*
 * (lowered to this same item), a vector nested in a record pattern, and one
 * nested in a tuple pattern — and each compiled clean and ran with its binders
 * unbound. Unsound, and live before the parser was touched.
 *
 * What is pinned here is the seat, end to end: that both of §3.4's examples
 * parse, that the gate answers them, that §3.6's shape is what the `let` path
 * emits, that every route through it binds what the pattern says at runtime, and
 * that the binders are Statements §5.4's sequential ones.
 *
 * Emission shapes for the *other* four positions live in
 * `vector-trie-wiring.test.ts` §3.6; the coverage matrix that decides
 * refutability lives in `pattern-usefulness-matrix.test.ts`.
 */

/** `/main.hex`'s emitted JavaScript for a one-module program that compiles clean. */
function mainJavaScript(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (module === undefined) throw new Error("/main.hex was not emitted");
  return module.javascript.text;
}

/** A vector export, read through the iterator every vector value carries. */
function elements(value: unknown): readonly unknown[] {
  return [...(value as Iterable<unknown>)];
}

describe("§3.4's verdicts, at the position that could not reach them", () => {
  /**
   * The legal one. §3.4: "OK (legal, pointless, and the checker doesn't judge)"
   * — `[...rest]` matches every length, so it is irrefutable and the gate has
   * nothing to say.
   */
  test("`let [...all] = xs` is accepted", () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let size: Int = Vector.length(all)\n",
    )).toEqual([]);
  });

  /**
   * The refutable one, drawing Pattern Matching §5.3's uniform message with
   * §7.3's witness — `[]`, the length the pattern misses, which is #600's
   * matrix column answering at a position it had never been asked from. The
   * checker needed no work for this: the gate is matrix-generic, and the arm,
   * loop-head and lambda seats were already answering it.
   */
  test("`let [x, ...rest] = xs` draws the gate with the `[]` witness", () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [x, ...rest] = xs\n" +
        "export let first: Int = x\n",
    )).toEqual(["this pattern can fail: `[]`; use `match`"]);
  });

  /** Every other length-fixing form is refused the same way, witness and all. */
  test("a fixed-length pattern and the empty pattern are both refused", () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2]\n" +
        "let [a, b] = xs\n" +
        "export let sum: Int = a + b\n",
    )).toEqual(["this pattern can fail: `[]`; use `match`"]);
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2]\n" +
        "let [] = xs\n" +
        "export let ok: Int = 1\n",
    )).toEqual(["this pattern can fail: `[_]`; use `match`"]);
  });

  /** §3.2: the rest binder's type is `Vector(t)`, inferred at this seat too. */
  test("the rest binder gets `Vector(t)` under inference", () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(String) = [\"a\"]\n" +
        "let [...all] = xs\n" +
        "export let copy: Vector(String) = all\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(String) = [\"a\"]\n" +
        "let [...all] = xs\n" +
        "export let wrong: Int = all\n",
    )).toEqual(["type mismatch: expected Int, found Vector(String)"]);
  });
});

describe("§3.6's shape, on the `let` path", () => {
  /**
   * A rest binder is a slice (§3.5), and the window runs to the size. The
   * subject is the binding's own right-hand side rather than a temporary: it is
   * already a bare reference, so repeating it costs nothing and reads as §3.6
   * writes it.
   */
  test("a named rest emits one slice over the whole subject", () => {
    const javascript = mainJavaScript(
      "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let size: Int = Vector.length(all)\n",
    );
    expect(javascript).toContain("const all = __trieSlice(xs, 0, __trieSize(xs));");
  });

  /**
   * §5.3's gate has already refused every refutable pattern here, so the plan's
   * length test would be a test that cannot fail. Emitting it would wrap the
   * binding group in an `if` the binders would then have to escape.
   */
  test("no length test is emitted at this seat", () => {
    const javascript = mainJavaScript(
      "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let size: Int = Vector.length(all)\n",
    );
    expect(javascript).not.toMatch(/if \(/u);
    expect(javascript).not.toMatch(/__trieSize\(xs\) [>=]/u);
    // The binding is the whole of what the pattern emits, at module top level.
    expect(javascript).toMatch(
      /const xs = .*;\nconst all = __trieSlice\(xs, 0, __trieSize\(xs\)\);\n/u,
    );
  });

  /** An anonymous rest binds nothing, so it must not pay §3.5's slice. */
  test("an anonymous rest emits no slice", () => {
    const javascript = mainJavaScript(
      "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...] = xs\n" +
        "export let ok: Int = 1\n",
    );
    expect(javascript).not.toContain("__trieSlice");
    expect(javascript).not.toContain("__trieGet");
  });

  /**
   * And neither does a nested one — which is the case that shows the vector is
   * planned rather than destructured: the tuple shell keeps its indexed read,
   * the vector slot contributes nothing at all, and `size` never joins the
   * module's runtime import list for an operation nothing calls.
   */
  test("a nested anonymous rest contributes nothing to the binding group", () => {
    const javascript = mainJavaScript(
      "let p: (Int, Vector(Int)) = (1, [2, 3])\n" +
        "let (a, [...]) = p\n" +
        "export let head: Int = a\n",
    );
    expect(javascript).toContain("const a = p[0];");
    expect(javascript).not.toContain("__trieSlice");
    expect(javascript).not.toContain("__trieSize");
  });

  /**
   * The shells above a vector leaf are read as *paths* into the subject rather
   * than destructured separately, so the whole binding group stays one flat run
   * of `const`s.
   */
  test("record and tuple shells become paths into the subject", () => {
    expect(mainJavaScript(
      "let basket: {items: Vector(Int)} = {items = [1, 2]}\n" +
        "let {items = [...all]} = basket\n" +
        "export let size: Int = Vector.length(all)\n",
    )).toContain("const all = __trieSlice(basket.items, 0, __trieSize(basket.items));");
    expect(mainJavaScript(
      "let p: (Int, Vector(Int)) = (1, [2, 3])\n" +
        "let (a, [...all]) = p\n" +
        "export let size: Int = a + Vector.length(all)\n",
    )).toContain("const all = __trieSlice(p[1], 0, __trieSize(p[1]));");
  });

  /**
   * §3.6's shape names the subject once per read and once per `__trieSize`, so a
   * right-hand side that is not already a bare reference is bound first — a
   * pattern must not evaluate the thing it destructures more than once.
   */
  test("a computed right-hand side is evaluated once, into a binding", () => {
    const javascript = mainJavaScript(
      "fun build(): Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = build()\n" +
        "export let size: Int = Vector.length(all)\n",
    );
    expect(javascript).toContain("const __subject = build();");
    expect(javascript).toContain("const all = __trieSlice(__subject, 0, __trieSize(__subject));");
    // Once, at the binding: `build()` occurs in the declaration it names and in
    // the one call, and nowhere a slot read or a `__trieSize` could repeat it.
    expect(javascript.match(/build\(\)/gu)).toHaveLength(2);
    expect(javascript).toContain("function build()");
  });

  /**
   * A pattern with no vector in it keeps the JS destructuring it has always
   * emitted. The plan is the vector's route, not a replacement for the other
   * one — this file's siblings pin that rendering in quantity.
   */
  test("a vector-free pattern still destructures", () => {
    expect(mainJavaScript(
      "let p: (Int, Int) = (1, 2)\n" +
        "let (a, b) = p\n" +
        "export let sum: Int = a + b\n",
    )).toContain("const [a, b] = p;");
  });
});

describe("every route into `let`-pattern emission binds what the pattern says", () => {
  /**
   * Every route into this item, three of which were reachable on `main` before
   * the parser was touched: the pattern parameter, the record-nested vector and
   * the tuple-nested one. Each compiled without a diagnostic and emitted
   * JavaScript whose binders did not exist — `all` resolved to nothing, or to
   * whatever an enclosing scope happened to call `all`. With the emitter's plan
   * route removed, every test here throws a `ReferenceError` rather than failing
   * an assertion, which is how they were checked to fail before the fix.
   */
  test("the direct binding, the parser's new route", async () => {
    const main = await runMain("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(elements(main["copy"])).toEqual([1, 2, 3]);
  });

  test("a pattern parameter, which lowers to this same item", async () => {
    const main = await runMain("module Main\n\n" + "fun identity([...all]: Vector(Int)): Vector(Int) = all\n" +
        "export let copy: Vector(Int) = identity([4, 5, 6])\n",
    );
    expect(elements(main["copy"])).toEqual([4, 5, 6]);
  });

  test("a lambda parameter", async () => {
    const main = await runMain("module Main\n\n" + "let size: (Vector(Int)) -> Int = ([...all]) => Vector.length(all)\n" +
        "export let n: Int = size([7, 8])\n",
    );
    expect(main["n"]).toBe(2);
  });

  test("a vector nested in a record pattern", async () => {
    const main = await runMain("module Main\n\n" + "let basket: {label: String, items: Vector(Int)} = " +
        "{label = \"b\", items = [1, 2]}\n" +
        "let {label, items = [...all]} = basket\n" +
        "export let name: String = label\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(main["name"]).toBe("b");
    expect(elements(main["copy"])).toEqual([1, 2]);
  });

  test("a vector nested in a tuple pattern", async () => {
    const main = await runMain("module Main\n\n" + "let p: (Int, Vector(Int)) = (1, [2, 3])\n" +
        "let (a, [...all]) = p\n" +
        "export let head: Int = a\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(main["head"]).toBe(1);
    expect(elements(main["copy"])).toEqual([2, 3]);
  });

  /** A nominal record's constructor pattern erases (#591), and the leaf still binds. */
  test("a vector under a nominal record constructor pattern", async () => {
    const main = await runMain("module Main\n\n" + "record Basket = {items: Vector(Int)}\n" +
        "let basket: Basket = Basket({items = [9]})\n" +
        "let Basket({items = [...all]}) = basket\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(elements(main["copy"])).toEqual([9]);
  });

  /** An as-pattern names the whole value; the vector under it still binds. */
  test("an as-pattern over a vector binds both names", async () => {
    const main = await runMain("module Main\n\n" + "let xs: Vector(Int) = [1, 2]\n" +
        "let [...all] as whole = xs\n" +
        "export let copy: Vector(Int) = all\n" +
        "export let same: Vector(Int) = whole\n",
    );
    expect(elements(main["copy"])).toEqual([1, 2]);
    expect(elements(main["same"])).toEqual([1, 2]);
  });

  /** Inside a function body, where the item is a block item rather than a module one. */
  test("a block-level binding", async () => {
    const main = await runMain("module Main\n\n" + "export fun size(xs: Vector(Int)): Int =\n" +
        "    let [...all] = xs\n" +
        "    Vector.length(all)\n" +
        "export let n: Int = size([1, 2, 3, 4])\n",
    );
    expect(main["n"]).toBe(4);
  });

  /**
   * At a size that crosses the trie's 32-branch factor, so the slice is a real
   * trie operation rather than a one-node special case (§4).
   */
  test("the slice is a real trie slice at scale", async () => {
    const main = await runMain("module Main\n\n" + "fun build(n: Int): Vector(Int) =\n" +
        "    var acc: Vector(Int) = []\n" +
        "    for i in 1..n\n" +
        "        acc := acc.append(i)\n" +
        "    acc\n" +
        "let [...all] = build(100)\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(elements(main["copy"])).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });
});

describe("the binders are sequential (Statements §5.4)", () => {
  /**
   * Binder class is positional, and `let` is the sequential position — for every
   * name the pattern binds, the vector pattern's rest binder included
   * (Collections Part 3 §3, Statements §5.4).
   */
  test("a rest binder may not reuse a name already bound in the block", () => {
    expect(projectDiagnostics("module Main\n\n" + "let all: Int = 1\n" +
        "let xs: Vector(Int) = [1, 2]\n" +
        "let [...all] = xs\n" +
        "export let n: Int = 2\n",
    )).toEqual([
      "`all` is already bound (line 3); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  /**
   * The one exemption: a sequential binder may shadow a **prelude** name
   * (Modules §5.4). `all` is the prelude's `Seq.all`, and the misparse this arc
   * removed used to resolve `[...all]` as an *expression* naming exactly that —
   * the incidental proof that the shadow is what the source means.
   */
  test("a rest binder may shadow a prelude name, and then means the binding", async () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let n: Int = Vector.length(all)\n",
    )).toEqual([]);
    const main = await runMain("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let [...all] = xs\n" +
        "export let copy: Vector(Int) = all\n",
    );
    expect(elements(main["copy"])).toEqual([1, 2, 3]);
  });

  /**
   * Shadowing the prelude reserves the name for the whole enclosing scope, so
   * the prelude's own `all` is not reachable *above* the binding either — the
   * occlusion half of the same rule, which a pattern binder inherits like any
   * other sequential one.
   */
  test("the shadowed prelude name is occluded for the whole scope", () => {
    expect(projectDiagnostics("module Main\n\n" + "let xs: Vector(Int) = [1, 2, 3]\n" +
        "let positive: Bool = all(xs.toSeq(), x => x > 0)\n" +
        "let [...all] = xs\n" +
        "export let flag: Bool = positive\n",
    )).toEqual([
      "`all` is declared later in this block; declarations are read top-down — " +
        "move its declaration above this use",
    ]);
  });
});
