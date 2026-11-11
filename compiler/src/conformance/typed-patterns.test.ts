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

/** The program a diagnostic's first fix writes: its edits applied in offset order from the end. */
function applied(source: string, diagnostic: ReturnType<typeof compiled>["diagnostics"][number]): string {
  return [...diagnostic.fixes![0]!.edits]
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce(
      (written, edit) => written.slice(0, edit.span.start.offset) + edit.replacement + written.slice(edit.span.end.offset),
      HEADER + source,
    )
    .slice(HEADER.length);
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

  test("a refusal around another names and applies the inner one's rewrite too", () => {
    for (
      const [source, messages_, fixed] of [
        [
          "let f(o) = match o\n    Some(Some(n: Int): Option(Int)) => n\n    _ => 0\nexport let out: Int = f(None)\n",
          ["`Some((Some((n: Int)): Option(Int)))`", "`Some((n: Int))`"],
          "let f(o) = match o\n    Some((Some((n: Int)): Option(Int))) => n\n    _ => 0\nexport let out: Int = f(None)\n",
        ],
        [
          "let f(o) = match o\n    Some(n: Int): Option(Int) => n\n    _ => 0\nexport let out: Int = f(None)\n",
          ["`(Some((n: Int)): Option(Int))`", "`Some((n: Int))`"],
          "let f(o) = match o\n    (Some((n: Int)): Option(Int)) => n\n    _ => 0\nexport let out: Int = f(None)\n",
        ],
      ] as const
    ) {
      const project = compiled(source);
      expect(project.diagnostics.map(({ message }) => message)).toEqual(
        messages_.map((rewrite) => `a type in a pattern goes in parentheses: ${rewrite}`),
      );
      // The outer report's fix compiles alone.
      const [edit] = project.diagnostics[0]!.fixes![0]!.edits;
      const written = (HEADER + source).slice(0, edit!.span.start.offset) + edit!.replacement +
        (HEADER + source).slice(edit!.span.end.offset);
      expect(written).toBe(HEADER + fixed);
      expect(messages(fixed)).toEqual([]);
    }
    // A vector whose rest takes a type is rewritten whole, its elements' types written in it.
    const project = compiled("let g(xs) = match xs\n    [x: Int, ...rest: Vector(Int)] => x\n    _ => 0\nexport let out: Int = g([1])\n");
    const whole = "`([(x: Int), ...rest]: Vector(Int))`";
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      `a type in a pattern goes in parentheses: ${whole}`,
      `a rest takes the vector's type; type the whole: ${whole}`,
    ]);
    for (const diagnostic of project.diagnostics) {
      expect(diagnostic.fixes![0]!.edits.map(({ replacement }) => replacement)).toEqual(["([(x: Int), ...rest]: Vector(Int))"]);
    }
    expect(messages("let g(xs) = match xs\n    ([(x: Int), ...rest]: Vector(Int)) => x\n    _ => 0\nexport let out: Int = g([1])\n"))
      .toEqual([]);
    // A bare type around such a vector: the wider rewrite is the outer one.
    const around = "let g(xs) = match xs\n    [a, ...r: Vector(Int)]: Vector(Int) => a\n    _ => 0\nexport let out: Int = g([1])\n";
    const aroundFixed = around.replace("[a, ...r: Vector(Int)]: Vector(Int)", "(([a, ...r]: Vector(Int)): Vector(Int))");
    const [outer] = compiled(around).diagnostics;
    expect(outer!.message).toBe("a type in a pattern goes in parentheses: `(([a, ...r]: Vector(Int)): Vector(Int))`");
    expect(applied(around, outer!)).toBe(aroundFixed);
    expect(messages(aroundFixed)).toEqual([]);
  });

  test("a sibling's refusal is named and applied by the form around both", () => {
    for (
      const [source, rewritten] of [
        [
          "let f(xs) = match xs\n    [Some(a: Int), b: Option(Int)] => a\n    _ => 0\nexport let out: Int = f([None])\n",
          "[Some((a: Int)), (b: Option(Int))]",
        ],
        [
          "let f(r) = match r\n    {a = Some(n: Int), b = m: Int} => m\n    _ => 0\nexport let out: Int = f({a = None, b = 1})\n",
          "{a = Some((n: Int)), b = (m: Int)}",
        ],
      ] as const
    ) {
      const project = compiled(source);
      const outer = project.diagnostics.find(({ message }) => message.includes(rewritten))!;
      expect(outer.message).toBe(`a type in a pattern goes in parentheses: \`${rewritten}\``);
      expect(outer.fixes![0]!.message).toBe(`write \`${rewritten}\``);
      const fixed = applied(source, outer);
      expect(messages(fixed)).toEqual([]);
      expect(fixed).toContain(rewritten);
    }
    // A form written over several lines is quoted in the report, and its fix's title, read on one line, names no text.
    const lines = "union Two = | Two(Option(Int), Int)\nlet f(o) = match o\n    Two(\n        Some(a: Int),\n        b: Int\n    ) => b\n" +
      "    _ => 0\nexport let out: Int = f(Two(None, 1))\n";
    const across = compiled(lines).diagnostics.find(({ message }) => message.includes("Two("))!;
    expect(across.message).toBe(
      "a type in a pattern goes in parentheses: `Two(\n        Some((a: Int)),\n        (b: Int)\n    )`",
    );
    expect(across.fixes![0]!.message).toBe("write the types in parentheses");
    expect(messages(applied(lines, across))).toEqual([]);
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
    // Wherever else a `fault` pattern is refused, a type written over it is
    // part of the same mistake, and the program reports what it does without
    // the type: at a `match` arm's top (under `as` and `|` too), in
    // parentheses, in a slot, and at a loop.
    for (
      const [typed, untyped] of [
        ["let f(x: Int): Int = match x\n    fault e: Exn => 1\n    _ => 0\n", "fault e: Exn", "fault e"],
        ["let f(x: Int): Int = match x\n    fault e as y: Exn => 1\n    _ => 0\n", "fault e as y: Exn", "fault e as y"],
        [
          "exception Oops(n: Int)\nlet f(x: Int): Int = match x\n    fault e | Oops(_): Exn => 1\n    _ => 0\n",
          "fault e | Oops(_): Exn",
          "fault e | Oops(_)",
        ],
        ["let f(x: Int): Int = match x\n    (fault e: Exn) => 1\n    _ => 0\n", "(fault e: Exn)", "(fault e)"],
        ["let f(x: Option(Int)): Int = match x\n    Some(fault e: Exn) => 1\n    _ => 0\n", "fault e: Exn", "fault e"],
        ["let f(x: (Int, Int)): Int = match x\n    (fault e: Exn, b) => b\n", "fault e: Exn", "fault e"],
        ["let g(): Int =\n    for fault _: Exn in [1]\n        ignore(1)\n    0\n", "fault _: Exn", "fault _"],
        ["let o = Vector.map([1], ((fault e: Exn)) => 0)\n", "(fault e: Exn)", "(fault e)"],
        // Through the pattern's own parentheses around it.
        ["let f(x: Int): Int = match x\n    (fault e): Exn => 1\n    _ => 0\n", "(fault e): Exn", "(fault e)"],
        ["let f(x: Int): Int = match x\n    ((fault e)): Exn => 1\n    _ => 0\n", "((fault e)): Exn", "((fault e))"],
        ["let f(x: Int): Int = match x\n    (fault e) as y: Exn => 1\n    _ => 0\n", "(fault e) as y: Exn", "(fault e) as y"],
        ["let f(x: Option(Int)): Int = match x\n    Some((fault e): Exn) => 1\n    _ => 0\n", "(fault e): Exn", "(fault e)"],
        ["let g(): Int =\n    for (fault _): Exn in [1]\n        ignore(1)\n    0\n", "(fault _): Exn", "(fault _)"],
        [
          "exception Oops(n: Int)\nlet f(): Int = try throw^(Oops(3))\n    catch\n        (fault e): Exn => 1\n        _ => 0\n",
          "(fault e): Exn",
          "(fault e)",
        ],
      ].map(([source, written, without]) => [source!, source!.replace(written!, without!)] as const)
    ) {
      expect(messages(typed)).toEqual(messages(untyped));
      expect(messages(typed)[0]).toBe("a `fault` pattern is a whole catch arm's pattern");
    }
    expect(messages(
      "let f(x: Int): Int = match x\n    fault e: Exn => 1\n    _ => 0\nexport let out: Int = f(1)\n",
    )).toEqual(["a `fault` pattern is a whole catch arm's pattern"]);
  });

  test("a type over a literal refused where it was read is a cause of its own", () => {
    // The literal's refusal keeps its `n` fix, which the written type reaches,
    // and the bare type is refused beside it.
    expect(messages("let f(x) = match x\n    99999999999999999999: BigInt => 1\n    _ => 0\nexport let out: Int = f(1n)\n"))
      .toEqual([
        "integer literal exceeds Int range; add `n` for a BigInt",
        "a type in a pattern goes in parentheses: `(99999999999999999999: BigInt)`",
      ]);
    expect(messages("let f(x) = match x\n    1e999: Float => 1\n    _ => 0\nexport let out: Int = f(1.0)\n")).toEqual([
      "Float literal is too large; use `Float.infinity`",
      "a type in a pattern goes in parentheses: `(1e999: Float)`",
    ]);
  });

  test("a loop's refusal names and applies an inner refusal's rewrite", () => {
    const source = "let g(): Int =\n    var s = 0\n    for {a = n: Int}: {a: Int} in [{a = 1}]\n        s := n\n    s\n" +
      "export let out: Int = g()\n";
    const loop = compiled(source).diagnostics.find(({ message }) => message.startsWith("write the element's type"))!;
    expect(loop.message).toBe("write the element's type in the pattern: `for ({a = (n: Int)}: {a: Int}) in [{a = 1}]`");
    const fixed = applied(source, loop);
    expect(fixed).toBe(source.replace("{a = n: Int}: {a: Int}", "({a = (n: Int)}: {a: Int})"));
    expect(messages(fixed)).toEqual([]);
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
    // A refused part of a written type is that one report, and the rest of the type still decides.
    expect(messages("let ((x, y): (Foo, Int)) = (1, 2)\nexport let v: String = y.show()\n")).toEqual(["unknown type `Foo`"]);
    expect(messages("let f() = match (1, 2)\n    ((x, y): (Foo, Int)) => y.show()\nexport let out: String = f()\n"))
      .toEqual(["unknown type `Foo`"]);
    // …and the head it was written to name is that report's echo (§6.1),
    // a head only the door would find included.
    expect(messages("let g(o) = match o\n    (Some(s): Foo) => 1\n    _ => 0\nexport let out: Int = g(Some(1))\n"))
      .toEqual(["unknown type `Foo`"]);
    const colours = ["/colors.hex", "module Colors\n\nexport union Colour =\n    | Red\n    | Green\n"] as const;
    expect(compileFiles([
      colours,
      ["/main.hex", HEADER + "import Colors\nlet f(k) = match k\n    (Red: Colour) => 1\n    _ => 0\nexport let out: Int = f(Colors.Red)\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual(["unknown type `Colour`"]);
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

  test("a declared pattern under a box's claim is read through it, as the label's rewrite says", () => {
    const untyped = compiled("import Rat\nlet o = Some(1).map((((n, d)rat)) => n.show())\nexport let out: Option(String) = o\n");
    expect(untyped.diagnostics.flatMap(({ labels }) => labels ?? []).map(({ message }) => message)).toEqual([
      "a number in `((n, d)rat)` became an `Int` here: the number reached only the lambda's input — write `(((n, d)rat): Rat)`",
    ]);
    expect(scheme("import Rat\nlet o = Some(1).map(((((n, d)rat): Rat)) => n.show())\nexport let out: Option(String) = o\n", "o"))
      .toBe("Option(String)");
  });

  test("where a box makes a pattern parameter's number an `Int`, the label names the pattern", () => {
    const [diagnostic] = compiled("let o = Vector.map([(1, 2)], ((k, v)) => k)\nexport let p: Vector(Nat) = o\n").diagnostics;
    expect(diagnostic!.message).toBe("type mismatch: expected Nat, found Int");
    expect(diagnostic!.labels?.map(({ message }) => message)).toEqual([
      "a number in `(k, v)` became an `Int` here: the number reached only the lambda's input — write `((k, v): (Nat, Int))`",
    ]);
    // What the label names compiles.
    expect(messages("let o = Vector.map([(1, 2)], (((k, v): (Nat, Int))) => k)\nexport let p: Vector(Nat) = o\n")).toEqual([]);
    // A part that is the empty tuple is written `Unit`.
    const [unit] = compiled("let o = Vector.map([(1, ())], ((k, u)) => k)\nexport let p: Vector(Nat) = o\n").diagnostics;
    expect(unit!.labels?.map(({ message }) => message)).toEqual([
      "a number in `(k, u)` became an `Int` here: the number reached only the lambda's input — write `((k, u): (Nat, Unit))`",
    ]);
    expect(messages("let o = Vector.map([(1, ())], (((k, u): (Nat, Unit))) => k)\nexport let p: Vector(Nat) = o\n")).toEqual([]);
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

  test("what a type writes is claimed through each form, and through each written type", () => {
    // Under `as`, in each alternative of an or-pattern, and inside a typed pattern.
    for (
      const [arms, scrutinee] of [
        ["(((a: Nat) as c), b) => c", "(1, 2)"],
        ["((a: Nat), 0) | ((a: Nat), _) => a", "(1, 2)"],
        ["(Some((a: Nat)): Option(_)) => a\n    _ => 0", "Some(1)"],
        // Down through a written type's tuple, record, vector and declarations.
        ["({a, b}: {a: Nat, b: _}) => a", "{a = 1, b = 2}"],
        ["([(a, b)]: Vector((Nat, _))) => a\n    _ => 0", "[(1, 2)]"],
        ["(Some((a, b)): Option((Nat, _))) => a\n    _ => 0", "Some((1, 2))"],
        // The one alternative that writes a type claims for both.
        ["(a, 0) | ((a: Nat), _) => a", "(1, 2)"],
      ] as const
    ) {
      expect(scheme(`let f() = match ${scrutinee}\n    ${arms}\nexport let out: Nat = f()\n`, "f")).toBe("() -> Nat");
    }
    expect(scheme(
      "record Pt(a, b) = {x: a, y: b}\nlet f() = match Pt({x = 1, y = 2})\n    (Pt({x, y}): Pt(Nat, _)) => x\n" +
        "export let out: Nat = f()\n",
      "f",
    )).toBe("() -> Nat");
    // Down through a written collection's and `Nullable`'s parts, at a loop, a `match` and a box.
    const map = 'Map.fromVector([("a", 1)])';
    expect(scheme(
      `let g() =\n    var s = 0\n    for (m: Map(_, Nat)) in [${map}]\n        s := m.size()\n    s\nexport let out: Int = g()\n`,
      "g",
    )).toBe("() -> Int");
    expect(scheme(
      `let f() = match Some(${map})\n    (Some(m): Option(Map(_, Nat))) => m.size()\n    _ => 0\nexport let out: Int = f()\n`,
      "f",
    )).toBe("() -> Int");
    expect(scheme(`let o = Vector.map([${map}], ((m: Map(_, Nat))) => m.size())\nexport let out: Vector(Int) = o\n`, "o"))
      .toBe("Vector(Int)");
    expect(scheme(
      "let g() =\n    var s = 0\n    for (t: Set((Nat, _))) in [Set.fromVector([(1, 2)])]\n        s := t.size()\n    s\n" +
        "export let out: Int = g()\n",
      "g",
    )).toBe("() -> Int");
    expect(scheme(
      "let o = Vector.map([Nullable.fromOption(Some((1, 2)))], ((v: Nullable((Nat, _)))) => Nullable.isNullish(v))\n" +
        "export let out: Vector(Bool) = o\n",
      "o",
    )).toBe("Vector(Bool)");
    // `Array`, `JsSet` and `JsMap` (which a `match` cannot take apart yet) at a box, and a `Map`'s key.
    for (
      const [value, written, type] of [
        ["Vector.toArray([(1, 2)])", "Array((Nat, _))", "Array((Nat, Int))"],
        ["JsSet.fromSeq([(1, 2)].toSeq())", "JsSet((Nat, _))", "JsSet((Nat, Int))"],
        ['JsMap.fromSeq([("a", 1)].toSeq())', "JsMap(_, Nat)", "JsMap(String, Nat)"],
        ['Map.fromVector([(1, "a")])', "Map(Nat, _)", "Map(Nat, String)"],
      ] as const
    ) {
      expect(scheme(`let o = Vector.map([${value}], ((t: ${written})) => t)\n`, "o")).toBe(`Vector(${type})`);
    }
    expect(scheme(
      `let f() = match Some(Map.fromVector([(1, "a")]))\n    Some((t: Map(Nat, _))) => Some(t)\n    _ => None\n`,
      "f",
    )).toBe("() -> Option(Map(Nat, String))");
    expect(scheme(
      "let g() =\n    var s = 0\n    for (t: Array((Nat, _))) in [Vector.toArray([(1, 2)])]\n        s := t.length()\n    s\n",
      "g",
    )).toBe("() -> Int");
    // A constructor only the head's door finds is read through its declaration.
    const pairs = ["/pairs.hex", "module Pairs\n\nexport union Pair(a, b) =\n    | P(a, b)\n"] as const;
    expect(compileFiles([
      pairs,
      ["/main.hex", HEADER + "import Pairs\nlet f() = match Pairs.P(1, 2)\n    P((a: Nat), b) => a\nexport let out: Nat = f()\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
    // A function an arm takes apart beside a claimed part is called as it is without the type.
    expect(scheme(
      "let g(x: Int): Int = x + 1\nlet f() = match (1, g)\n    ((a: Nat), h) => h(2)\nexport let out: Int = f()\n",
      "f",
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

const WORLD = 'extern from "./world.js"\n    export fun save(s: String) ->! Unit\n' +
  'let save0(): Unit = save!("x")\nlet noop(): Unit = ()\nlet run(cb: () ->! Unit): Unit = cb!()\n';
const OUT = "export let out: Int = 0\n";

describe("§2.9 a function fits the claim, at every position (#1510)", () => {
  test("a pure function fits a `->!` claim at a `match` and a `for`, as at a `let`", () => {
    for (const body of [
      "let g(x: (() -> Unit, Int)): Unit = match x\n    ((f: () ->! Unit), n) => f!()\n",
      "let x = (noop, 1)\nlet g(): Unit = match x\n    ((f: () ->! Unit), n) => f!()\n",
      "let g(o: Option(() -> Unit)): Unit = match o\n    Some((f: () ->! Unit)) => f!()\n    None => ()\n",
      "let mk(): (() -> Unit, Int) = (noop, 1)\nlet g(): Unit = match mk()\n    ((f: () ->! Unit), n) => f!()\n",
      "let g(xs: Vector(() -> Unit)): Unit =\n    for (f: () ->! Unit) in xs\n        f!()\n",
      "let xs = [noop]\nlet g(): Unit =\n    for (f: () ->! Unit) in xs\n        f!()\n",
      "let g(x: (() -> Unit, Int)): Unit =\n    let ((f: () ->! Unit), n) = x\n    f!()\n",
      "let g(x: (() -> Unit, Int)): Unit =\n    let ((f: () ->! Unit), n): (() -> Unit, Int) = x\n    f!()\n",
      "let k = (((f: () ->! Unit), n): (() -> Unit, Int)) => f!()\n",
      // A union constructor's payload, which the pattern takes from the declaration.
      "union Box = Box(f: () -> Unit)\nlet g(b: Box): Unit =\n    let Box((f: () ->! Unit)) = b\n    f!()\n",
      "union Box = Box(f: () -> Unit)\nlet g(b: Box): Unit = match b\n    Box((f: () ->! Unit)) => f!()\n",
    ]) {
      expect(messages(WORLD + body + OUT)).toEqual([]);
    }
    // The claim fits even where the arm never calls the function.
    expect(scheme(WORLD + "let g(x: (() -> Unit, Int)): Int = match x\n    ((f: () ->! Unit), n) => n\n" + OUT, "g"))
      .toBe("((() -> Unit, Int)) -> Int");
  });

  test("a written arrow the part has is the part's own", async () => {
    const source = "let f(x: Int): Int = x\nlet ((m: (Int) -> Int), n) = (f, 1)\nexport let out: Int = m(n)\n";
    expect(scheme(source, "m")).toBe("Int -> Int");
    expect(await run(source)).toMatchObject({ out: 1 });
  });

  test("a `->!` the part's written type spells in a parameter accepts any function, at every position", () => {
    for (const body of [
      "let g(x: ((() ->! Unit) -> Unit, Int)): Unit = match x\n    ((m: (() -> Unit) ->! Unit), n) => m!(noop)\n",
      "let g(xs: Vector((() ->! Unit) -> Unit)): Unit =\n    for (m: (() -> Unit) ->! Unit) in xs\n        m!(noop)\n",
      "let g(x: ((() ->! Unit) -> Unit, Int)): Unit =\n    let ((m: (() -> Unit) ->! Unit), n) = x\n    m!(noop)\n",
      "let k = (((m: (() -> Unit) ->! Unit), n): ((() ->! Unit) -> Unit, Int)) => m!(noop)\n",
    ]) {
      expect(messages(WORLD + body + OUT)).toEqual([]);
    }
    // One written `->` there accepts only what it says.
    expect(messages(WORLD + "let g(x: ((() -> Unit) -> Unit, Int)): Unit = match x\n" +
      "    ((m: (() ->! Unit) ->! Unit), n) => m!(save0)\n" + OUT)).toHaveLength(1);
  });

  test("the binder takes the written type, so its calls wear the marks it writes", () => {
    expect(messages(WORLD + "let g(x: (() -> Unit, Int)): Unit = match x\n    ((f: () ->! Unit), n) => f()\n" + OUT))
      .toEqual(["this call is impure and may fail, so `f` wants `!`, not no mark"]);
  });

  test("a colour the environment holds is left to the binding that holds it", () => {
    expect(scheme(WORLD + "let g(h) =\n    match (h, 1)\n        ((f: () ->! Unit), n) => f!()\n" + OUT, "g"))
      .toBe("(() ->! Unit) ->! Unit");
    expect(scheme(WORLD + "let g(h) =\n    let p = (h, 1)\n    match p\n        ((f: () ->! Unit), n) => f!()\n" + OUT, "g"))
      .toBe("(() ->! Unit) ->! Unit");
  });

  test("a value the text does not decide meets the claim as inference decides it, at every position", () => {
    // `h` has no written type, so the claim is not room above its colour: it decides it, and `h()` is refused.
    const report = "this call is impure and may fail only because `h`, which has no written type, meets " +
      "`() ->! Unit` — write `h`'s type, or wrap `h` where it meets it: `() => h()`";
    for (const body of [
      "let g(h) =\n    h()\n    match (h, 1)\n        ((f: () ->! Unit), n) => f!()\n",
      "let g(h) =\n    h()\n    let ((f: () ->! Unit), n) = (h, 1)\n    f!()\n",
      "let g(h) =\n    h()\n    for (f: () ->! Unit) in [h]\n        f!()\n",
    ]) {
      expect(messages(WORLD + body + OUT)).toEqual([report]);
    }
    // Where the binding's annotation writes the part, the text decides it, and the claim fits.
    expect(scheme(WORLD + "let g(h) =\n    h()\n    let ((f: () ->! Unit), n): (() -> Unit, Int) = (h, 1)\n    f!()\n" + OUT, "g"))
      .toBe("(() -> Unit) ->! Unit");
  });

  test("the reverse stays refused, at every position", () => {
    for (const body of [
      "let (f: () -> Unit) = save0\n",
      "let g(x: (() ->! Unit, Int)): Int = match x\n    ((f: () -> Unit), n) => n\n",
      "let g(xs: Vector(() ->! Unit)): Unit =\n    for (f: () -> Unit) in xs\n        f()\n",
    ]) {
      const refused = messages(WORLD + body + OUT);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain("impure and may fail");
    }
  });
});

describe("§2.9 a following arrow follows the binders' class (#1510)", () => {
  test("in a `let` pattern it reads as the binding annotation on the same name", () => {
    const source = WORLD + "let ((m: (() ->! Unit) >-> Unit), n) = (run, 1)\n" +
      "let a(): Unit = m(noop)\nlet b(): Unit = m!(save0)\n" + OUT;
    expect(scheme(source, "m")).toBe("(() ->! Unit) >-> Unit");
    expect(scheme(source, "a")).toBe("() -> Unit");
    expect(scheme(source, "b")).toBe("() ->! Unit");
    // Its refusals are the annotation's, word for word, at top level and inside a body.
    expect(messages(WORLD + "let (m: () >-> Unit) = noop\n" + OUT)).toEqual(messages(WORLD + "let m: () >-> Unit = noop\n" + OUT));
    expect(messages(WORLD + "let g(): Unit =\n    let (m: () >-> Unit) = noop\n    m!()\n" + OUT)).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — this annotation has no " +
        "callbacks of its own, and a local `>->` does not borrow the enclosing function's — leave its type to " +
        "inference, or write `->!`",
    ]);
  });

  test("at a head binder it is refused, naming what the position binds, and reads as its constant", () => {
    const frame = (binds: string) =>
      `\`>->\` means only as effectful as what it is handed, and ${binds} is one value, whose calls share one ` +
      "colour; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail";
    const arm = "let g(): Unit = match (run, 1)\n    ((m: (() ->! Unit) >-> Unit), n) => m!(save0)\n";
    expect(refusal(WORLD + arm + OUT)).toEqual({
      message: frame("what an arm binds"),
      fixed: [WORLD + arm.replace(">->", "->!") + OUT],
    });
    expect(messages(WORLD + "let g(): Unit =\n    for (m: (() ->! Unit) >-> Unit) in [run]\n        m!(save0)\n" + OUT))
      .toEqual([frame("what a `for` head binds")]);
    expect(messages(WORLD + "let k = (((m: (() ->! Unit) >-> Unit), n)) => m!(save0)\nlet g(): Unit = k!((run, 1))\n" + OUT))
      .toEqual([frame("what a lambda's parameter binds")]);
    // A `catch` arm is an arm.
    expect(messages(WORLD + "exception Oops\nlet g(): Int = try throw^(Oops)\n    catch\n        (e: () >-> Unit) => 1\n" + OUT))
      .toContain(frame("what an arm binds"));
    // It reads as its constant, so a bare call of it asks for the mark the constant implies.
    expect(messages(WORLD + "let g(): Unit = match (run, 1)\n    ((m: (() ->! Unit) >-> Unit), n) => m(noop)\n" + OUT))
      .toEqual([frame("what an arm binds"), "this call is impure and may fail, so `m` wants `!`, not no mark"]);
  });

  test("it leads the passes-through and type-argument rows, and names each arrow's own constant", () => {
    const refused = messages(WORLD + "let g(): Int = match ([noop], 1)\n    ((v: Vector(() >-> Unit)), n) => n\n" + OUT);
    expect(refused).toEqual([
      "`>->` means only as effectful as what it is handed, and what an arm binds is one value, whose calls share " +
        "one colour; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
    ]);
    // Over a callback marked only for failure, the passes-through row does not speak.
    expect(messages(WORLD + "let check(c: () ->^ Unit): Unit = c^()\nlet g(): Unit = match (check, 1)\n" +
      "    ((m: (() ->^ Unit) >-> Unit), n) => m!(() => ())\n" + OUT)).toEqual([
      "`>->` means only as effectful as what it is handed, and what an arm binds is one value, whose calls share " +
        "one colour; write `->!` for a function that is impure and may fail, or `->` for one that is pure and cannot fail",
    ]);
    expect(messages(WORLD + "let g(): Int = match ([noop], 1)\n    ((v: Vector(() >^> Unit)), n) => n\n" + OUT)).toEqual([
      "`>^>` means only as effectful as what it is handed, and what an arm binds is one value, whose calls share " +
        "one colour; write `->^` for a function that is pure and may fail, or `->` for one that is pure and cannot fail",
    ]);
  });

  test("inside a parameter type of a head binder's type, the parameter-type frame", () => {
    expect(messages(WORLD + "let use(h: () ->! Unit): Unit = ()\nlet g(): Unit = match (use, 1)\n" +
      "    ((m: (() >-> Unit) -> Unit), n) => m(noop)\n" + OUT)).toEqual([
      "`>->` means only as effectful as what it is handed, and nothing is handed here — an arrow inside a parameter " +
        "type, other than a callback's own, is a constant; write `->!` for a function that is impure and may fail, " +
        "or `->` for one that is pure and cannot fail",
    ]);
  });
});

describe("§2.9 a head binder's type writes no callback (#1510)", () => {
  test("a function type inside a lambda parameter's pattern is data; on the parameter it is a callback", () => {
    expect(messages(WORLD + "let g(): Vector(Unit) = Vector.map([(noop, 1)], (((f: () ->! Unit), n)) => f!())\n" + OUT))
      .toEqual(["this call is impure and may fail, so `map` wants `!`, not no mark"]);
    expect(messages(WORLD + "let g(): Vector(Unit) = Vector.map([noop], (f: () ->! Unit) => f!())\n" + OUT)).toEqual([]);
  });

  test("an arm's type reads a parameter's `->!` as the constant, where a `let` pattern's reads a callback", () => {
    // In a `let` pattern `->!` on a parameter is a callback's colour, which `run` follows, so `->` around it is the
    // callback row's report; at an arm it is the constant, and `run` handed any function is impure, so the arm's
    // `->` is the ordinary mismatch.
    expect(messages(WORLD + "let ((m: (() ->! Unit) -> Unit), n) = (run, 1)\n" + OUT)).toEqual([
      "this callback is written `->!`, which accepts any function, and this accepts only one that is pure and cannot " +
        "fail — write its arrow `->`",
    ]);
    const arm = messages(WORLD + "let g(): Int = match (run, 1)\n    ((m: (() ->! Unit) -> Unit), n) => n\n" + OUT);
    expect(arm).toHaveLength(1);
    expect(arm[0]).not.toContain("callback");
    // With the constant written around it, the arm fits.
    expect(scheme(WORLD + "let g(): Unit = match (run, 1)\n    ((m: (() ->! Unit) ->! Unit), n) => m!(noop)\n" + OUT, "g"))
      .toBe("() ->! Unit");
  });
});
