import { describe, expect, test } from "vitest";

import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Conformance for the report on a function that **spreads one tuple parameter
 * over several** (#1418; Functions §5 and §10; `collection-combinators.md`
 * §5.2).
 *
 * A `Map`'s item is its entry, a pair, so a callback over a map's items takes
 * one parameter. `(k, v) => …` is a function of two, a different type, and the
 * refusal stands: there is no tuple application in either direction (Functions
 * §5). What changes is the report. It used to say `function arity mismatch: 1
 * and 2` and name nothing; the Rewrite Rule (Declarations Preamble §1.1) asks
 * for the local rewrite, which is the destructuring parameter `((k, v)) => …`.
 *
 * The report speaks only where the reading is the one possibility: exactly one
 * expected parameter is a tuple whose parts make up the difference. A lambda
 * written at the seat is caret and rewritten in its own parameter names; any
 * other function is wrapped in a lambda that destructures and passes the parts
 * on.
 */

const MAP = 'let m: Map(String, Int) = Map.fromVector([("a", 1), ("b", 3)])\n';

/** Each report as its message and the source text its caret covers. */
function reports(body: string): readonly (readonly [string, string])[] {
  const source = "module Main\n\n" + body;
  return compileFiles([["/main.hex", source]]).diagnostics.map(({ message, primary }) =>
    [message, source.slice(primary.start.offset, primary.end.offset)] as const
  );
}

describe("a lambda that spreads the pair is told to destructure it", () => {
  test("at a one-parameter callback, in the lambda's own names, at the lambda", () => {
    expect(reports(MAP + "export let big: Bool = Seq.any(m, (k, v) => v > 2)\n")).toEqual([[
      "the function expected here takes one parameter, a pair `(String, Int)`, but the lambda " +
        "spreads it over two parameters; destructure the pair in one parameter: `((k, v)) => …`",
      "(k, v) => v > 2",
    ]]);
  });

  test("at the map's own combinators, called with a dot", () => {
    expect(reports(MAP + "export let big: Bool = m.any((k, v) => v > 2)\n" +
      "export let kept: Map(String, Int) = m.filter((k, v) => v > 2)\n")).toEqual([
      [
        "the function expected here takes one parameter, a pair `(String, Int)`, but the lambda " +
          "spreads it over two parameters; destructure the pair in one parameter: `((k, v)) => …`",
        "(k, v) => v > 2",
      ],
      [
        "the function expected here takes one parameter, a pair `(String, Int)`, but the lambda " +
          "spreads it over two parameters; destructure the pair in one parameter: `((k, v)) => …`",
        "(k, v) => v > 2",
      ],
    ]);
  });

  test("where the pair is one of several parameters, the others stay as written", () => {
    expect(reports(MAP + "export let total: Int = Seq.fold(m, 0, (acc, k, v) => acc + v)\n")).toEqual([[
      "the function expected here takes a pair `(String, Int)` as its second parameter, but the " +
        "lambda spreads it over two parameters; destructure the pair in one parameter: " +
        "`(acc, (k, v)) => …`",
      "(acc, k, v) => acc + v",
    ]]);
  });

  test("at a written annotation, the lambda the annotation is the seat of", () => {
    expect(reports("let add: ((Int, Int)) -> Int = (a, b) => a + b\n"))
      .toEqual([[
        "the function expected here takes one parameter, a pair `(Int, Int)`, but the lambda " +
          "spreads it over two parameters; destructure the pair in one parameter: `((a, b)) => …`",
        "(a, b) => a + b",
      ]]);
  });

  test("annotated parameters are named without their annotations", () => {
    expect(reports(MAP + "export let big: Bool = Seq.any(m, (k: String, v: Int) => v > 2)\n")[0]?.[0])
      .toMatch(/destructure the pair in one parameter: `\(\(k, v\)\) => …`$/u);
  });

  test("`_` and a destructuring pattern are kept as written", () => {
    expect(reports(MAP + "export let big: Bool = m.any((_, v) => v > 2)\n")[0]?.[0])
      .toMatch(/destructure the pair in one parameter: `\(\(_, v\)\) => …`$/u);
    expect(reports("export let any: Bool = Seq.any([((1, 2), 3, 4)], ((a, b), c, d) => a > c)\n")).toEqual([[
      "the function expected here takes one parameter, a triple, but the lambda spreads it over " +
        "three parameters; destructure the triple in one parameter: `(((a, b), c, d)) => …`",
      "((a, b), c, d) => a > c",
    ]]);
  });

  test("a triple is named as one, and parts not yet solved are not shown", () => {
    expect(reports("export let any: Bool = Seq.any([(1, 2, 3)], (a, b, c) => a > c)\n")).toEqual([[
      "the function expected here takes one parameter, a triple, but the lambda spreads it over " +
        "three parameters; destructure the triple in one parameter: `((a, b, c)) => …`",
      "(a, b, c) => a > c",
    ]]);
  });

  test("the rewrite it names compiles and answers", async () => {
    const main = await runMain("module Main\n\n" + MAP +
      "export let big: Bool = Seq.any(m, ((k, v)) => v > 2)\n" +
      "export let total: Int = Seq.fold(m, 0, (acc, (k, v)) => acc + v)\n" +
      "export let kept: Int = m.filter(((k, v)) => v > 2).size()\n" +
      "export let some: Bool = m.any(((_, v)) => v > 2)\n");
    expect(main.big).toBe(true);
    expect(main.total).toBe(4);
    expect(main.kept).toBe(1);
    expect(main.some).toBe(true);
  });
});

describe("a function that is not a lambda written there is wrapped", () => {
  test("a named function is not rewritten at its declaration", () => {
    expect(reports(MAP +
      "let isBig(k: String, v: Int): Bool = v > 2\n" +
      "export let big: Bool = Seq.any(m, isBig)\n")).toEqual([[
      "the function expected here takes one parameter, a pair `(String, Int)`, but this function " +
        "takes two parameters; wrap it in a lambda that destructures the pair: `((a, b)) => f(a, b)`",
      "Seq.any(m, isBig)",
    ]]);
  });

  test("two lambdas that became one value have no one set of names, so they are wrapped", () => {
    expect(reports(MAP +
      "let pick(c: Bool, a: x, b: x): x = if c then a else b\n" +
      "export let big(strict: Bool): Bool = Seq.any(m, pick(strict, (k, v) => v > 2, (k, v) => v > 1))\n")
      .map(([message]) => message)).toEqual([
      "the function expected here takes one parameter, a pair `(String, Int)`, but this function " +
        "takes two parameters; wrap it in a lambda that destructures the pair: `((a, b)) => f(a, b)`",
    ]);
  });
});

describe("where the reading is not the one possibility, the plain report stands", () => {
  test("parts that do not make up the difference", () => {
    expect(reports("export let any: Bool = Seq.any([(1, 2)], (a, b, c) => a > c)\n").map(([message]) => message))
      .toEqual(["function arity mismatch: 1 and 3"]);
  });

  test("a tuple of more parts than the difference", () => {
    expect(reports("export let any: Bool = Seq.any([(1, 2, 3)], (a, b) => a > b)\n").map(([message]) => message))
      .toEqual(["function arity mismatch: 1 and 2"]);
  });

  test("fewer parameters than the seat takes", () => {
    expect(reports("export let n: Int = Seq.fold([1], 0, (acc) => acc)\n").map(([message]) => message))
      .toEqual(["function arity mismatch: 2 and 1"]);
  });

  test("two tuple parameters either of which could be the one spread", () => {
    expect(reports("let both: ((Int, Int), (Int, Int)) -> Int = (a, b, c) => a + b + c\n")
      .map(([message]) => message)).toEqual(["function arity mismatch: 2 and 3"]);
  });

  test("the zero/one report is untouched", () => {
    expect(reports("let run(f: Int -> Int): Int = f(1)\nexport let n: Int = run(() => 2)\n")
      .map(([message]) => message)).toEqual([
      "a zero-parameter function cannot be passed where a one-parameter function is expected; " +
        "generics do not abstract over arity, so wrap it: `_ => thunk()`",
    ]);
  });
});
