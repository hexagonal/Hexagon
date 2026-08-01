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

  test("(vi) the bare shape is the *binding*'s, not every reference's", () => {
    // Constraints §6.1 and closure doc §13.3 both say "at a binding". A name in
    // any other position keeps the wrapper, because only a binding gives the
    // reference a seat whose type is the reference's own: a record field was
    // typed one arity narrower than the evidence-taking function the bare shape
    // would store in it, and the two diagnostics that used to say so went quiet.
    const source = "fun double<a: Num>(value: a): a = value + value\n" +
      "let holder = { f = double }\n" +
      "export let out: Int = (holder.f)(21)\n";
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(javascript).not.toContain("{ f: double }");
    expect(javascript).toContain("=> double(");
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
