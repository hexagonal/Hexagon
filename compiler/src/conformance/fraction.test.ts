import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for #1542: `//` writes a fraction and takes one apart, `Rat`
 * joins the prelude after `Dec`, and a `Dec` enters a `Rat` through `FromDec`.
 *
 * - Operators §6.4: `top // bottom` is the prelude `Rat`'s `create` applied to
 *   two integer sides, at level 5 between unary minus and `*` `/`, and it does
 *   not chain.
 * - Comments §3.1: a `//` meant as a comment is the parser's to refuse.
 * - Pattern Matching §2.10, §7.2: `p1 // p2` takes a `Rat` apart into its
 *   canonical top and bottom, and a fraction its literals show can never match
 *   is a dead case.
 * - Rat §10, §11: the prelude seat, `FromDec<Rat>`, and the five rounding
 *   functions.
 * - Exact Integer Widening §9: `Dec` is the fourth widening source.
 */

const main = (source: string): string => `module Main\n\n${source}`;
const messages = (source: string): readonly string[] => projectDiagnostics(main(source));
const run = (source: string): Promise<Record<string, unknown>> => runMain(main(source));

describe("`//` writes a fraction (Operators §6.4)", () => {
  test("the level reads each fraction whole before arithmetic reaches it", async () => {
    const exports = await run(
      "let half = 1 // 2\n" +
        'export let shown: String = "${half * 1 // 2} ${6 / 2 // 3} ${1 // 2 * 3 // 4} ${-1 // 3} ' +
        '${1 // -3} ${2 ** 3 // 4} ${(5 // 2).round()}"\n',
    );
    expect(exports["shown"]).toBe("1/4 9/1 3/8 -1/3 -1/3 2/1 3");
  });

  test("the sides are integer seats, and a Nat, Int or BigInt enters one", async () => {
    const exports = await run(
      "let n: Nat = 3\nlet i: Int = -6\nlet b: BigInt = 8n\n" +
        'export let shown: String = "${n // b} ${i // n} ${b // 12}"\n',
    );
    expect(exports["shown"]).toBe("3/8 -2/1 2/3");
  });

  test("a fraction emits the prelude `Rat`'s `create`, as a written call does", () => {
    const project = compileMain(main("export let third: Rat = 1 // 3\n"));
    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ name }) => name === "Main")!.javascript.text;
    expect(text).toContain("const third = create(1n, 3n);");
    expect(text).toContain('from "./Hex/Rat.js"');
  });

  test("a program with no fraction emits no `Rat` code", () => {
    const project = compileMain(main('export let x: Int = 1 + 2\n'));
    expect(project.diagnostics).toEqual([]);
    expect(project.modules.map(({ name }) => name)).not.toContain("Hex.Rat");
  });

  test("a zero bottom throws `DivideByZeroFault` when it runs", async () => {
    const exports = await run(
      "let zero: BigInt = 0n\n" +
        "export let caught: String = try\n" +
        '    "${1 // zero}"\n' +
        "catch\n" +
        "    DivideByZeroFault(message) => message\n",
    );
    expect(exports["caught"]).toBe("Rat.create: bottom is zero");
  });

  test("the fraction is the prelude's, by identity, where a module declares its own `Rat`", async () => {
    const exports = await run(
      "record Rat = {x: Int}\n" +
        "let mine = Rat({x = 1})\n" +
        'export let shown: String = "${1 // 3} ${mine.x}"\n',
    );
    expect(exports["shown"]).toBe("1/3 1");
  });

  test("`import Rat` stays legal and binds nothing new", async () => {
    const exports = await run('import Rat\nexport let shown: String = "${(1 // 3 : Rat.Rat)}"\n');
    expect(exports["shown"]).toBe("1/3");
  });

  test("`//` does not chain", () => {
    expect(messages("let x = 1 // 2 // 3\n")).toEqual([
      "`//` does not chain; a fraction has one top and one bottom — to divide one, write `(1 // 2) / 3`",
    ]);
    expect(messages("let r = 1 // 2\nlet x = match r\n    1 // 2 // 3 => 1\n    _ => 2\n")).toContain(
      "`//` does not chain; a fraction has one top and one bottom — to divide one, write `(1 // 2) / 3`",
    );
  });

  test("a side the text decides as `Rat`, `Dec` or `Float` is refused with the division meant", () => {
    expect(messages("let r = 1 // 2\nlet x = r // 2\n")).toEqual([
      "a fraction's top and bottom are integers, and `r` is a `Rat` — to divide, write `r / 2`",
    ]);
    expect(messages("let r = 1 // 2\nlet x = 2 // r\n")).toEqual([
      "a fraction's top and bottom are integers, and `r` is a `Rat` — to divide, write `2 / r`",
    ]);
    expect(messages("let x = 1.5 // 2\n")).toEqual([
      "a fraction's top and bottom are integers, and `1.5` is a `Float` — to divide, write `1.5 / 2`",
    ]);
    expect(messages("let d = 1.5d\nlet x = d // 2\n")).toEqual([
      "a fraction's top and bottom are integers, and `d` is a `Dec` — to divide, write `Rat.fromDec(d) / 2`",
    ]);
    // A compound side, refused at that side in the same words.
    expect(messages("let x = (1 // 2) // 3\n")).toEqual([
      "a fraction's top and bottom are integers, and `(1 // 2)` is a `Rat` — to divide, write `(1 // 2) / 3`",
    ]);
    expect(messages("let r = 1 // 2\nlet x = (r + 1) // 2\n")).toEqual([
      "a fraction's top and bottom are integers, and `(r + 1)` is a `Rat` — to divide, write `(r + 1) / 2`",
    ]);
    expect(messages("let d = 1.5d\nlet x = (d * 2) // 3\n")).toEqual([
      "a fraction's top and bottom are integers, and `(d * 2)` is a `Dec` — to divide, write `Rat.fromDec(d * 2) / 3`",
    ]);
  });
});

describe("a `//` meant as a comment (Comments §3.1)", () => {
  test("with nothing to its left, it is refused naming `--`", () => {
    const project = compileMain(main("// note\nlet y = 1\n"));
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "a fraction needs a top; for a comment, write `--`",
    ]);
    expect(project.diagnostics[0]!.fixes?.[0]?.edits.map(({ replacement }) => replacement)).toEqual(["--"]);
  });

  test("a run of slashes is refused the same way, each slash a dash", () => {
    const project = compileMain(main("/// note\nlet y = 1\n"));
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "a fraction needs a top; for a comment, write `--`",
    ]);
    expect(project.diagnostics[0]!.fixes?.[0]?.edits.map(({ replacement }) => replacement)).toEqual(["---"]);
  });

  test("in any block, and wherever no operand has begun, it is refused once and read on", () => {
    const refusal = "a fraction needs a top; for a comment, write `--`";
    expect(messages(
      "let r = 1 // 2\nlet s = match r\n    // the zero case\n    0 // _ => 1\n    _ => 2\n" +
        "record P = {\n    // the x\n    x: Int,\n}\n",
    )).toEqual([refusal, refusal]);
    expect(messages("let v = [\n    1, // one\n    2,\n]\nlet g(x: Int): Int = // doubles\n    x * 2\n"))
      .toEqual([refusal, refusal]);
    // The note is not added to the refusal it repeats.
    expect(compileMain(main("let z = 1 // // 2\n")).diagnostics.map(({ message, notes }) => [message, notes ?? []]))
      .toEqual([[refusal, []]]);
  });

  test("a syntax error after a `//` on its line gains the note", () => {
    const project = compileMain(main("let a = 1\nlet b = 1 // a note\n"));
    const syntax = project.diagnostics.find(({ message }) => message.startsWith("expected a newline"));
    expect(syntax?.notes).toEqual(["for a comment, write `--`"]);
  });

  test("a `//` whose right side parses is a fraction, and draws what its sides draw", () => {
    const project = compileMain(main("let c = 1 // note\n"));
    expect(project.diagnostics.map(({ message, notes }) => [message, notes ?? []])).toEqual([
      ["unknown name `note`", []],
    ]);
  });

  test("a deeper-indented line continues the line above, so its `//` is a fraction", async () => {
    const exports = await run('let total =\n    1\n        // 2\nexport let shown: String = "${total}"\n');
    expect(exports["shown"]).toBe("1/2");
  });
});

describe("`p1 // p2` takes a fraction apart (Pattern Matching §2.10)", () => {
  test("arms, `let`, a lambda head and a guard each read it", async () => {
    const exports = await run(
      "let describe(r: Rat): String = match r\n" +
        '    0 // _ => "zero"\n' +
        '    n // 1 => "the whole number ${n}"\n' +
        '    n // d => "${n} over ${d}"\n' +
        "let n // d = 4 // -5\n" +
        "let tops = [1 // 2, 3 // 4].map(t // _ => t)\n" +
        "let size(r: Rat): String = match r\n" +
        '    x when x > 1 // 2 => "big"\n' +
        '    _ => "small"\n' +
        'export let shown: String = "${describe(6 // 4)}; ${describe(-8 // 4)}; ${describe(0 // 5)}; ' +
        '${n} ${d}; ${tops}; ${size(3 // 4)} ${size(1 // 4)}"\n',
    );
    expect(exports["shown"]).toBe("3 over 2; the whole number -2; zero; -4 5; [1, 3]; big small");
  });

  test("its witness prints with `//` between its sides", () => {
    expect(messages("let r = 1 // 2\nlet s = match r\n    0 // _ => 1\n")).toEqual([
      "match is missing cases: `_ // _`",
    ]);
    expect(messages("let r = 1 // 2\nlet 1 // d = r\n")).toEqual([
      "this pattern can fail: `_ // _`; use `match`",
    ]);
  });

  test("a literal-sided head is one parameter, refused as refutable", () => {
    expect(messages("let f = 1 // d => d\n")).toEqual([
      "this pattern can fail: `_ // _`; use `match` — for a match function, write `match` with arms",
    ]);
  });

  test("a `Rat` abroad names `//` as its pattern", () => {
    expect(messages("let r = 1 // 2\nlet s = match r\n    Rat(x) => 1\n")).toEqual([
      "cannot destructure opaque record `Rat`; match it with `top // bottom`",
    ]);
  });

  test("a fraction its literals show can never match is a dead case, named with its spelling", () => {
    const dead = (pattern: string): readonly string[] =>
      messages(`let r = 1 // 2\nlet s = match r\n    ${pattern} => 1\n    _ => 2\n`);
    const lead = "this case is unreachable; a fraction comes apart in lowest terms with a positive bottom, so ";
    expect(dead("2 // 6")).toEqual([`${lead}\`2 // 6\` never matches — write \`1 // 3\``]);
    expect(dead("1 // -3")).toEqual([`${lead}\`1 // -3\` never matches — write \`-1 // 3\``]);
    expect(dead("0 // 5")).toEqual([`${lead}\`0 // 5\` never matches — write \`0 // 1\``]);
    expect(dead("n // -3")).toEqual([
      `${lead}\`n // -3\` never matches — write \`n // 3\`, which binds the negated top`,
    ]);
    expect(dead("n // 0")).toEqual(["this case is unreachable; a fraction's bottom is never zero — remove the case"]);
    // The fix rewrites bare literals; under `as` it would delete the binder.
    const fixed = compileMain(main("let r = 1 // 2\nlet s = match r\n    (2 as two) // 6 => 1\n    _ => 2\n"));
    expect(fixed.diagnostics[0]?.fixes).toBeUndefined();
    // A literal under `as` is a literal; each alternative is judged alone.
    expect(dead("(2 as two) // 6")).toEqual([`${lead}\`(2 as two) // 6\` never matches — write \`1 // 3\``]);
    expect(dead("1 // 3 | 2 // 6")).toEqual([`${lead}\`2 // 6\` never matches — write \`1 // 3\``]);
    // Nothing else about a side is read.
    expect(dead("1 // 3")).toEqual([]);
    expect(dead("n // 3")).toEqual([]);
  });

  test("its sides are checked at `BigInt` and do not widen", () => {
    expect(messages("let r = 1 // 2\nlet s = match r\n    1.5 // 2 => 1\n    _ => 2\n")).toHaveLength(1);
    expect(messages("let r = 1 // 2\nlet s = match r\n    1.50d => 1\n    _ => 2\n")).toEqual([
      "type mismatch: expected Rat, found Dec",
    ]);
  });
});

describe("`Rat` rounds to an integer (Rat §11)", () => {
  test("the five functions follow `Dec`'s rules", async () => {
    const exports = await run(
      'export let shown: String = "${(5 // 2).round()} ${(-5 // 2).round()} ${(5 // 2).roundEven()} ' +
        '${(7 // 2).roundEven()} ${(-8 // 3).trunc()} ${(-5 // 2).floor()} ${(-5 // 2).ceil()} ' +
        '${(4 // 1).round()} ${(-4 // 1).floor()} ${(1 // 3).ceil()} ${(-1 // 3).round()}"\n',
    );
    expect(exports["shown"]).toBe("3 -3 2 4 -2 -3 -2 4 -4 1 0");
  });

  test("each returns a `BigInt`", () => {
    for (const name of ["round", "roundEven", "trunc", "floor", "ceil"]) {
      expect(messages(`export let x: BigInt = (5 // 2).${name}()\n`), name).toEqual([]);
    }
  });
});

describe("a `Dec` enters a `Rat` (Exact Integer Widening §9)", () => {
  const price = "let price: Dec = 1.50d\n";

  test("§9's examples", async () => {
    const exports = await run(
      price +
        "let share: Rat = price\n" +
        "let third = price * 1 // 3\n" +
        "let ratio: Rat = price / 0.25d\n" +
        "let back: Rat = price ** -2\n" +
        "let plus = price + 0.5\n" +
        "let mixed = price / 0.25d * (1 // 3)\n" +
        'export let shown: String = "${share} ${third} ${ratio} ${back} ${plus} ${mixed}"\n',
    );
    expect(exports["shown"]).toBe("3/2 1/2 6/1 4/9 2.00 2/1");
  });

  test("at argument, return and assignment seats, in both orders, and at comparisons", async () => {
    const exports = await run(
      price +
        "let takes(r: Rat): Rat = r\n" +
        "let gives(d: Dec): Rat = d\n" +
        "let assigned(): Rat =\n    var slot: Rat = 0\n    slot := price\n    slot\n" +
        'export let shown: String = "${takes(price)} ${gives(price)} ${assigned()} ' +
        '${price + 1 // 2} ${1 // 2 + price} ${price == 3 // 2} ${3 // 2 == price} ${price < 2 // 1}"\n',
    );
    expect(exports["shown"]).toBe("3/2 3/2 3/2 2/1 2/1 True True True");
  });

  test("through the tower's call spellings", async () => {
    const exports = await run(
      price +
        "let a: Rat = price.add(1 // 2)\n" +
        "let b: Rat = (1 // 2).add(price)\n" +
        "let c: Rat = Rat.fromDec(price)\n" +
        "let d: Rat = FromDec.fromDec(price)\n" +
        'export let shown: String = "${a} ${b} ${c} ${d}"\n',
    );
    expect(exports["shown"]).toBe("2/1 2/1 3/2 3/2");
  });

  test("with `Nat`, `Int` or `BigInt` the home is `Dec`", async () => {
    const exports = await run(price + 'let i: Int = 2\nexport let shown: String = "${price + i}"\n');
    expect(exports["shown"]).toBe("3.50");
  });

  test("without a `Rat` home, `/` on two `Dec`s names both routes, and `a.divide` is `Dec`'s", () => {
    expect(messages("let a = 1.5d\nlet c = 0.5d\nlet x = a / c\n")).toEqual([
      "type `Dec` has no `Frac` instance; write a `Rat` type, or use `Dec.divide` with a place count",
    ]);
    expect(messages("let a = 1.5d\nlet c = 0.5d\nlet x: Dec = a.divide(c, 2)\n")).toEqual([]);
  });

  test("without a `Rat` home, a negative power is `Dec`'s, and throws", async () => {
    const exports = await run(
      price +
        "export let caught: String = try\n" +
        '    "${price ** -2}"\n' +
        "catch\n" +
        "    NegativeExponentFault(message) => message\n",
    );
    expect(exports["caught"]).toBe("Dec.pow: exponent cannot be negative");
  });

  test("a `Dec` meeting a `Float` cannot enter it", () => {
    expect(messages("let d = 1.5d\nlet f: Float = 2.0\nlet x = d + f\n")).toEqual([
      "`d` is a `Dec` and cannot enter `Float`, the home `f` gives this expression; " +
        "convert one explicitly — `d.toFloat()`",
    ]);
  });

  test("a generic `a: FromDec` accepts a `Dec`, and `a: FromBigInt` alone does not", () => {
    expect(messages("let g<a: FromDec>(x: a): a = x\nexport let r: Rat = g(1.5d)\n")).toEqual([]);
    expect(messages("let h<a: FromBigInt>(): a = 1.5d\n")).toHaveLength(1);
  });

  test("`fromDec` agrees with `fromBigInt` on a value with no places", async () => {
    const exports = await run(
      'export let shown: String = "${Rat.fromDec(Dec.create(7n, 0)) == Rat.fromBigInt(7n)} ' +
        '${Rat.fromDec(1.5d) == Rat.fromDec(1.50d)}"\n',
    );
    expect(exports["shown"]).toBe("True True");
  });
});

describe("the Playground's fraction example", () => {
  test("its exact calculations run", async () => {
    const exports = await run(
      "let half = 1 // 2\n" +
        "let third = 1 // 3\n" +
        "let fiveSixths = half + third\n" +
        "let threeHalves = half / third\n" +
        "let n // d = 10 // 12\n" +
        'export let shown: String = "${fiveSixths} ${threeHalves} ${10 // 12 == 5 // 6} ${n} ${d}"\n',
    );
    expect(exports["shown"]).toBe("5/6 3/2 True 5 6");
  });
});

describe("the prelude seats `FromDec` and `Rat` after `Dec`", () => {
  test("`Rat` is in every module's scope, and a library module's `Rat` is gone", () => {
    expect(compileFiles([["/main.hex", main("export let r: Rat = Rat.create(1, 2)\n")]]).diagnostics).toEqual([]);
  });
});
