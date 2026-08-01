import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { runMain } from "../support/test-project.js";
import type * as Typed from "../syntax/typed/index.js";

/**
 * Conformance for Step 1 of the #205 ruling (closure doc
 * `spec/decisions-ml-dialect-generalization-2026-08.md` §2, §11.1): Functions
 * §8.2's syntactic-value list gains a reference — possibly module-qualified —
 * to an immutable term binding, and a record literal whose field values are
 * values.
 *
 * Every test here is an item §11.1 named as an assumption the ruling declined
 * to make about the shipped checker. Items (vii) onward belong to Step 2 and
 * live in `relaxed-generalization.test.ts`.
 */

function project(files: Readonly<Record<string, string>>) {
  return compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
}

function diagnostics(source: string): readonly string[] {
  return project({ "/main.hex": source }).diagnostics.map(({ message }) => message);
}

function scheme(source: string, name: string): Typed.Scheme {
  const compiled = project({ "/main.hex": source });
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return schemeOf(compiled, "/main.hex", name);
}

function schemeOf(
  compiled: ReturnType<typeof project>,
  path: string,
  name: string,
): Typed.Scheme {
  const typed = compiled.modules.find((module) => module.source.path === path)!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.kind !== "parameter",
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\` in ${path}`);
  return symbol.scheme;
}

describe("Step 1: the completed syntactic-value list", () => {
  // (i) The motivating snippets. This is the program §1.1 calls the acceptance
  // test — the shape a JavaScript developer writes on day one.
  test("(i) a reference to an immutable binding generalizes: the empty-sequence program", () => {
    expect(
      diagnostics(
        "let e = empty\n" +
          "export let ys: Seq(Int) = cons(42, e)\n" +
          'export let xs: Seq(String) = cons("Briar", e)\n',
      ),
    ).toEqual([]);
  });

  test("(i) the same program without Step 1 would have collapsed: `e` is polymorphic", () => {
    expect(scheme("let e = empty\nexport let n: Int = 1\n", "e").variables.length).toBe(1);
  });

  // (ii) "Possibly module-qualified" is load-bearing: SML's non-expansive
  // category is the *long* identifier (§2.1).
  test("(ii) a module-qualified reference is a value too", () => {
    const compiled = project({
      "/lib.hex": "export let empty: Seq(a) = Seq.empty\n",
      "/main.hex":
        'import * as Lib from "./lib.hex"\n' +
        "let e = Lib.empty\n" +
        "export let ys: Seq(Int) = cons(42, e)\n" +
        'export let xs: Seq(String) = cons("Briar", e)\n',
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(schemeOf(compiled, "/main.hex", "e").variables.length).toBe(1);
  });

  // (iii) §2.5's composition, confirmed rather than decided: the annotation
  // makes `a` rigid while the right-hand side is checked, and quantification
  // happens after, at the binding (Functions §4.1, §4.2.1).
  test("(iii) an annotated reference generalizes for the same reason the bare one does", () => {
    const compiled = project({
      "/main.hex":
        "let e: Seq(a) = empty\n" +
        "export let ys: Seq(Int) = cons(42, e)\n" +
        'export let xs: Seq(String) = cons("Briar", e)\n',
    });
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(schemeOf(compiled, "/main.hex", "e").variables.length).toBe(1);
  });

  // (iv) The record repair. §2.4 declined to assert whether the shipped checker
  // already conformed to the repaired list; these two pin it. It did — the
  // written list omitted what the implementation had all along, which is why
  // `Seq.hex`'s own `empty` compiled.
  test("(iv) a bare record literal of values is a value", () => {
    expect(scheme("let r = { pull = () => None }\n", "r").variables.length).toBe(1);
  });

  test("(iv) a constructor applied to a record literal is a value", () => {
    // `Seq.hex`'s own shape — `export let empty: Seq(a) = Seq({ pull = ... })` —
    // written against a local declaration, since an opaque record keeps its
    // constructor to its home module.
    expect(
      scheme(
        "record Box(a) = { pull: () -> Option(a) }\n" +
          "let s = Box({ pull = () => None })\n",
        "s",
      ).variables.length,
    ).toBe(1);
  });

  test("(iv) a record literal with a computed field is not a value", () => {
    // The recursive condition, same as tuples: field values must be values. The
    // observable has to be a variable item 7 also declines, or Step 2 would
    // generalize the binding anyway and hide the answer: `a -> a` is invariant.
    expect(
      scheme(
        "fun make<a>(): (a -> a) = (x) => x\nlet r = { apply = make() }\n",
        "r",
      ).variables.length,
    ).toBe(0);
    // The control: the same shape with a value field does generalize.
    expect(
      scheme("let r = { apply = (x) => x }\n", "r").variables.length,
    ).toBe(1);
  });

  // (v) The levels guard. The value restriction guards allocation; levels guard
  // sharing, and a reference allocates nothing (§2.2). A parameter's variable
  // belongs to the environment, so a `let` aliasing it quantifies nothing.
  test("(v) a `let` aliasing a lambda parameter quantifies nothing", () => {
    expect(
      diagnostics(
        "let use = (x) =>\n" +
          "    let e = x\n" +
          "    (e, e)\n" +
          "export let pair: (Int, Int) = use(1)\n",
      ),
    ).toEqual([]);
    // If `e` had been quantified, this would type-check; the parameter is one
    // type per call, so it must not.
    expect(
      diagnostics(
        "let use = (x) =>\n" +
          "    let e = x\n" +
          '    (e(1), e("a"))\n',
      ).length,
    ).toBeGreaterThan(0);
  });

  test("(v) a destructured lambda parameter keeps its row shared with the body", () => {
    // The same guard one step in: `{x} => x` desugars to a pattern `let` whose
    // right-hand side is a reference (Step 1's new row), so the field variable
    // must sink to the parameter's level rather than be quantified.
    const type = scheme("let getX = {x} => x\nexport let n: Int = getX({x = 1})\n", "getX").type;
    expect(type.kind).toBe("Function");
    if (type.kind !== "Function") return;
    expect(type.result).toEqual(
      (type.parameters[0] as Extract<Typed.Type, { kind: "Record" }>).fields[0]!.type,
    );
  });

  // (vi) A constrained alias shares the *unapplied* entity, so no evidence is
  // discharged at the binding and the two uses elaborate independently (§2.2).
  test("(vi) a constrained alias stays usable at two representations", () => {
    // Deliberately not `let x = 42; let y = x`, which was this test's first
    // shape. A *literal's* variable is settled at its own binding by Numeric
    // Literals §4 — `x : Int`, not `Num a => a` — so no alias of it is ever
    // constrained, and the two uses below would compile through numeric widening
    // (`const asBig = BigInt(y)`) in a checker that had never heard of item (vi).
    // The constraint has to come from a declared parameter to survive the
    // binding, and the chain has to be two links deep to observe that the alias
    // rule composes rather than firing once.
    const source = "fun double<a: Num>(value: a): a = value + value\n" +
      "let x = double\n" +
      "let y = x\n" +
      "export let i: Int = y(21)\n" +
      "export let f: Float = y(1.5)\n";
    expect(diagnostics(source)).toEqual([]);
    const aliased = scheme(source, "y");
    expect(aliased.variables).toHaveLength(1);
    expect(aliased.constraints.map(({ name }) => name)).toEqual(["Num"]);
  });

  test("(vi) the aliased constrained function is aliased, not discharged", async () => {
    // §2.2's other half: `let g = f` aliases the evidence-suffix-taking function
    // value, so the alias is "exactly as polymorphic, and exactly as cheap, as
    // the original". Emitting a wrapper of the unsuffixed arity instead built a
    // function that dropped its caller's dictionary — a clean compile and an
    // `undefined` at the first operation.
    const source = "fun double<a: Num>(value: a): a = value + value\n" +
      "let twice = double\n" +
      "export let i: Int = twice(21)\n" +
      "export let f: Float = twice(1.5)\n";
    const exports = await runMain(source);
    expect(exports.i).toBe(42);
    expect(exports.f).toBe(3);
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("const twice = double;");
  });

  // (x) The evidence-seat battery (closure doc §13.6, §11.1 item (x)).
  //
  // This replaces the round-2 test that stood here. That test asserted `missing
  // \`Tag\` evidence during JavaScript emission` as *expected output* for the
  // record specimen — a regression pinned as intent. Step 1 made a reference to
  // a constrained function a value, so a record, tuple, or constructor
  // application holding one became a value too, generalized into a **constrained
  // non-function scheme**, and hit a wall: evidence rides a function's trailing
  // parameter suffix (Constraints §6.1) and a record has no arity to put one on.
  // All three shapes compile on `main` — where the *contents* were not values —
  // so all three were regressions this branch introduced. §13.6 declines a
  // still-constrained variable at any non-function value binding, so the scheme
  // is never built.
  //
  // Every specimen uses `Tag`, which defaulting cannot settle. Under `Num` the
  // variable is gone before any of this is observable (§2a of the arc's notes,
  // and three false results that came of ignoring it).
  const TAG = "constraint Tag<a> =\n" +
    "    label(value: a): String\n" +
    "honor Tag<String> =\n" +
    '    label(value) = "string"\n' +
    "fun describe<a: Tag>(value: a): String = label(value)\n";

  test("(x) a record literal holding a constrained reference compiles, and pins", () => {
    const source = TAG +
      "let holder = { f = describe }\n" +
      'export let s: String = (holder.f)("x")\n';
    expect(diagnostics(source)).toEqual([]);
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    // `main`'s emission, exactly: the use pinned `a` to `String`, the evidence
    // went concrete, and the field holds the eta-expansion. Never the bare
    // `{ f: describe }` — that is the *binding*-position shape (§13.3), and a
    // field typed one arity narrower cannot hold an evidence-taking function.
    expect(javascript).toContain("=> describe(");
    expect(javascript).toContain("__hex_instance_Tag_String");
    expect(javascript).not.toContain("{ f: describe }");
  });

  test("(x) the tuple and constructor-application shapes likewise", () => {
    expect(
      diagnostics(TAG +
        "let pair = (describe, 1)\n" +
        'export let s: String = (pair.item1)("x")\n'),
    ).toEqual([]);
    expect(
      diagnostics(TAG +
        "export record Holder(a) = { f: a }\n" +
        "let h = Holder({ f = describe })\n" +
        'export let s: String = (h.f)("x")\n'),
    ).toEqual([]);
  });

  test("(x) a use at a second type is the pinning diagnostic, at the use", () => {
    // §13.6's one user-facing surface for the category: Functions §10's existing
    // pinning-use row. No emission-time message, and no new diagnostic.
    expect(
      diagnostics(TAG +
        "honor Tag<Int> =\n" +
        '    label(value) = "int"\n' +
        "let n: Int = 1\n" +
        "let holder = { f = describe }\n" +
        'export let s: String = (holder.f)("x")\n' +
        "export let t: String = (holder.f)(n)\n"),
    ).toEqual(["type mismatch: expected String, found Int"]);
  });

  test("(x) the annotated arm errors at the declaration, and names two exits", () => {
    expect(
      diagnostics(TAG +
        "let holder: { f: (a) -> String } = { f = describe }\n" +
        'export let s: String = (holder.f)("x")\n'),
    ).toEqual([
      "`a` is a declared type variable, but a binding whose type is not a function " +
      "cannot carry its `Tag` constraint — evidence rides only a function's trailing " +
      "parameters; annotate at a concrete type, or remove the annotation",
    ]);
    // Both exits the message names actually compile. §13.5's bar: a clause the
    // emitter cannot make true in general is not permitted, so each is checked.
    expect(
      diagnostics(TAG +
        "let holder: { f: (String) -> String } = { f = describe }\n" +
        'export let s: String = (holder.f)("x")\n'),
    ).toEqual([]);
    expect(
      diagnostics(TAG +
        "let holder = { f = describe }\n" +
        'export let s: String = (holder.f)("x")\n'),
    ).toEqual([]);
  });

  test("(x) the annotated arm agrees in number with its constraint list", () => {
    // The dedup and the join were exercised by nothing — the battery above has
    // one constraint each, so a singular noun over a plural list read "its
    // `Tag`, `Other` constraint" and no test could see it.
    const source = "constraint Tag<a> =\n" +
      "    label(value: a): String\n" +
      "constraint Other<a> =\n" +
      "    other(value: a): String\n" +
      "honor Tag<String> =\n" +
      '    label(value) = "s"\n' +
      "honor Other<String> =\n" +
      '    other(value) = "s"\n' +
      "fun both<a: (Tag, Other)>(value: a): String = label(value)\n" +
      "let holder: { f: (a) -> String } = { f = both }\n" +
      'export let s: String = (holder.f)("x")\n';
    expect(diagnostics(source)).toEqual([
      "`a` is a declared type variable, but a binding whose type is not a function " +
      "cannot carry its `Tag`, `Other` constraints — evidence rides only a function's " +
      "trailing parameters; annotate at a concrete type, or remove the annotation",
    ]);
  });

  // (x-a…x-g) The destructuring half of the battery, added after review round 4.
  //
  // The rule keys on the type of the binding's **one evaluated value**, never on
  // the type of a name a pattern projects from it. Read the component instead —
  // as the ruling's first wording permitted — and `g` in `let (g, n) =
  // (describe, 1)` is function-typed, passes the seat test, generalizes still
  // carrying `Tag`, and emits `[__hex_arg00 => describe(__hex_arg00, undefined),
  // 1]` with `g("x", dict)` at the use: a wrapper one arity narrower than the
  // suffix its caller appends, the dictionary dropped, the exact shape
  // Constraints §6.1 records so it is not rebuilt. Every specimen below compiled
  // clean on `main` and was regressed by that reading.
  //
  // The emission is the assertion, not just the diagnostic count. A version that
  // merely silenced the message would still ship the dropped dictionary.
  const ETA = "=> describe(__hex_arg00, __hex_instance_Tag_String)";

  const destructures: readonly (readonly [string, string, string])[] = [
    ["x-a a tuple", "let (g, n) = (describe, 1)\n", 'export let s: String = g("x")\n'],
    ["x-b a record", "let { f } = { f = describe }\n", 'export let s: String = f("x")\n'],
    ["x-c a nested tuple", "let ((g, m), n) = ((describe, 2), 1)\n", 'export let s: String = g("x")\n'],
    ["x-d an `as` form", "let (g, n) as whole = (describe, 1)\n", 'export let s: String = g("x")\n'],
  ];

  for (const [label, binding, use] of destructures) {
    test(`(${label}) destructuring compiles, pins, and emits \`main\`'s shape`, () => {
      const source = TAG + binding + use;
      expect(diagnostics(source)).toEqual([]);
      const javascript = compileProject([
        new Source.File(Source.fileId(0), "/main.hex", source),
      ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
      // Built inside the aggregate literal, at the concrete instance...
      expect(javascript).toContain(ETA);
      // ...and the use carries no suffix, because nothing was generalized.
      expect(javascript).not.toContain("undefined)");
    });
  }

  test("(x-a) the same inside a `fun` body's nested block", () => {
    // Level and scope are not what makes the rule work, so it must hold where
    // the binding is not a module item.
    const source = TAG +
      "export fun use(): String =\n" +
      "    let (g, n) = (describe, 1)\n" +
      '    g("x")\n';
    expect(diagnostics(source)).toEqual([]);
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain(ETA);
  });

  test("(x-e) the unconstrained control: a destructured component still generalizes", () => {
    // The rule must not overshoot into "no destructuring binding generalizes".
    // `e` is unconstrained, so it quantifies and serves two element types.
    expect(
      diagnostics(
        "let (e, n) = (empty, 1)\n" +
          "export let a: Int = Seq.length(cons(1, e))\n" +
          'export let b: Int = Seq.length(cons("x", e))\n',
      ),
    ).toEqual([]);
  });

  test("(x-f) an already-diagnosed module gets one diagnostic, not two", () => {
    // The scoped retirement (§13.6). `g` is never used, so nothing pins the
    // variable and the checker reports the non-defaultable constraint — a
    // message that names the rewrite. The emitter used to add
    // `missing \`Tag\` evidence during JavaScript emission` on top: a second
    // report of the same variable, phrased as an internal failure. This is a
    // deliberate change to a surface `main` ships, so it is pinned as an exact
    // list rather than a membership.
    expect(diagnostics(TAG + "let g = Some(describe)\n")).toEqual([
      "this expression's type cannot default to `Int`: `Tag` is not a defaultable " +
      "constraint; add a type annotation to pin the type",
    ]);
  });

  test("(x) an *unconstrained* aggregate still generalizes in full", () => {
    // The other side of the rule, and the record row's whole stdlib motivation:
    // §13.6 reads the residual constraint set, not the shape. Declining on shape
    // alone would un-do Step 1 for `Seq.hex`'s every module-level producer.
    expect(
      diagnostics(
        "let r = { items = [] }\n" +
          "export let n: Int = Vector.at(r.items, 0)\n" +
          "export let s: String = Vector.at(r.items, 0)\n",
      ),
    ).toEqual([]);
  });

  // §2.3: a `var` read is a state observation, and stays expansive.
  test("a `var` read is not a value", () => {
    expect(
      diagnostics(
        "let use = () =>\n" +
          "    var v = empty\n" +
          "    let e = v\n" +
          '    (cons(1, e), cons("a", e))\n',
      ).length,
    ).toBeGreaterThan(0);
  });
});
