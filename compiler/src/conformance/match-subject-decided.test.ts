import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

/**
 * Conformance for Pattern Matching §6.1: **a `match`'s scrutinee is decided by
 * the program's text and its patterns, as a dot call's subject is.** A `match`
 * needs only its scrutinee's head. It reads it from the text (Method Syntax
 * §3.1) — which now holds a parameter a `match` in its own function's body
 * tests with a bare integer pattern, an `Int` where it is made (Numeric
 * Literals §4), and a lambda applied where it is written, read as a `let` of
 * its argument — or from a pattern that names it. Patterns that test nothing
 * need none. Anything else is refused, in every order of the lines: no line
 * above or below a `match` chooses what it tests.
 */

const HEADER = "module Main\n\n";

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  );
}

/** `template` with its `{0}`, `{1}`, … slots filled by `lines`, in that order. */
function fill(template: string, lines: readonly string[]): string {
  return lines.reduce((text, line, index) => text.replace(`{${index}}`, line), template);
}

const compiles = (source: string): void => {
  expect(projectDiagnostics(HEADER + source)).toEqual([]);
};

/** A binding's displayed scheme, the program compiling cleanly. */
function typeOf(source: string, name: string): string {
  const compiled = compileMain(HEADER + source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find((module) => module.source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

const opening = (whose: string): string =>
  `the program's text does not decide ${whose} type here, and no pattern names it, so the \`match\` ` +
  "cannot tell what its patterns test — ";
const PARAMETER = opening("the parameter's") +
  "write the parameter's type where the function is bound, or hand the function a value whose type is written";
const named = (name: string): string => opening(`\`${name}\`'s`) + `write \`${name}\`'s type`;
const value = (spelled: string): string => opening("the matched value's") + `write \`(${spelled}: …)\``;

const ZERO = "match k\n        0 => 1\n        _ => 2";
const SHOW_X = "the program's text does not decide `x`'s type here, so `.show(…)` cannot tell whose `show` it is — " +
  "write `x`'s type, or call the operation by its module (`Module.show(x, …)`); a record's field is called as `(x.show)(…)`";
const BODY = "let f(k) =\n    {0}\n    {1}\n    ()";

/** Each case: its name, the declarations it uses, a body whose slots take the lines, the lines, and the reports. */
const ORDERS: readonly (readonly [string, string, string, readonly string[], readonly string[]])[] = [
  // The issue's pair: a written line beside the `match` no longer chooses.
  ["int-line", "", BODY, ["let w: Int = k", `let n = ${ZERO}`], []],
  ["bigint-line-widens", "", BODY, ["let w: BigInt = k", `let n = ${ZERO}`], []],
  ["float-line-widens", "", BODY, ["let w: Float = k", `let n = ${ZERO}`], []],
  ["nat-line", "", BODY, ["let w: Nat = k", `let n = ${ZERO}`], ["type mismatch: expected Nat, found Int"]],
  ["string-line", "", BODY, ["let w: String = k", `let n = ${ZERO}`], ["type mismatch: expected String, found Int"]],
  ["dot-on-the-parameter", "", BODY, ["let s = k.show()", `let n = ${ZERO}`], []],
  [
    "dot-on-the-match",
    "",
    BODY,
    ["let w: Int = k", "let n = (match k\n        0 => [1]\n        _ => [2]).length()"],
    [],
  ],
  [
    "in-an-arm-body",
    "",
    "let f(c: Bool, k) =\n    {0}\n    {1}\n    ()",
    ["let w: Int = k", "let n = match c\n        True => match k\n            0 => 1\n            _ => 2\n        False => 3"],
    [],
  ],
  // A pattern that names the head decides it, whatever the lines say.
  ["patterns-name-bool", "", BODY, ["let w: Bool = k", "let n = match k\n        True => 1\n        False => 2"], []],
  ["patterns-name-option", "", BODY, ["let w: Option(Int) = k", "let n = match k\n        Some(0) => 1\n        _ => 2"], []],
  ["patterns-name-float", "", BODY, ["let w: Float = k", "let n = match k\n        0 => 1\n        1.5 => 2\n        _ => 3"], []],
  ["patterns-name-tuple", "", BODY, ["let w: (Int, Int) = k", "let n = match k\n        (0, _) => 1\n        _ => 2"], []],
  [
    "an-or-pattern-names-through-one-alternative",
    "",
    BODY,
    ["let w: Ordering = k", "let n = match k\n        Less | Ordering.Greater => 1\n        _ => 2"],
    [],
  ],
  [
    "a-declared-pattern-names-its-subject",
    "pattern same(value: Int): Int\n    view(value) = value\n    build(value) = value",
    BODY,
    ["let w: Int = k", "let n = match k\n        (0)same => 1\n        _ => 2"],
    [],
  ],
  // A bare integer pattern makes the parameter an `Int`, through `|` too.
  ["or-integer-patterns", "", BODY, ["let w: Int = k", "let n = match k\n        0 | 1 => 1\n        _ => 2"], []],
  // A bare integer pattern makes the parameter an `Int` through `as` too.
  ["as-integer", "", BODY, ["let w: BigInt = k", "let n = match k\n        0 as z => 1\n        _ => 2"], []],
  // Patterns that test nothing need no head, and are still judged (§7).
  ["guard-only", "", BODY, ["let w: Int = k", "let n = match k\n        x when x > 0 => 1\n        _ => 2"], []],
  [
    "guard-only-without-a-catch-all",
    "",
    BODY,
    ["let w: Int = k", "let n = match k\n        x when x > 0 => 1"],
    ["match is missing cases: `_`"],
  ],
  ["binder-only", "", BODY, ["let w: Int = k", "let n = match k\n        x => x"], []],
  // Nothing decides the head: refused alike in every order.
  ["door-only", "", BODY, ["let w: Ordering = k", "let n = match k\n        Less => 1\n        _ => 2"], [PARAMETER]],
  ["door-or-wildcard", "", BODY, ["let w: Ordering = k", "let n = match k\n        Less | _ => 1"], [PARAMETER]],
  // A declared pattern with a generic subject names no head, and an
  // exception's constructor fixes none: a `match` never takes `Exn`.
  [
    "a-generic-declared-pattern",
    "pattern ident\n    view(x) = x\n    build(x) = x",
    BODY,
    ["let w: Int = k", "let n = match k\n        (0)ident => 1\n        _ => 2"],
    [PARAMETER],
  ],
  ["an-exception-constructor", "exception Boom", BODY, ["let w: Exn = k", "let n = match k\n        Boom => 1\n        _ => 2"], [PARAMETER]],
  ["an-exception-constructor-under-as", "exception Boom", BODY, ["let w: Exn = k", "let n = match k\n        Boom as b => 1\n        _ => 2"], [PARAMETER]],
  ["an-or-of-an-exception-and-a-door", "exception Boom", BODY, ["let w: Ordering = k", "let n = match k\n        Boom | Less => 1\n        _ => 2"], [PARAMETER]],
  [
    "an-or-of-a-generic-declared-pattern-and-a-named-head",
    "pattern ident\n    view(x) = x\n    build(x) = x",
    BODY,
    ["let w: Ordering = k", "let n = match k\n        (Less)ident | Ordering.Greater => 1\n        _ => 2"],
    [],
  ],
  [
    "a-generic-declared-pattern-before-a-named-head",
    "pattern ident\n    view(x) = x\n    build(x) = x",
    BODY,
    ["let w: Ordering = k", "let n = match k\n        (Less)ident => 1\n        Ordering.Greater => 2\n        _ => 3"],
    [],
  ],
  // A generic declared pattern names no head, so an integer arm beside it is the test.
  [
    "a-generic-declared-pattern-beside-an-integer",
    "pattern ident\n    view(x) = x\n    build(x) = x",
    BODY,
    ["let w: Int = k", "let n = match k\n        0 => 1\n        (m)ident => 2"],
    [],
  ],
  // A refused `match`'s arms are read against nothing: the door says nothing
  // of the `Int` another line made, in either order.
  ["door-only-beside-another-type", "", BODY, ["let w: Int = k", "let n = match k\n        Less => 1\n        _ => 2"], [PARAMETER]],
  [
    "a-name-made-from-the-parameter",
    "",
    "let f(k) =\n    let a = k\n    {0}\n    {1}\n    ()",
    ["let w: Int = k", "let n = match a\n        0 => 1\n        _ => 2"],
    [named("a")],
  ],
  [
    "a-call",
    "",
    "let f(g) =\n    {0}\n    {1}\n    ()",
    ["let w: Int = g(1)", "let n = match g(1)\n        0 => 1\n        _ => 2"],
    [value("g(1)")],
  ],
  // A refused `match` makes no new name: its binding arm defaults nothing.
  [
    "a-call-with-a-binding-arm",
    "",
    "let f(g) =\n    {0}\n    {1}\n    ()",
    ["let w: Nat = g(1)", "let n = match g(1) + 0\n        0 => 1\n        x => 2"],
    [value("g(1) + 0")],
  ],
  [
    "a-loop-variable-of-an-untyped-source",
    "",
    "let f(xs) =\n    {0}\n    {1}\n    ()",
    ["let w: Vector(Int) = xs", "for x in xs\n        ignore(match x\n            0 => 1\n            _ => 2)"],
    [named("x")],
  ],
  // A lambda applied where it is written takes its argument's type, as a
  // `let` does: an undecided argument decides nothing, and the parameter is
  // not the lambda's own to make an `Int`.
  [
    "piped-untyped-value",
    "",
    "let f(v) =\n    {0}\n    {1}\n    ()",
    ["let w: BigInt = v", "let s = v |> match\n        0 => \"zero\"\n        _ => \"other\""],
    [PARAMETER],
  ],
  // `v |> L(w)` is `L(v, w)` (Operators §8): `x` is `v`'s.
  [
    "piped-into-an-applied-lambda's-own-call",
    "",
    "let f(v, w: Int) =\n    {0}\n    {1}\n    ()",
    ["let a: Int = v", "let s = v |> ((x, y) => x.show())(w)"],
    [SHOW_X],
  ],
  ["piped-into-an-applied-lambda's-own-call-decided", "", "let f(v: Int, w) =\n    {0}\n    {1}\n    ()", ["let a: Int = w", "let s = v |> ((x, y) => x.show())(w)"], []],
  // The whole, for a dot on a part: `[v]`'s element is `v`'s, which nothing decides.
  [
    "piped-a-vector-of-an-untyped-value",
    "",
    "let f(v) =\n    {0}\n    {1}\n    ()",
    ["let a: Int = v", "let s = [v] |> (xs) => Seq.map(xs, (x) => x.show())"],
    [SHOW_X],
  ],
  [
    "applied-to-an-untyped-value",
    "",
    "let f(v) =\n    {0}\n    {1}\n    ()",
    ["let w: BigInt = v", "let s = ((x) => match x\n        0 => \"zero\"\n        _ => \"other\")(v)"],
    [PARAMETER],
  ],
  // A `fun` block's members meet their siblings' calls before their own body
  // is read, so a member's parameter is not its own to make an `Int`.
  [
    "fun-block-members",
    "",
    "fun\n    {0}\n    {1}\nlet r: Bool = even(4)",
    [
      "even(k) = match k\n        0 => True\n        _ => odd(k - 1)",
      "odd(k) = match k\n        0 => False\n        _ => even(k - 1)",
    ],
    [PARAMETER, PARAMETER],
  ],
];

describe("no order of the lines decides what a `match` tests (Pattern Matching §6.1)", () => {
  for (const [name, prelude, template, lines, reports] of ORDERS) {
    test(name, () => {
      for (const order of permutations(lines)) {
        expect(projectDiagnostics(HEADER + (prelude === "" ? "" : prelude + "\n") + fill(template, order) + "\n"))
          .toEqual(reports);
      }
    });
  }
});

describe("a parameter a `match` tests with a number is an `Int` where it is made (Numeric Literals §4)", () => {
  test("its function takes an `Int`, which a narrower argument widens into and a wider one cannot", () => {
    expect(typeOf("let f(k) =\n    match k\n        0 => \"zero\"\n        _ => \"other\"\n", "f")).toBe("Int -> String");
    compiles("let f(k) =\n    match k\n        0 => \"zero\"\n        _ => \"other\"\nlet g(n: Nat): String = f(n)\n");
    const compiled = compileMain(
      HEADER + "let f(k) =\n    match k\n        0 => \"zero\"\n        _ => \"other\"\nlet g(): String = f(10n)\n",
    );
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual(["type mismatch: expected Int, found BigInt"]);
    expect(compiled.diagnostics[0]!.labels?.map(({ message }) => message)).toEqual([
      "`k` became an `Int` here: a `match` tests it with a number nothing had decided — write `k: BigInt`",
    ]);
  });

  test("a match function bound by name is one, and its report stands at `match`", () => {
    expect(typeOf("let g = match\n    0 => 1\n    _ => 2\n", "g")).toBe("Int -> Int");
    const source = HEADER + "let g = match\n    0 => 1\n    _ => 2\nlet r = g(10n)\n";
    const compiled = compileMain(source);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual(["type mismatch: expected Int, found BigInt"]);
    const label = compiled.diagnostics[0]!.labels![0]!;
    expect(source.slice(label.span.start.offset, label.span.end.offset)).toBe("match");
    expect(label.message).toBe(
      "this match function's parameter became an `Int` here: a pattern tests it with a number nothing had " +
        "decided — write the function's type where it is bound",
    );
  });

  test("a written type, a landing call, or a pattern naming the head decides instead", () => {
    expect(typeOf("let f(k: BigInt) =\n    match k\n        0 => \"zero\"\n        _ => \"other\"\n", "f"))
      .toBe("BigInt -> String");
    compiles(
      "let f(bigs: Vector(BigInt)): Vector(String) = Vector.fromSeq(Seq.map(bigs, match\n" +
        "    0 => \"zero\"\n    _ => \"other\"))\n",
    );
    expect(typeOf("let f(k) =\n    match k\n        0 => \"zero\"\n        1.5 => \"half\"\n        _ => \"other\"\n", "f"))
      .toBe("Float -> String");
  });

  test("through `as`, the bare integer is the test", () => {
    expect(typeOf("let f(k) =\n    match k\n        0 as z => z\n        _ => 2\n", "f")).toBe("Int -> Int");
  });

  test("a lone `fun`, recursive or not, makes its parameter an `Int` too", () => {
    expect(typeOf("fun down(k) = match k\n    0 => 0\n    _ => down(k - 1)\n", "down")).toBe("Int -> Int");
  });
});

describe("a pattern that names the head is read before a constructor the head's door resolves", () => {
  test("`Less` in an earlier arm meets the `Ordering` a later arm names, in either order of the lines", async () => {
    // Before, an earlier arm's door saw the head still open where the written
    // line came below, and its constructor was silently read as `_`.
    const arms = "match k\n        Less => 1\n        Ordering.Greater => 2\n        _ => 3";
    const exports = await runMain(
      HEADER +
        `let above(k) =\n    let w: Ordering = k\n    ${arms}\n` +
        `let below(k) =\n    let n = ${arms}\n    let w: Ordering = k\n    n\n` +
        `let alone(k) = ${arms.replaceAll("\n        ", "\n    ")}\n` +
        "export let a: Vector(Int) = [above(Ordering.Less), above(Ordering.Equal), above(Ordering.Greater)]\n" +
        "export let b: Vector(Int) = [below(Ordering.Less), below(Ordering.Equal), below(Ordering.Greater)]\n" +
        "export let c: Vector(Int) = [alone(Ordering.Less), alone(Ordering.Equal), alone(Ordering.Greater)]\n",
    );
    for (const name of ["a", "b", "c"]) expect([...exports[name] as Iterable<number>]).toEqual([1, 3, 2]);
  });

  test("within an or-pattern, the alternative that names the head is read first", async () => {
    const exports = await runMain(
      HEADER + "let f(k) =\n    match k\n        Less | Ordering.Greater => 1\n        _ => 2\n" +
        "export let a: Vector(Int) = [f(Ordering.Less), f(Ordering.Equal), f(Ordering.Greater)]\n",
    );
    expect([...exports["a"] as Iterable<number>]).toEqual([1, 2, 1]);
  });
});

describe("a lambda applied where it is written is read as a `let` of its argument (Method Syntax §3.1)", () => {
  test("a pipe into a match function means `match` on the piped value, in all three spellings", async () => {
    const spellings = [
      "value |> match\n        0 => \"zero\"\n        _ => \"other\"",
      "value |> (x) => match x\n        0 => \"zero\"\n        _ => \"other\"",
      "match value\n        0 => \"zero\"\n        _ => \"other\"",
    ];
    for (const spelling of spellings) {
      const exports = await runMain(
        HEADER + `let describe(value: BigInt): String =\n    ${spelling}\n` +
          "export let a: String = describe(0n)\nexport let b: String = describe(7n)\n",
      );
      expect([exports["a"], exports["b"]]).toEqual(["zero", "other"]);
    }
  });

  test("an argument that already reported says it once", () => {
    // Method Syntax §3.5's echo rule: the parameter takes its argument's type,
    // and the argument's own report is the one the reader needs.
    expect(projectDiagnostics(
      HEADER + "let f() =\n    let s = fromNat(3) |> (x) => match x\n        0 => 1\n        _ => 2\n    ()\n",
    )).toEqual(["no bare `fromNat`; write `Num.fromNat(3)`"]);
  });

  test("a dot call on the parameter dispatches where the argument's type is written", () => {
    compiles("let f(value: Int): String = value |> (x) => x.show()\n");
    compiles("let f(v: Vector(Int)): Int = ((x) => x.length())(v)\n");
  });
});

describe("a literal scrutinee takes `Int` where no pattern names its head (Method Syntax §3.3)", () => {
  test("`match 3` with `0` and `_` is an `Int` match; a `Float` pattern makes it a `Float` one", async () => {
    const exports = await runMain(
      HEADER +
        "export let a: String =\n    match 3\n        0 => \"zero\"\n        _ => \"other\"\n" +
        "export let b: String =\n    match 1.5\n        1.5 => \"half\"\n        _ => \"other\"\n" +
        "export let c: Int = (match 3\n    0 => [1]\n    _ => [2, 3]).length()\n",
    );
    expect([exports["a"], exports["b"], exports["c"]]).toEqual(["other", "half", 2]);
  });
});

describe("patterns that test nothing need no type (Pattern Matching §6.1)", () => {
  test("a guard-only `match` on an untyped parameter is generic, and runs at each type", async () => {
    const classify = "let classify(k) = match k\n    n when n < 0 => \"negative\"\n    _ => \"other\"\n";
    expect(typeOf(classify, "classify")).toBe("<a: (Num, Ord)> a -> String");
    const exports = await runMain(
      HEADER + classify + "export let a: String = classify(-5)\nexport let b: String = classify(2.5)\n",
    );
    expect([exports["a"], exports["b"]]).toEqual(["negative", "other"]);
  });

  test("a declared type variable is matched where nothing is tested, and refused where something is", () => {
    compiles(
      "export let describe<a: Show>(value: a): String = match value\n" +
        "    v when show(v) == \"\" => \"(empty)\"\n" +
        "    v => show(v)\n",
    );
    expect(projectDiagnostics(
      HEADER + "export let describe<a: Show>(value: a): String = match value\n    Less => \"less\"\n    _ => \"x\"\n",
    )).toEqual(["cannot match on a value of abstract type `a`; use the operations its constraints provide"]);
  });

  test("missing cases are judged at any type, a declared variable's included", () => {
    expect(projectDiagnostics(HEADER + "let classify(k) = match k\n    n when n < 0 => \"negative\"\n"))
      .toEqual(["match is missing cases: `_`"]);
    expect(projectDiagnostics(
      HEADER + "export let g<a: Show>(v: a): String = match v\n    x when show(x) == \"1\" => \"one\"\n",
    )).toEqual(["match is missing cases: `_`"]);
  });

  test("its arms are still judged: a binder after `_` is unreachable", () => {
    const reports = projectDiagnostics(HEADER + "let f(k) = match k\n    _ => 1\n    x => 2\n");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/unreachable/u);
  });
});

describe("the refusal names the fundamental spelling, and stands where the reader can see it", () => {
  test("a match function's refusal stands at `match`, its parameter occupying no source", () => {
    const source = HEADER + "let f = match\n    Less => 1\n    _ => 2\n";
    const compiled = compileMain(source);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([PARAMETER]);
    const primary = compiled.diagnostics[0]!.primary;
    expect(source.slice(primary.start.offset, primary.end.offset)).toBe("match");
  });

  test("each spelling compiles once the type is written", () => {
    compiles("let f(k: Ordering) =\n    match k\n        Less => 1\n        _ => 2\n");
    compiles("let f(g: (Int) -> Int) =\n    match g(1)\n        0 => 1\n        _ => 2\n");
    compiles("let f(v: BigInt) =\n    v |> match\n        0 => \"zero\"\n        _ => \"other\"\n");
    compiles("fun\n    even(k: Int): Bool = match k\n        0 => True\n        _ => odd(k - 1)\n" +
      "    odd(k: Int): Bool = match k\n        0 => False\n        _ => even(k - 1)\n");
  });
});
