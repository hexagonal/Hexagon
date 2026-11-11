/**
 * Conformance for types written in patterns, `(p: T)` (Pattern Matching §2.9),
 * and the binding annotation on a `let` pattern, `let p: T = e` (§6.3).
 *
 * A typed pattern is a claim: it tests nothing and converts nothing, so most of
 * the observations below compare a typed program with the program that means
 * the same thing without the type — its emission, its coverage, its run. The
 * rest are what the claim decides before `p` is checked (a number type, a
 * `match`'s head, a dot call's subject), the rules it reads through (the
 * evidence seat, the annotated arm), and the parentheses-only refusals, each
 * with the fixit whose edit compiles.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const HEADER = "module Main\n\n";

function compiled(source: string) {
  return compileMain(HEADER + source);
}

function messages(source: string): readonly string[] {
  return compiled(source).diagnostics.map(({ message }) => message);
}

/** The scheme the checker gave a binding the module declares, as it renders it. */
function scheme(source: string, name: string): string {
  const project = compiled(source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = project.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find((candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId);
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** `/main.hex`'s emitted JavaScript, blank lines dropped. */
function emission(source: string): string {
  const project = compiled(source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text.split("\n").filter((line) => line.trim() !== "").join("\n");
}

async function run(source: string): Promise<Record<string, unknown>> {
  expect(messages(source)).toEqual([]);
  return runMain(HEADER + source);
}

/**
 * The one diagnostic a program draws, and the program its fixes write: each
 * fix's edits applied to the source, in offset order from the end.
 */
function refusal(source: string): { readonly message: string; readonly fixed: readonly string[] } {
  const project = compiled(source);
  expect(project.diagnostics).toHaveLength(1);
  const [diagnostic] = project.diagnostics;
  const text = HEADER + source;
  const fixed = (diagnostic!.fixes ?? []).map(({ edits }) =>
    [...edits]
      .sort((left, right) => right.span.start.offset - left.span.start.offset)
      .reduce(
        (written, edit) => written.slice(0, edit.span.start.offset) + edit.replacement + written.slice(edit.span.end.offset),
        text,
      )
      .slice(HEADER.length)
  );
  return { message: diagnostic!.message, fixed };
}

const SHAPE = "union Shape =\n    | Circle(radius: Float)\n    | Square(side: Float)\n    | Label(text: String)\n";

/** A one-component declared pattern over an opaque record (Pattern Declarations §3.2). */
const USER_ID = "opaque record UserId = {n: Int}\n" +
  "fun unwrap(u: UserId): Int = u.n\n" +
  "fun wrap(n: Int): UserId = UserId({n = n})\n" +
  "pattern id(n: Int): UserId\n" +
  "    view = unwrap\n" +
  "    build = wrap\n";

/** Non-defaultable, so the evidence seat is observable (as in `ascription.test.ts`). */
const TAG = "constraint Tag<a> =\n" +
  "    label(value: a) -> String\n" +
  "honor Tag<String> =\n" +
  '    label(value) = "string"\n' +
  "fun describe<a: Tag>(value: a): String = label(value)\n";

test("the harness reports a broken module rather than passing it", () => {
  expect(messages("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("§2.9 where a type is written", () => {
  test("a tuple's component takes one in the tuple's own parentheses", async () => {
    const source = 'let (a: Float, b) = (1, "x")\nexport let out: Float = a / 2\n';
    expect(scheme(source, "a")).toBe("Float");
    expect(scheme(source, "b")).toBe("String");
    expect(await run(source)).toMatchObject({ out: 0.5 });
  });

  test("an element in parentheses of its own, and the whole tuple", () => {
    expect(scheme('let ((a: Float), b) = (1, "x")\nexport let out: Float = a\n', "a")).toBe("Float");
    expect(scheme('let ((a, b): (Float, String)) = (1, "x")\nexport let out: Float = a\n', "a")).toBe("Float");
    expect(scheme("let (((a: Int): Int), b) = (1, 2)\nexport let out: Int = a\n", "a")).toBe("Int");
  });

  test("a lambda's pattern parameter", async () => {
    const source = 'let f = ((k: String, v)) => k\nexport let out: String = f(("a", 1))\n';
    expect(scheme(source, "f")).toBe("((String, a)) -> String");
    expect(await run(source)).toMatchObject({ out: "a" });
  });

  test("a constructor's slot, a record field, a vector element and a declared component, each in its own parentheses", async () => {
    expect(await run("let g(o) = match o\n    Some((n: Int)) => n\n    None => 0\nexport let out: Int = g(Some(4))\n"))
      .toMatchObject({ out: 4 });
    expect(await run("let g(r) = match r\n    {total = (t: Float)} => t\nexport let out: Float = g({total = 2.5})\n"))
      .toMatchObject({ out: 2.5 });
    expect(await run("let g(xs) = match xs\n    [(first: Int), ...rest] => first\n    _ => 0\nexport let out: Int = g([5, 6])\n"))
      .toMatchObject({ out: 5 });
    expect(await run(USER_ID + "let f(k: UserId): Int = match k\n    ((n: Int))id => n\nexport let out: Int = f((7)id)\n"))
      .toMatchObject({ out: 7 });
  });

  test("the colon is looser than `|` and `as`", async () => {
    const or = SHAPE + "let size(x) = match x\n    (Circle(r) | Square(r): Shape) => r\n    Label(_) => 0.0\n" +
      "export let out: Float = size(Square(2.0))\n";
    expect(scheme(or, "size")).toBe("Shape -> Float");
    expect(await run(or)).toMatchObject({ out: 2 });
    const as = SHAPE + "let size(x) = match x\n    (Circle(r) as s: Shape) => r\n    _ => 0.0\n" +
      "export let out: Float = size(Circle(1.5))\n";
    expect(scheme(as, "size")).toBe("Shape -> Float");
  });

  test("a `match` and a `catch` arm's whole pattern, and a loop's", async () => {
    expect(await run(
      "exception Oops(code: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        (Oops(c): Exn) => c\n        _ => 0\n" +
        "export let out: Int = f()\n",
    )).toMatchObject({ out: 3 });
    expect(await run(
      "let g(): Float =\n    var total = 0.0\n    for (x: Float) in [1, 2]\n        total := total + x\n    total\nexport let out: Float = g()\n",
    )).toMatchObject({ out: 3 });
  });

  test("a hole is legal and leaves its part to inference", () => {
    expect(scheme("let (xs: Vector(_)) = [1, 2]\nexport let out: Int = 1\n", "xs")).toBe("Vector(Int)");
  });
});

describe("§2.9 the parentheses-only rule (§12's rows)", () => {
  const cases: readonly (readonly [string, string, string, string])[] = [
    [
      "a constructor's slot",
      "let g(o) = match o\n    Some(n: Int) => n\n    None => 0\nexport let out: Int = g(None)\n",
      "a type in a pattern goes in parentheses: `Some((n: Int))`",
      "let g(o) = match o\n    Some((n: Int)) => n\n    None => 0\nexport let out: Int = g(None)\n",
    ],
    [
      "a record field",
      "let g(r) = match r\n    {total = t: Float} => t\nexport let out: Float = g({total = 1.0})\n",
      "a type in a pattern goes in parentheses: `{total = (t: Float)}`",
      "let g(r) = match r\n    {total = (t: Float)} => t\nexport let out: Float = g({total = 1.0})\n",
    ],
    [
      "a vector element",
      "let g(xs) = match xs\n    [first: Int, ...rest] => first\n    _ => 0\nexport let out: Int = g([1])\n",
      "a type in a pattern goes in parentheses: `[(first: Int), ...rest]`",
      "let g(xs) = match xs\n    [(first: Int), ...rest] => first\n    _ => 0\nexport let out: Int = g([1])\n",
    ],
    [
      "a declared pattern's component",
      USER_ID + "let f(k: UserId): Int = match k\n    (n: Int)id => n\nexport let out: Int = f((7)id)\n",
      "a type in a pattern goes in parentheses: `((n: Int))id`",
      USER_ID + "let f(k: UserId): Int = match k\n    ((n: Int))id => n\nexport let out: Int = f((7)id)\n",
    ],
    [
      "a `match` arm's whole pattern",
      "let f(k) = match k\n    n: Int => n\nexport let out: Int = f(1)\n",
      "a type in a pattern goes in parentheses: `(n: Int)`",
      "let f(k) = match k\n    (n: Int) => n\nexport let out: Int = f(1)\n",
    ],
    [
      "a `catch` arm's whole pattern",
      "exception Oops(code: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        e: Exn => 0\nexport let out: Int = f()\n",
      "a type in a pattern goes in parentheses: `(e: Exn)`",
      "exception Oops(code: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        (e: Exn) => 0\nexport let out: Int = f()\n",
    ],
    [
      "a loop's pattern",
      "let g(): Int =\n    for x: Nat in [1, 2]\n        ignore(x)\n    0\nexport let out: Int = g()\n",
      "write the element's type in the pattern: `for (x: Nat) in [1, 2]`",
      "let g(): Int =\n    for (x: Nat) in [1, 2]\n        ignore(x)\n    0\nexport let out: Int = g()\n",
    ],
    [
      "a vector's rest",
      "let g(xs) = match xs\n    [a, ...rest: Vector(Int)] => a\n    _ => 0\nexport let out: Int = g([1])\n",
      "a rest takes the vector's type; type the whole: `([a, ...rest]: Vector(Int))`",
      "let g(xs) = match xs\n    ([a, ...rest]: Vector(Int)) => a\n    _ => 0\nexport let out: Int = g([1])\n",
    ],
    [
      "a declared pattern's argument in an expression (Pattern Declarations §3.2)",
      USER_ID + "export let out: Int = unwrap((7: Int)id)\n",
      "the list is an argument list; ascribe an argument in its own parentheses: `((7: Int))id`",
      USER_ID + "export let out: Int = unwrap(((7: Int))id)\n",
    ],
  ];
  for (const [where, source, message, fixed] of cases) {
    test(`${where}: refused, and the fixit's program compiles`, () => {
      const refused = refusal(source);
      expect(refused.message).toBe(message);
      expect(refused.fixed).toEqual([fixed]);
      expect(messages(fixed)).toEqual([]);
    });
  }

  test("two bare slots in one form: each report names and applies the form with both written", () => {
    for (
      const [source, rewritten, fixed] of [
        [
          "let g(xs) = match xs\n    [x: Int, y: Int] => x + y\n    _ => 0\nexport let out: Int = g([1, 2])\n",
          "[(x: Int), (y: Int)]",
          "let g(xs) = match xs\n    [(x: Int), (y: Int)] => x + y\n    _ => 0\nexport let out: Int = g([1, 2])\n",
        ],
        [
          "let g(r) = match r\n    {x = n: Int, y = m: Int} => n + m\nexport let out: Int = g({x = 1, y = 2})\n",
          "{x = (n: Int), y = (m: Int)}",
          "let g(r) = match r\n    {x = (n: Int), y = (m: Int)} => n + m\nexport let out: Int = g({x = 1, y = 2})\n",
        ],
      ] as const
    ) {
      const project = compiled(source);
      expect(project.diagnostics.map(({ message }) => message)).toEqual([
        `a type in a pattern goes in parentheses: \`${rewritten}\``,
        `a type in a pattern goes in parentheses: \`${rewritten}\``,
      ]);
      for (const diagnostic of project.diagnostics) {
        const [fix] = diagnostic.fixes!;
        const written = [...fix!.edits]
          .sort((left, right) => right.span.start.offset - left.span.start.offset)
          .reduce(
            (text, edit) => text.slice(0, edit.span.start.offset) + edit.replacement + text.slice(edit.span.end.offset),
            HEADER + source,
          );
        expect(written).toBe(HEADER + fixed);
      }
      expect(messages(fixed)).toEqual([]);
    }
  });

  test("`fault e: Exn` is refused in Exceptions §5.2's words, its fix removing the type", () => {
    const refused = refusal(
      "exception Oops(n: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        fault e: Exn => 1\n        _ => 0\n" +
        "export let out: Int = f()\n",
    );
    expect(refused.message).toBe(
      "a `fault` pattern is a whole catch arm's pattern, and binds an `Exn`; remove the type: `fault e`",
    );
    expect(refused.fixed).toEqual([
      "exception Oops(n: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        fault e => 1\n        _ => 0\n" +
        "export let out: Int = f()\n",
    ]);
    expect(messages(refused.fixed[0]!)).toEqual([]);
    // Under `as`, the `fault` pattern's own refusal is the arm's one report.
    expect(messages(
      "exception Oops(n: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        fault e as x: Exn => 1\n        _ => 0\n" +
        "export let out: Int = f()\n",
    )).toEqual(["a `fault` pattern is a whole catch arm's pattern"]);
  });

  test("a loop's refusal quotes a long iterable as `…`", () => {
    const refused = refusal(
      "let g(): Int =\n    var s = 0\n    for x: Int in Vector.map([1, 2, 3, 4], (y) => y * 2 + 1)\n" +
        "        s := s + x\n    s\nexport let out: Int = g()\n",
    );
    expect(refused.message).toBe("write the element's type in the pattern: `for (x: Int) in …`");
    expect(messages(refused.fixed[0]!)).toEqual([]);
  });

  test("a declared pattern's components in an expression, two of them", () => {
    const refused = refusal("import Rat\nexport let r: Rat.Rat = (1n: BigInt, 2n)rat\n");
    expect(refused.message).toBe(
      "the list is an argument list; ascribe an argument in its own parentheses: `((1n: BigInt), 2n)rat`",
    );
    expect(refused.fixed).toEqual(["import Rat\nexport let r: Rat.Rat = ((1n: BigInt), 2n)rat\n"]);
    expect(messages(refused.fixed[0]!)).toEqual([]);
  });

  test("a binder list on a `let` pattern: refused alone, with both exits", () => {
    const refused = refusal("let (a, b)<t: Num>: (t, t) = (1, 2)\nexport let out: Int = a + b\n");
    expect(refused.message).toBe(
      "a `let` pattern takes no binder list: it binds no single name, and a destructuring `let` " +
        "quantifies no constrained variable; remove `<t: Num>`, and write the concrete type you mean — " +
        "`let (a, b): (Int, Int) = …` — or remove the annotation",
    );
    expect(refused.fixed).toEqual([
      "let (a, b) = (1, 2)\nexport let out: Int = a + b\n",
      "let (a, b): (Int, Int) = (1, 2)\nexport let out: Int = a + b\n",
    ]);
    for (const fixed of refused.fixed) expect(messages(fixed)).toEqual([]);
  });

  test("a binder list names `Int` only for a binder its constraints call a number", () => {
    const reason = (list: string): string =>
      "a `let` pattern takes no binder list: it binds no single name, and a destructuring `let` " +
      `quantifies no constrained variable; remove \`${list}\`, and write the concrete type you mean, or remove the annotation`;
    for (
      const [source, list] of [
        ['let (a, b)<t: Show>: (t, t) = ("a", "b")\n', "<t: Show>"],
        ['let (a, b)<t>: (t, t) = ("a", "b")\n', "<t>"],
        ['let (a, b)<t: Num, u>: (t, u) = (1, "x")\n', "<t: Num, u>"],
      ] as const
    ) {
      const refused = refusal(source + "export let out: Int = 1\n");
      expect(refused.message).toBe(reason(list));
      expect(refused.fixed).toHaveLength(1);
      expect(messages(refused.fixed[0]!)).toEqual([]);
    }
    // A binder the annotation does not write says nothing of what it means.
    const unwritten = refusal("let (a, b)<t: Num, u>: (t, t) = (1, 2)\nexport let out: Int = a + b\n");
    expect(unwritten.fixed).toEqual([
      "let (a, b) = (1, 2)\nexport let out: Int = a + b\n",
      "let (a, b): (Int, Int) = (1, 2)\nexport let out: Int = a + b\n",
    ]);
    for (const fixed of unwritten.fixed) expect(messages(fixed)).toEqual([]);
  });
});

describe("§2.9 a claim: it tests nothing and converts nothing", () => {
  test("a typed program emits what the untyped one does", () => {
    const typed = emission(
      'let size = (3.0, 4.5)\nlet (width: Float, height: Float) = size\nlet g = ((k: String, v)) => k\n' +
        'let h(o) = match o\n    Some((s: String)) => s\n    None => ""\nexport let out: Float = width * height\n',
    );
    const untyped = emission(
      'let size = (3.0, 4.5)\nlet (width, height) = size\nlet g = ((k, v)) => k\n' +
        'let h(o) = match o\n    Some(s) => s\n    None => ""\nexport let out: Float = width * height\n',
    );
    expect(typed).toBe(untyped);
  });

  test("coverage and refutability read `p`", async () => {
    expect(messages("let g(o: Option(Int)): Int =\n    let (Some(x): Option(Int)) = o\n    x\nexport let out: Int = 1\n"))
      .toEqual(["this pattern can fail: `None`; use `match`"]);
    expect(await run("let g(o) = match o\n    Some((n: Int)) => n\n    None => 0\nexport let out: Int = g(None)\n"))
      .toMatchObject({ out: 0 });
  });

  test("a type the part does not have is refused, not converted", () => {
    expect(messages('let n: Int = 3\nlet (x: Float, s) = (n, "x")\nexport let out: Int = 1\n')).toHaveLength(1);
  });

  test("a failed claim reports once and leaves the pattern to read as `_`", () => {
    expect(messages(
      'let n: Int = 3\nlet g() = match (n, "x")\n    ((x: Float), s) => s\nexport let out: String = g()\n',
    )).toHaveLength(1);
    // At a `let`, `Some(x)` read as written would add "this pattern can fail".
    expect(messages("let (Some(x): Option(String)) = Some(1)\nexport let out: Int = 1\n")).toHaveLength(1);
    // A type the resolver refused is its one report: the arm below is reached.
    expect(messages(
      "union Shape =\n    | Circle(radius: Float)\n    | Square(side: Float)\n" +
        "let f(sh) = match sh\n    (s: Circel) => 1\n    _ => 0\nexport let out: Int = 1\n",
    )).toEqual(["unknown type `Circel`"]);
    // …and the head it was written to name is that report's echo (§6.1).
    expect(messages("let g(o) = match o\n    (Some(s): Foo) => 1\n    _ => 0\nexport let out: Int = g(Some(1))\n"))
      .toEqual(["unknown type `Foo`"]);
    // At a `catch` arm the claim is about the thrown `Exn`; one that disagrees
    // shadows nothing below it.
    expect(messages(
      "exception Oops(code: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        (e: String) => 0\n        Oops(c) => c\n" +
        "export let out: Int = f()\n",
    )).toEqual(["type mismatch: expected Exn, found String"]);
    // `Some(1)` read at the type claimed, or as written, would add a mismatch
    // or a missing `Some(_)`: the claim's report is the one.
    expect(messages(
      "let g(o: Option(Int)): Int = match o\n    (Some(1): Option(String)) => 0\n    None => 1\nexport let out: Int = g(None)\n",
    )).toHaveLength(1);
  });
});

describe("§2.9 it decides what it writes", () => {
  test("a number type nothing decided takes it", async () => {
    expect(scheme('let (ratio: Float, label) = (1, "full")\nexport let out: Float = ratio\n', "ratio")).toBe("Float");
    expect(scheme("let (n: BigInt) = 5\nexport let out: BigInt = n\n", "n")).toBe("BigInt");
    const loop = "let g(): Nat =\n    var total: Nat = 0\n    for (x: Nat) in [1, 2]\n        total := total + x\n    total\n" +
      "export let out: Nat = g()\n";
    expect(await run(loop)).toMatchObject({ out: 3 });
    // The same loop without the type defaults `x` to `Int`, which cannot enter `Nat`.
    expect(messages(loop.replace("(x: Nat)", "x"))).toEqual([
      "`x` is a `Int` and cannot enter `Nat`, so the addition could not run at `Nat`",
    ]);
  });

  test("a constructor only the head's door finds is found through the written type (§6.1 rule 2)", () => {
    const colours = ["/colors.hex", "module Colors\n\nexport union Colour =\n    | Red\n    | Green\n"] as const;
    const main = (pattern: string): string =>
      HEADER + `import Colors\nlet f(k) = match k\n    ${pattern} => 1\n    _ => 0\nexport let out: Int = f(Colors.Red)\n`;
    expect(compileFiles([colours, ["/main.hex", main("(Red: Colors.Colour)")]]).diagnostics.map(({ message }) => message))
      .toEqual([]);
    expect(compileFiles([colours, ["/main.hex", main("Red")]]).diagnostics).toHaveLength(1);
  });

  test("at a `match`, it names the head (§6.1 rule 2)", () => {
    expect(scheme("let f() = match 3\n    (n: Nat) => n\nexport let out: Nat = f()\n", "f")).toBe("() -> Nat");
    expect(scheme("let f() = match 3\n    n => n\nexport let out: Int = f()\n", "f")).toBe("() -> Int");
  });

  test("a box reads it as a written parameter type (Numeric Literals §4)", () => {
    // A lambda its call opens, at each spelling of the call: the claimed part
    // is the written type, and the untyped control's is `Int`.
    for (
      const [typed, untyped, type, control] of [
        ['Vector.map([(1, "a")], ((k: Nat, v)) => k)', 'Vector.map([(1, "a")], ((k, v)) => k)', "Vector(Nat)", "Vector(Int)"],
        ['[(1, "a")].map(((k: Nat, v)) => k)', '[(1, "a")].map(((k, v)) => k)', "Vector(Nat)", "Vector(Int)"],
        ["Some(1).map(((x: Nat)) => x)", "Some(1).map((x) => x)", "Option(Nat)", "Option(Int)"],
        ['(1, "a") |> ((k: Nat, v)) => k', '(1, "a") |> ((k, v)) => k', "Nat", "Int"],
      ] as const
    ) {
      expect(scheme(`let o = ${typed}\nexport let out: ${type} = o\n`, "o")).toBe(type);
      expect(scheme(`let o = ${untyped}\nexport let out: ${control} = o\n`, "o")).toBe(control);
    }
    // A constructor's slot: only the slot the type is written over is claimed.
    const pair = "union Pair(a, b) = | Pair(a, b)\n";
    expect(scheme(pair + "let o = Option.map(Some(Pair(1, 2)), (Pair((a: Nat), b)) => a)\nexport let out: Option(Nat) = o\n", "o"))
      .toBe("Option(Nat)");
    expect(scheme(pair + "let o = Option.map(Some(Pair(1, 2)), (Pair((a: Nat), b)) => b)\nexport let out: Option(Int) = o\n", "o"))
      .toBe("Option(Int)");
    // An untyped sibling is a name as it is without the type: its dot call is decided.
    expect(messages('let o = Vector.map([(1, "a")], ((k: Nat, v)) => v.length())\nexport let out: Vector(Int) = o\n')).toEqual([]);
    expect(messages(pair + "let o = Option.map(Some(Pair(1, 2)), (Pair((a: Nat), b)) => b.show())\nexport let out: Int = 1\n"))
      .toEqual([]);
  });

  test("where a box makes a pattern parameter's number an `Int`, the label names the pattern", () => {
    const [diagnostic] = compiled("let o = Vector.map([(1, 2)], ((k, v)) => k)\nexport let p: Vector(Nat) = o\n").diagnostics;
    expect(diagnostic!.message).toBe("type mismatch: expected Nat, found Int");
    expect(diagnostic!.labels?.map(({ message }) => message)).toEqual([
      "a number in `(k, v)` became an `Int` here: the number reached only the lambda's input — write `((k, v): (Nat, Int))`",
    ]);
    // What the label names compiles.
    expect(messages("let o = Vector.map([(1, 2)], (((k, v): (Nat, Int))) => k)\nexport let p: Vector(Nat) = o\n")).toEqual([]);
  });

  test("a type written over one part leaves its untyped siblings as they are without it", () => {
    // At a `match`: each sibling is decided, and a number in one is an `Int`.
    for (
      const [arms, scrutinee] of [
        ['((a: Nat), b) => b.length()', '(1, "x")'],
        ["(a, (b: Nat)) => a.show().length()", "(1, 2)"],
        ["{a = (x: Nat), b} => b.show().length()", "{a = 1, b = 2}"],
        ["Some(((a: Nat), b)) => b.show().length()\n    _ => 0", "Some((1, 2))"],
        ["((a, b): (Nat, _)) => b.show().length()", "(1, 2)"],
        ["[(a: Nat), b] => b.show().length()\n    _ => 0", "[1, 2]"],
      ] as const
    ) {
      expect(messages(`let f() = match ${scrutinee}\n    ${arms}\nexport let out: Int = f()\n`)).toEqual([]);
    }
    expect(scheme('let f() = match Some((1, 2))\n    Some(((a: Nat), b)) => b\n    _ => 0\nexport let out: Int = f()\n', "f"))
      .toBe("() -> Int");
    // Another arm over the claimed part reads the written type.
    expect(scheme("let f() = match (1, 2)\n    ((a: Nat), 0) => a\n    (c, d) => c\nexport let out: Nat = f()\n", "f"))
      .toBe("() -> Nat");
    // At a loop, through a constructor's slots.
    const two = "union Two(a, b) = | Two(a, b)\n";
    expect(scheme(
      two + 'let g() =\n    var s = ""\n    for Two((x: Nat), y) in [Two(1, 2)]\n        s := y.show()\n    s\nexport let out: String = g()\n',
      "g",
    )).toBe("() -> String");
    expect(scheme(
      two + "let g() =\n    var s = 0\n    for Two((x: Nat), y) in [Two(1, 2)]\n        let z: Nat = x\n        s := y\n    s\n" +
        "export let out: Int = g()\n",
      "g",
    )).toBe("() -> Int");
  });

  test("a hole claims nothing, and its part is what it is without the type", () => {
    expect(scheme("let f() = match 3\n    (n: _) => n.show()\nexport let out: String = f()\n", "f")).toBe("() -> String");
    // A hole that tests nothing leaves a `match` that needs no head.
    expect(scheme('let f(x) = match x\n    (v: _) when show(v) == "" => 1\n    _ => 2\nexport let out: Int = f(1)\n', "f"))
      .toBe("<a: Show> a -> Int");
    // A head written over a hole decides the head, and a dot call needs no more.
    expect(scheme("let f = (((xs: Vector(_)), n)) => xs.length()\nexport let out: Int = f(([1], 2))\n", "f"))
      .toBe("((Vector(a), b)) -> Int");
  });

  test("a name it binds has a written type for a dot call (Method Syntax §3.1)", () => {
    const undecided = "the program's text does not decide `k`'s type here, so `.length(…)` cannot tell whose `length` it is";
    expect(messages('let f = ((k, v)) => k.length()\nexport let out: Int = f(("ab", 1))\n')[0]).toContain(undecided);
    expect(messages('let f = ((k: String, v)) => k.length()\nexport let out: Int = f(("ab", 1))\n')).toEqual([]);
    // Over the name or around it, read down to its part.
    expect(messages('let f = (((k, v): (String, Int))) => k.length()\nexport let out: Int = f(("ab", 1))\n')).toEqual([]);
    expect(messages(
      'let g(o) = match o\n    (Some(s): Option(String)) => s.length()\n    _ => 0\nexport let out: Int = g(Some("ab"))\n',
    )).toEqual([]);
    expect(messages(
      "record Point = {x: Int, y: Int}\nlet g = ((Point({x = a, y = b}): Point)) => a.show()\n" +
        "export let out: String = g(Point({x = 1, y = 2}))\n",
    )).toEqual([]);
    // A `let` pattern's binding annotation, and a loop's element.
    expect(messages('let g(p) =\n    let (k, v): (String, Int) = p\n    k.length()\nexport let out: Int = g(("abc", 1))\n'))
      .toEqual([]);
    expect(messages(
      "let g(xs) =\n    var n = 0\n    for (s: String) in xs\n        n := n + s.length()\n    n\n" +
        'export let out: Int = g(["ab", "c"])\n',
    )).toEqual([]);
    // An `as` stands on its pattern's part, and a rest is the vector's.
    expect(messages('let f = (((k: String) as key, v)) => key.length()\nexport let out: Int = f(("ab", 1))\n')).toEqual([]);
    expect(messages(
      "let g(xs) = match xs\n    ([first, ...rest]: Vector(String)) => rest.length()\n    _ => 0\n" +
        'export let out: Int = g(["a", "b"])\n',
    )).toEqual([]);
    // A hole writes nothing.
    expect(messages('let f = (((k, v): (_, Int))) => k.length()\nexport let out: Int = f(("ab", 1))\n')[0])
      .toContain(undecided);
    expect(messages(
      "let g(o) = match o\n    (Some(s): Option(_)) => s.length()\n    _ => 0\nexport let out: Int = 1\n",
    )[0]).toContain("the program's text does not decide `s`'s type here");
  });
});

describe("§2.9 the type's variables are the declaration's", () => {
  test("a written variable is rigid and stays general", () => {
    expect(scheme("let pairUp((x: a), y) = (x, y)\nexport let out: Int = 1\n", "pairUp")).toBe("(a, b) -> (a, b)");
  });

  test("a literal that would pin one is refused, worded for the pattern", () => {
    const message = "`a` is a declared type variable, but `42` can be only a `Num` type; write the concrete type " +
      "you mean in the pattern — `(n: Int)` — or remove the type";
    expect(messages('let (n: a, s) = (42, "x")\nexport let out: Int = 1\n')).toEqual([message]);
    expect(messages('let ((n: a), s) = (42, "x")\nexport let out: Int = 1\n')).toEqual([message]);
  });

  test("it reads through for the evidence seat (Functions §8.2)", async () => {
    const source = TAG + 'let (g: (a) -> String) = describe\nexport let out: String = g("s")\n';
    expect(scheme(source, "g")).toBe("<a: Tag> a -> String");
    expect((await run(source)).out).toBe("string");
  });
});

describe("§6.3 `let p: T = e`", () => {
  test("the binding's annotation is the home of its conversions", async () => {
    expect(await run('let n: Int = 3\nlet (a, b): (BigInt, String) = (n, "x")\nexport let out: BigInt = a\n'))
      .toMatchObject({ out: 3n });
    expect(scheme('let n: Int = 3\nlet (a, b): (Float, String) = (n, "x")\nexport let out: Float = a\n', "a"))
      .toBe("Float");
  });

  test("a bare binder in parentheses takes one too", () => {
    expect(scheme("let (g): Int = 1\nexport let out: Int = g\n", "g")).toBe("Int");
  });

  test("the names generalize at the scrutinee", async () => {
    const source = 'let (f, n): ((a) -> a, Int) = ((x) => x, 1)\nexport let out: String = f("s")\nexport let out2: Int = f(n)\n';
    expect(scheme(source, "f")).toBe("a -> a");
    expect(await run(source)).toMatchObject({ out: "s", out2: 1 });
  });

  test("the annotated arm: a declared variable the destructuring rule declines", () => {
    expect(messages(TAG + 'let (g, n): ((a) -> String, Int) = (describe, 1)\nexport let out: String = g("s")\n')).toEqual([
      "`a` is a declared type variable, but a binding whose type is not a function cannot carry its `Tag` " +
        "constraint — evidence rides only a function's trailing parameters; annotate at a concrete type, or remove " +
        "the annotation",
    ]);
    // Both exits compile.
    expect(messages(TAG + 'let (g, n): ((String) -> String, Int) = (describe, 1)\nexport let out: String = g("s")\n'))
      .toEqual([]);
    expect(messages(TAG + 'let (g, n) = (describe, 1)\nexport let out: String = g("s")\n')).toEqual([]);
  });
});

describe("colours in a pattern's type, until they are ruled (#1510)", () => {
  test("a following arrow is refused and names the constant spelling", () => {
    const refused = messages("let f(x: Int): Int = x\nlet ((m: (Int) >-> Int), n) = (f, 1)\nexport let out: Int = 1\n");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("a following arrow is not written in a pattern's type");
    expect(refused[0]).toContain("`(Int) -> Int`");
  });

  test("a written arrow is the part's own", async () => {
    const source = "let f(x: Int): Int = x\nlet ((m: (Int) -> Int), n) = (f, 1)\nexport let out: Int = m(n)\n";
    expect(scheme(source, "m")).toBe("Int -> Int");
    expect(await run(source)).toMatchObject({ out: 1 });
  });
});
