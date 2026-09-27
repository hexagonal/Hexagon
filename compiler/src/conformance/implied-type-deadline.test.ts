import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **inferred binders** (Collections Part 2 §7.2.1, #1070).
 *
 * The binder ban (§7.2) refused `<c: Iterable>` wherever it was written, and
 * §8 claimed that `Iterable` therefore never reached an inferred signature.
 * But an unannotated binding generalizes, and generalizing a variable that
 * carries a projection-bearing demand builds the very binder no one may write
 * — with the implied type's link to the binding's type dropped at every use:
 * `let t(x) = Iterable.toSeq(x)` let `t("abc")` be a `Seq(Int)`.
 *
 * The rule: a projection-bearing demand is settled as soon as its subject's
 * outer constructor is known, anywhere in the region that owns the subject's
 * variable, and one still unsettled at that region's close — the dot's
 * deadline, Method Syntax §3.1 — is refused there, whether the value
 * restriction would have generalized the variable or held it back.
 */

const HEADER = "module Main\n\n";
const FIXTURES =
  "record Bag = {x: Int}\n" +
  "constraint Coll<c> =\n" +
  "    type Elem\n" +
  "    first(xs: c) -> Elem\n" +
  "honor Coll<Bag> =\n" +
  "    type Elem = Int\n" +
  "    first(b) = b.x\n";

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly string[])[] {
  const text = HEADER + FIXTURES + source;
  return compileMain(text).diagnostics.map(({ primary, message }) => [
    text.slice(primary.start.offset, primary.end.offset),
    message,
  ]);
}

const REASON = (constraint: string): string =>
  `\`${constraint}\` declares an implied type and cannot constrain a type variable in v1`;

const LEFT_OPEN = (binding: string, value: string): string =>
  `${REASON("Iterable")}, but \`${binding}\` leaves the type of \`${value}\` open; ` +
  `annotate \`${value}\`, or take a \`Seq(a)\` parameter instead`;

describe("a binding may not generalize over an unsettled implied type", () => {
  test("#1070: the helper is refused, and its use draws nothing more", () => {
    expect(reports(
      "let t(x) = Iterable.toSeq(x)\n" +
        "export let s: Seq(Int) = t(\"abc\")\n",
    )).toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
    // The refused variable is an error, not a variable still carrying the
    // demand: a use at a type with no instance adds no second report.
    expect(reports(
      "let t(x) = Iterable.toSeq(x)\n" +
        "let s = t(1)\n",
    )).toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
  });

  test("every binding form that generalizes is held to it", () => {
    for (const helper of [
      "let t(x) = Iterable.toSeq(x)\n",
      "let t = (x) => Iterable.toSeq(x)\n",
      "fun t(x) = Iterable.toSeq(x)\n",
    ]) {
      expect(reports(helper)).toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
    }
    // A destructuring `let` holds a constrained variable back (Functions §8
    // item 2); the binder it reaches through, or the `as` name, is the one named.
    expect(reports("let (g, n) = ((x) => Iterable.toSeq(x), 1)\n"))
      .toEqual([["Iterable.toSeq", LEFT_OPEN("g", "x")]]);
    expect(reports("let (_, n) as whole = ((x) => Iterable.toSeq(x), 1)\n"))
      .toEqual([["Iterable.toSeq", LEFT_OPEN("whole", "x")]]);
    // A local helper is owned by its own binding, not the function around it.
    expect(reports(
      "let u(): Seq(Int) =\n" +
        "    let t(x) = Iterable.toSeq(x)\n" +
        "    t(\"abc\")\n",
    )).toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
  });

  test("a reference to the member leaves open which type it is used at", () => {
    expect(reports("let t = Iterable.toSeq\n")).toEqual([[
      "Iterable.toSeq",
      `${REASON("Iterable")}, but \`t\` leaves open which type \`Iterable.toSeq\` is used at; ` +
        "add a type annotation, or take a `Seq(a)` parameter instead",
    ]]);
    // So does an application whose subject is no name the source wrote.
    expect(reports("let t(g) = Iterable.toSeq(g(1))\n")).toEqual([[
      "Iterable.toSeq",
      `${REASON("Iterable")}, but \`t\` leaves open which type \`Iterable.toSeq\` is used at; ` +
        "add a type annotation, or take a `Seq(a)` parameter instead",
    ]]);
  });

  test("a user constraint with an implied type is held to it, without the Seq hint", () => {
    expect(reports(
      "let f(b) = first(b)\n" +
        "let s: String = f(Bag({x = 1}))\n",
    )).toEqual([[
      "first",
      `${REASON("Coll")}, but \`f\` leaves the type of \`b\` open; annotate \`b\``,
    ]]);
  });

  test("one report per variable, whatever it demands", () => {
    expect(reports("let t(x) = (Iterable.toSeq(x), Iterable.toSeq(x))\n"))
      .toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
    // Two projection-bearing constraints on one variable are one refusal:
    // annotating `x` settles both.
    expect(reports("let t(x) = (Iterable.toSeq(x), first(x))\n"))
      .toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
  });
});

describe("the deadline is the owner's close", () => {
  test("a subject settled later in the same body is settled", () => {
    const helper =
      "let f(xs) =\n" +
      "    let items = Iterable.toSeq(xs)\n" +
      "    let known: Vector(String) = xs\n" +
      "    items\n";
    expect(reports(helper + "export let s: Seq(String) = f([\"a\"])\n")).toEqual([]);
    // Settled means linked: the element type is the instance's.
    expect(reports(helper + "export let s: Seq(Int) = f([\"a\"])\n"))
      .toEqual([["Seq(Int)", "type mismatch: expected Int, found String"]]);
  });

  test("an inner binding's demand on its enclosing function's variable waits for that function", () => {
    expect(reports(
      "let outer(xs) =\n" +
        "    let inner() = Iterable.toSeq(xs)\n" +
        "    let known: Vector(String) = xs\n" +
        "    inner()\n" +
        "export let s: Seq(String) = outer([\"a\"])\n",
    )).toEqual([]);
  });

  test("a variable the value restriction holds back is refused at its binding, not left for a first use", () => {
    expect(reports(
      "let pick(f) = f\n" +
        "let t = pick((x) => Iterable.toSeq(x))\n" +
        "export let s: Seq(Int) = t(\"abc\")\n",
    )).toEqual([["Iterable.toSeq", LEFT_OPEN("t", "x")]]);
    // And at a value binding that is no function, where the evidence seat
    // holds it back.
    expect(reports("let r = {f = (x) => Iterable.toSeq(x)}\n"))
      .toEqual([["Iterable.toSeq", LEFT_OPEN("r", "x")]]);
  });

  test("a subject in no binding's type keeps the ambiguity report", () => {
    expect(reports(
      "fun bottom(n: Int): a = bottom(n)\n" +
        "let k(): Int = Seq.length(Iterable.toSeq(bottom(1)))\n",
    )).toEqual([[
      "bottom(1)",
      "this expression's type cannot default to `Int`: `Iterable` is not a defaultable constraint; " +
        "add a type annotation to pin the type",
    ]]);
  });

  test("a known constructor with variable arguments is settled, and its implied type follows them", () => {
    const helper = "let t(v: Vector(a)) = Iterable.toSeq(v)\n";
    expect(reports(helper + "export let s: Seq(Int) = t([1])\n")).toEqual([]);
    expect(reports(helper + "export let s: Seq(String) = t([1])\n"))
      .toEqual([["1", "integer literal cannot have type `String`"]]);
  });

  test("a settled demand runs", async () => {
    const exports = await runMain(
      HEADER +
        "let joined(xs) =\n" +
        "    let items = Iterable.toSeq(xs)\n" +
        "    let known: Vector(String) = xs\n" +
        "    String.fromSeq(items)\n" +
        "export let main(): String = joined([\"a\", \"b\"])\n",
    );
    expect((exports["main"] as () => unknown)()).toBe("ab");
  });
});

describe("a declared variable is never settled", () => {
  test("a declared parameter type is refused in its own words", () => {
    expect(reports("let t(x: c) = Iterable.toSeq(x)\n")).toEqual([[
      "Iterable.toSeq",
      `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
    // A result written as another variable is the same refusal, not a
    // parametric claim the checker lets through.
    expect(reports("let t(x: c): Seq(d) = Iterable.toSeq(x)\n")).toEqual([[
      "Iterable.toSeq",
      `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
    expect(reports("let f(b: c) = first(b)\n")).toEqual([[
      "first",
      `\`b\` has the generic type \`c\`, and ${REASON("Coll")}`,
    ]]);
  });

  test("with no name to give, the variable is named", () => {
    expect(reports("let t: (c) -> Seq(d) = Iterable.toSeq\n")).toEqual([[
      "Iterable.toSeq",
      `\`c\` is a declared type variable, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
  });

  test("a written binder the ban refused is the whole answer", () => {
    expect(reports("let t<c: Iterable>(x: c) = Iterable.toSeq(x)\n")).toEqual([[
      "c: Iterable",
      `${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
  });

  test("a written list is never advised to name the constraint", () => {
    // Functions §4.2's contract refusal would advise `<c: (Iterable, Show)>`,
    // which the ban refuses; the deadline's report stands instead.
    expect(reports("let t<c: Show>(x: c) = Iterable.toSeq(x)\n")).toEqual([[
      "Iterable.toSeq",
      `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
  });

  test("a constraint's subject and an honor's binder are declared variables too", () => {
    expect(reports(
      "constraint Foo<c> =\n" +
        "    go(x: c) -> Int = Seq.length(Iterable.toSeq(x))\n",
    )).toEqual([[
      "Iterable.toSeq",
      `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
    for (const head of ["honor Coll<Box(a)> =", "honor<a: Show> Coll<Box(a)> ="]) {
      expect(reports(
        "record Box(a) = {v: Vector(a)}\n" +
          `${head}\n` +
          "    type Elem = Int\n" +
          "    first(b) = Seq.length(Iterable.toSeq(b.v[0]))\n",
      )).toEqual([[
        "Iterable.toSeq",
        `\`a\` is a declared type variable, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
      ]]);
    }
  });

  test("the whole list a contract refusal advises leaves the constraint out", () => {
    expect(reports("let t<c: Eq>(x: c) = (Iterable.toSeq(x), show(x))\n")).toEqual([
      [
        "Iterable.toSeq",
        `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
      ],
      [
        "show",
        "`c` is declared to honor `Eq`, but the body requires `Show`; write `<c: (Eq, Show)>`, " +
          "or remove the constraint annotation to let it be inferred",
      ],
    ]);
    // Two projection-bearing constraints on one declared variable: one report.
    expect(reports("let t<c: Show>(x: c) = (Iterable.toSeq(x), first(x))\n")).toEqual([[
      "Iterable.toSeq",
      `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
    ]]);
  });

  test("an export is never advised to write the binder", () => {
    // Modules §4.1.1 would ask for `<a: Iterable>`; the refusal stands instead.
    expect(reports("export let t(x) = Iterable.toSeq(x)\n")).toEqual([
      ["t", "exported function `t` requires a complete signature; add type for parameter `x` and a return type"],
      ["Iterable.toSeq", LEFT_OPEN("t", "x")],
    ]);
    expect(reports("export let t(x: c) = Iterable.toSeq(x)\n")).toEqual([
      ["t", "exported function `t` requires a complete signature; add a return type"],
      [
        "Iterable.toSeq",
        `\`x\` has the generic type \`c\`, and ${REASON("Iterable")}; take a \`Seq(a)\` parameter instead`,
      ],
    ]);
  });
});
