/**
 * Conformance for **Friendly Sequences** (Collections Part 5 §3.4–§3.6; #1152).
 *
 * A value meeting a seat whose type is headed by `Seq` is adapted through its
 * `Iterable` instance: the seat inserts the instance's `toSeq`, a specified
 * conversion (Functions §4) decided once, at the seat's final check. A source
 * whose head is not yet known makes its `Iterable` demand at its own turn, so
 * its element is linked at once, and only its head waits — for its owner
 * region's close at the latest, where one nothing described is a `Seq` (§3.5).
 * Loop heads follow the same rule (§3.1 step 2, #1118). An adaptation is its
 * explicit call (§3.6): what it emits, evaluates, and generalizes to is
 * `Iterable.toSeq(value)`'s.
 */

import { describe, expect, test } from "vitest";
import { compileMain, runProject } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const fixtures = "module Main\n\n" +
  "let words: Vector(String) = [\"a\", \"b\"]\n" +
  "let moreWords: Set(String) = Set.fromVector(words)\n" +
  "let ints: Vector(Int) = [1, 2]\n" +
  "let sumInts(xs: Seq(Int)): Int = Seq.fold(xs, 0, (total, item) => total + item)\n";

function compile(body: string) {
  return compileMain(fixtures + body);
}

function refusals(body: string): readonly string[] {
  return compile(body).diagnostics.map(({ message }) => message);
}

/** The scheme a top-level binding was given, where the program compiles. */
function typeOf(body: string, name: string): string {
  const compiled = compile(body);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source }) => source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** The emitted JavaScript of `Main`, imports and the fixtures' lines dropped. */
function emitted(body: string): string {
  const compiled = compile(body);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = compiled.modules.find(({ source }) => source.path === "/main.hex")!;
  const fixtureLines = new Set(compile("").modules
    .find(({ source }) => source.path === "/main.hex")!.javascript.text.split("\n"));
  return main.javascript.text.split("\n")
    .filter((line) => !fixtureLines.has(line) && !line.startsWith("import "))
    .join("\n");
}

const RIGID_SOURCE = "`xs` has the generic type `c`, and `Iterable` declares an implied type and " +
  "cannot constrain a type variable in v1; take a `Seq(a)` parameter instead";

describe("every seat headed by `Seq` adapts (Part 5 §3.4)", () => {
  test("an argument, qualified, generic, piped, and a constructor's", () => {
    expect(typeOf("let joined = String.fromSeq(words)\n", "joined")).toBe("String");
    expect(typeOf("let n = Seq.length(moreWords)\n", "n")).toBe("Int");
    expect(typeOf("let piped = words |> String.fromSeq\n", "piped")).toBe("String");
    expect(typeOf("let o: Option(Seq(String)) = Some(words)\n", "o")).toBe("Option(Seq(String))");
  });

  test("an annotation, an ascription, and a declared result", () => {
    expect(typeOf("let view: Seq(String) = words\n", "view")).toBe("Seq(String)");
    expect(typeOf("let view = (words : Seq(String))\n", "view")).toBe("Seq(String)");
    expect(typeOf("let colors(): Seq(String) =\n    [\"red\", \"green\"]\n", "colors"))
      .toBe("() -> Seq(String)");
  });

  test("a literal's parts, a `with` override, and an argument's spine", () => {
    expect(typeOf("let p: (Seq(String), Int) = (words, 1)\n", "p")).toBe("(Seq(String), Int)");
    expect(typeOf("let r: {names: Seq(String)} = {names = words}\n", "r"))
      .toBe("{names: Seq(String)}");
    expect(typeOf("let v: Vector(Seq(String)) = [words, moreWords]\n", "v"))
      .toBe("Vector(Seq(String))");
    expect(typeOf(
      "let r0: {names: Seq(String), n: Int} = {names = Vector.toSeq(words), n = 1}\n" +
        "let r1 = {r0 with names = words}\n",
      "r1",
    )).toBe("{names: Seq(String), n: Int}");
    expect(typeOf(
      "let usePair(p: (Seq(String), Int)): Int = 0\nlet n = usePair((words, 1))\n",
      "n",
    )).toBe("Int");
  });

  test("a lambda's body at a landed `Seq` result, and a constraint member's body", () => {
    expect(typeOf("let flat = Seq.flatMap(Vector.toSeq([words]), (w) => w)\n", "flat"))
      .toBe("Seq(String)");
    expect(typeOf(
      "record Crew = {names: Vector(String)}\n" +
        "constraint Listing<c> =\n    list(x: c) -> Seq(String)\n" +
        "honor Listing<Crew> =\n    list(crew) = crew.names\n" +
        "let listed = Crew({names = words}).list()\n",
      "listed",
    )).toBe("Seq(String)");
  });

  test("a dot call that resolves late meets its arguments where it resolves", () => {
    expect(emitted(
      "export record Box = {n: Int}\n" +
        "export let count(box: Box, xs: Seq(String)): Int = Seq.length(xs)\n" +
        "let late(b) =\n    let k = b.count(words)\n    let known: Box = b\n    k\n",
    )).toContain("count(b, toSeq(words))");
  });

  test("a `Seq` passes unchanged, and a declared variable in the element rides through", () => {
    expect(emitted("let same: Seq(String) = Vector.toSeq(words)\nlet again: Seq(String) = same\n"))
      .toContain("const again = same;");
    expect(typeOf("let f(xs: Vector(a)): Seq(a) = xs\n", "f")).toBe("Vector(a) -> Seq(a)");
  });

  test("the adaptation emits the explicit call", () => {
    const implicit = emitted("let joined = String.fromSeq(words)\n");
    expect(implicit).toContain("const joined = fromSeq(toSeq(words));");
    expect(emitted("let joined = String.fromSeq(Iterable.toSeq(words))\n")).toBe(implicit);
  });
});

describe("what never adapts (Part 5 §3.4, §3.6)", () => {
  test("a `var`'s annotation, and an assignment with everything its face reaches", () => {
    expect(refusals("let f() =\n    var s: Seq(String) = words\n    Seq.length(s)\n"))
      .toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
    expect(refusals(
      "let f(c: Bool) =\n    var s: Seq(String) = Vector.toSeq(words)\n" +
        "    s := if c then words else Vector.toSeq(words)\n    Seq.length(s)\n",
    )).toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
    expect(refusals(
      "let f() =\n    var p: (Seq(String), Int) = (Vector.toSeq(words), 1)\n    p := (words, 2)\n" +
        "    Seq.length(p.item1)\n",
    )).toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
  });

  test("an existing value, an element, a sibling, and a head with no instance", () => {
    expect(refusals(
      "let o: Option(Vector(String)) = Some(words)\nlet s: Option(Seq(String)) = o\n",
    )).toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
    expect(refusals("let s: Seq(Float) = ints\n")).toEqual([
      "type mismatch: expected Seq(Float), found Vector(Int), which supplies Seq(Int)",
    ]);
    expect(refusals(
      "let pick(x: a, y: a): a = x\nlet p = pick(Vector.toSeq(words), words)\n",
    )).toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
    expect(refusals("let s: Seq(Int) = (1, 2)\n"))
      .toEqual(["type mismatch: expected Seq(Int), found (a, b)"]);
  });

  test("method search: a vector's dot call stays the vector's", () => {
    expect(typeOf("let longer = words.append(\"c\")\n", "longer")).toBe("Vector(String)");
  });
});

describe("a form's paths (Part 5 §3.4)", () => {
  test("a closed `Seq` meets each path, in either order", () => {
    expect(typeOf("let c = 1 > 2\nlet s: Seq(String) = if c then words else moreWords\n", "s"))
      .toBe("Seq(String)");
    expect(typeOf("let c = 1 > 2\nlet s: Seq(String) = if c then moreWords else words\n", "s"))
      .toBe("Seq(String)");
  });

  test("an open element: the paths join their elements, then each adapts", () => {
    expect(typeOf("let c = 1 > 2\nlet n = Seq.length(if c then words else moreWords)\n", "n"))
      .toBe("Int");
    expect(typeOf(
      "let c = 1 > 2\nlet n = Seq.length(match c\n    True => moreWords\n    False => words)\n",
      "n",
    )).toBe("Int");
    expect(typeOf("let c = 1 > 2\nlet s: Seq(_) = if c then words else moreWords\n", "s"))
      .toBe("Seq(String)");
    expect(refusals("let c = 1 > 2\nlet n = Seq.length(if c then ints else words)\n"))
      .toEqual(["type mismatch: expected Int, found String"]);
  });

  test("a path of unknown head contributes only its element, and defaults to `Seq`", () => {
    expect(typeOf(
      "fun f(c, xs, names: Vector(String)) = Seq.length(if c then xs else names)\n",
      "f",
    )).toBe("(Bool, Seq(String), Vector(String)) -> Int");
  });

  test("a vector literal's elements read against `Vector(Seq(_))`: the later one refused", () => {
    expect(refusals("let v: Vector(Seq(_)) = [ints, words]\n")).toEqual([
      "type mismatch: expected Seq(Int), found Vector(String), which supplies Seq(String)",
    ]);
  });
});

describe("a source whose head is not yet known (Part 5 §3.5)", () => {
  test("nothing describes it: the `Seq` reading", () => {
    expect(typeOf("let f(xs) = String.fromSeq(xs)\n", "f")).toBe("Seq(String) -> String");
  });

  test("a later or an earlier statement describes it: adapted, in either order", () => {
    expect(typeOf(
      "let f(xs) =\n    let s = String.fromSeq(xs)\n    Vector.length(xs)\n",
      "f",
    )).toBe("Vector(String) -> Int");
    expect(typeOf(
      "let f(xs) =\n    let n = Vector.length(xs)\n    String.fromSeq(xs)\n",
      "f",
    )).toBe("Vector(String) -> String");
  });

  test("its element is linked at its own turn", () => {
    expect(typeOf(
      "fun go(v) =\n    let total = sumInts(v)\n    Seq.map(v, match\n" +
        "        n when n < 0 => \"negative\"\n        _ => \"other\")\n",
      "go",
    )).toBe("Seq(Int) -> Seq(String)");
    expect(typeOf(
      "fun go(v) =\n    let total = sumInts(v)\n    Seq.fold(v, 0.5, (acc, x) => acc + x)\n",
      "go",
    )).toBe("Seq(Int) -> Float");
  });

  test("what reads its head before the close sees it open: a dot call, a `match`", () => {
    expect(refusals(
      "fun go(v) =\n    let total = sumInts(v)\n    v.map(match\n" +
        "        n when n < 0 => \"negative\"\n        _ => \"other\")\n",
    )).toEqual([
      "cannot match on a value of abstract type `a`; the parameter's type is not determined here; " +
        "give the parameter a type — bind the function with its own annotated `let`, or use it " +
        "where its parameter type is known",
    ]);
    expect(typeOf(
      "fun go(v: Seq(Int)) =\n    let total = sumInts(v)\n    v.map(match\n" +
        "        n when n < 0 => \"negative\"\n        _ => \"other\")\n",
      "go",
    )).toBe("Seq(Int) -> Seq(String)");
  });

  test("an explicit call alone keeps its refusal; beside a seat it settles with it", () => {
    expect(refusals("let t(x) = Iterable.toSeq(x)\n")).toEqual([
      "`Iterable` declares an implied type and cannot constrain a type variable in v1, but `t` " +
        "leaves the type of `x` open; annotate `x`, or take a `Seq(a)` parameter instead",
    ]);
    expect(typeOf(
      "let f(x) =\n    let s = Iterable.toSeq(x)\n    String.fromSeq(x)\n",
      "f",
    )).toBe("Seq(String) -> String");
  });

  test("a declared variable is refused with the `Seq(a)` rewrite", () => {
    expect(refusals("let f(xs: c): Seq(Int) = xs\n")).toEqual([RIGID_SOURCE]);
  });

  test("the close runs goals and defaults to one fixpoint", () => {
    expect(typeOf(
      "fun z(xs, ys) =\n    let s = String.fromSeq(xs)\n    xs.zip(ys)\n",
      "z",
    )).toBe("(Seq(String), Seq(a)) -> Seq((String, a))");
  });

  test("a late head that does not fit is refused at the demand's seat, in either order", () => {
    const late = (lines: string): readonly string[] =>
      compile(`fun late(v) =\n${lines}    total\n`).diagnostics.map(({ message, primary }) =>
        `${message} @${primary.start.line}:${primary.start.column}`
      );
    const refusal = "type mismatch: expected Seq(Int), found Vector(String), which supplies Seq(String)";
    const demand = fixtures.split("\n").length;
    expect(late("    let total = sumInts(v)\n    let k: Vector(String) = v\n"))
      .toEqual([`${refusal} @${demand}:16`]);
    expect(late("    let k: Vector(String) = v\n    let total = sumInts(v)\n"))
      .toEqual([`${refusal} @${demand + 1}:16`]);
  });
});

describe("a loop head follows the same rule (Part 5 §3.1 step 2, #1118)", () => {
  test("a source described after the loop, or before it", () => {
    expect(typeOf("let f(xs) =\n    for x in xs\n        ()\n    Vector.length(xs)\n", "f"))
      .toBe("Vector(a) -> Int");
    expect(typeOf(
      "let f(xs) =\n    let n = Vector.length(xs)\n    for x in xs\n        ()\n    n\n",
      "f",
    )).toBe("Vector(a) -> Int");
  });

  test("a source nothing describes is a `Seq`; a declared one is refused", () => {
    expect(typeOf("let h(xs) =\n    for x in xs\n        ()\n", "h")).toBe("Seq(a) -> Unit");
    expect(refusals("let h(xs: c) =\n    for x in xs\n        ()\n")).toEqual([RIGID_SOURCE]);
  });

  test("a head that arrives late iterates natively, as a head known at the loop does", () => {
    const vector = emitted(
      "let f(xs) =\n    var n = 0\n    for x in xs\n        n := n + x\n    n + Vector.length(xs)\n",
    );
    expect(vector).toContain("for (const x of xs) {");
    expect(vector).not.toContain("toSeq");
    expect(emitted(
      "let f(m) =\n    var n = 0\n    for (k, v) in m\n        n := n + v\n" +
        "    let known: Map(String, Int) = m\n    n\n",
    )).toContain("for (const __item of m) {");
    expect(emitted(
      "let f(s) =\n    var n = 0\n    for c in s\n        n := n + 1\n    let known: String = s\n    n\n",
    )).toContain("for (const c of s) {");
  });
});

describe("an instance's own subject, in its own `toSeq` (Part 5 §3.6)", () => {
  const stack = "record Stack(a) = {items: Vector(a)}\n";
  const refusal = (subject: string): string =>
    `type mismatch: expected Seq(a), found ${subject}; inside \`Iterable<${subject}>\`'s own ` +
    `\`toSeq\`, a \`${subject}\` is not converted to a sequence, since that would call the member ` +
    "being defined; convert its contents, or write `Iterable.toSeq(…)` where recursion on a " +
    "smaller value is meant";

  test("the subject itself, or through a combinator, or a child, is refused", () => {
    const honor = (body: string): string =>
      stack + "honor Iterable<Stack(a)> =\n    type Item = a\n" + `    toSeq(s) = ${body}\n`;
    expect(refusals(honor("s"))).toEqual([refusal("Stack(a)")]);
    expect(refusals(honor("Seq.map(s, (x) => x)"))).toEqual([refusal("Stack(a)")]);
    expect(refusals(
      "union Tree(a) = Leaf(a) | Node(Vector(Tree(a)))\n" +
        "honor Iterable<Tree(a)> =\n    type Item = a\n    toSeq(t) = match t\n" +
        "        Leaf(v) => Vector.toSeq([v])\n" +
        "        Node(kids) => Seq.flatMap(Vector.toSeq(kids), (k) => k)\n",
    )).toEqual([refusal("Tree(a)")]);
  });

  test("its contents, a helper one call removed, and written recursion are accepted", () => {
    const honor = (body: string, helper = ""): string =>
      stack + helper + "honor Iterable<Stack(a)> =\n    type Item = a\n" + `    toSeq(s) = ${body}\n` +
      "let n = Seq.length(Stack({items = [1, 2]}))\n";
    expect(typeOf(honor("s.items"), "n")).toBe("Int");
    expect(typeOf(honor("flat(s)", "let flat(s: Stack(a)): Seq(a) = s.items\n"), "n")).toBe("Int");
    expect(refusals(
      "union Tree(a) = Leaf(a) | Node(Vector(Tree(a)))\n" +
        "honor Iterable<Tree(a)> =\n    type Item = a\n    toSeq(t) = match t\n" +
        "        Leaf(v) => Vector.toSeq([v])\n" +
        "        Node(kids) => Seq.flatMap(Vector.toSeq(kids), (k) => Iterable.toSeq(k))\n",
    )).toEqual([]);
  });
});

describe("generalization is the explicit spelling's (Functions §8 item 2)", () => {
  test("an unconstrained element generalizes", () => {
    expect(typeOf("let e: Seq(a) = Vector.empty\n", "e")).toBe("Seq(a)");
  });

  test("a contravariant element variable is the annotated binding's hard error", () => {
    expect(refusals("let fs: Seq((a) -> Int) = [(x) => 1]\n")).toEqual([
      "`a` is a declared type variable, but this right-hand side is a computation that cannot be " +
        "generalized in `a` (`a` occurs in argument position); bind where the type is known, or " +
        "remove the annotation",
    ]);
  });
});

describe("at run time an adaptation is its explicit call (Part 5 §3.6)", () => {
  test("values, and only the selected path runs", async () => {
    const run = await runProject([["/main.hex", fixtures +
      "exception Unreached\n" +
      "let boom(): Vector(String) = throw(Unreached)\n" +
      "export let joined: String = String.fromSeq(words)\n" +
      "export let selected: Int = Seq.length(if 1 < 2 then words else boom())\n" +
      "export let held: Option(Seq(String)) = Some(words)\n" +
      "export let length(xs: Vector(Int)): Int = Seq.length(xs)\n" +
      "export let loops(n: Int): Int =\n" +
      "    let f(xs) =\n        var t = 0\n        for x in xs\n            t := t + x\n" +
      "        t + Vector.length(xs)\n" +
      "    f([n, n])\n"]]);
    expect(run["joined"]).toBe("ab");
    expect(run["selected"]).toBe(2);
    expect((run["length"] as (xs: unknown) => number)([1, 2, 3])).toBe(3);
    expect((run["loops"] as (n: number) => number)(5)).toBe(12);
  });
});

describe("several demands on one waiting source settle as one (#1125)", () => {
  const stack = "record Stack(a) = {items: Vector(a)}\n" +
    "honor Iterable<Stack(a)> =\n    type Item = a\n    toSeq(s) = s.items\n";
  const exported = async (body: string): Promise<unknown> =>
    (await runProject([["/main.hex", "module Main\n\n" + body]]))["r"];

  test("a loop, a seat, and a late `Vector` head", async () => {
    expect(await exported(
      "let f(xs) =\n    var t = 0\n    for x in xs\n        t := t + 1\n" +
        "    let b = Seq.length(xs)\n    let n = Vector.length(xs)\n    b + t\n" +
        "export let r: Int = f([\"a\", \"b\"])\n",
    )).toBe(4);
  });

  test("two seats, a seat and a loop, and two loops, at a late user head", async () => {
    const f = (body: string): string =>
      stack + `let f(xs) =\n${body}    let n: Stack(Int) = xs\n    total\n` +
      "export let r: Int = f(Stack({items = [1, 2]}))\n";
    expect(await exported(f("    let total = Seq.length(xs) + Seq.length(xs)\n"))).toBe(4);
    expect(await exported(f(
      "    var t = Seq.length(xs)\n    for x in xs\n        t := t + x\n    let total = t\n",
    ))).toBe(5);
    expect(await exported(f(
      "    var t = 0\n    for x in xs\n        t := t + x\n    for y in xs\n        t := t + y\n" +
        "    let total = t\n",
    ))).toBe(6);
  });

  test("an explicit call and a seat", async () => {
    expect(await exported(
      "let f(xs) =\n    let s = Iterable.toSeq(xs)\n    let b = Seq.length(xs)\n" +
        "    let n = Vector.length(xs)\n    b + Seq.length(s)\n" +
        "export let r: Int = f([\"a\", \"b\"])\n",
    )).toBe(4);
  });

  test("a late head with no instance is refused once", () => {
    expect(refusals(
      "let f(xs) =\n    let a = String.fromSeq(xs)\n    let b = Seq.length(xs)\n" +
        "    let k: Int = xs\n    b\n",
    )).toEqual(["type mismatch: expected Seq(String), found Int"]);
  });

  test("a seat and a loop at a late `String` head: the loop stays native", () => {
    expect(emitted(
      "let f(s) =\n    let b = Seq.length(s)\n    var n = 0\n    for c in s\n        n := n + 1\n" +
        "    let known: String = s\n    n + b\n",
    )).toContain("for (const c of s) {");
  });
});

describe("the exclusion holds however late the head arrives (Part 5 §3.6)", () => {
  const refusal = "type mismatch: expected Seq(a), found Stack(a); inside `Iterable<Stack(a)>`'s own " +
    "`toSeq`, a `Stack(a)` is not converted to a sequence, since that would call the member being " +
    "defined; convert its contents, or write `Iterable.toSeq(…)` where recursion on a smaller " +
    "value is meant";
  const honor = (arm: string, fill: string): string =>
    "record Stack(a) = {items: Vector(a)}\n" +
    "export record Box = {n: Int}\n" +
    "export let count(box: Box, xs: Seq(a)): Int = Seq.length(xs)\n" +
    "honor Iterable<Stack(a)> =\n    type Item = a\n    toSeq(s) =\n" +
    "        var holder = Vector.empty\n" +
    `        let n = match Vector.first(holder)\n            Some(b) => ${arm}\n            None => 0\n` +
    `        holder := ${fill}\n        s.items\n`;

  test("a dot call that resolves after the body", () => {
    expect(refusals(honor("b.count(s)", "[Box({n = 1})]"))).toEqual([refusal]);
  });

  test("a waiting source whose head is the subject", () => {
    expect(refusals(honor("Seq.length(b)", "[s]"))).toEqual([refusal]);
  });

  test("a helper one call removed still adapts (D8)", () => {
    expect(emitted(
      "record Stack(a) = {items: Vector(a)}\nlet flat(s: Stack(a)): Seq(a) = s\n" +
        "honor Iterable<Stack(a)> =\n    type Item = a\n    toSeq(s) = flat(s)\n",
    )).toContain("const flat = s => __Iterable_Stack_toSeq(s);");
  });
});

describe("ownership and declared variables at the close (Part 5 §3.5)", () => {
  test("a waiting source a pending goal mentions belongs to that goal's region", () => {
    expect(typeOf(
      "export record Box = {n: Int}\n" +
        "export let pick(box: Box, xs: Vector(String)): Int = Vector.length(xs)\n" +
        "let both(a: t, b: t, k: Int): Int = k\n" +
        "let outer(n) =\n    let inner(x, ys) =\n        let r = x.pick(ys)\n" +
        "        let s = Seq.length(ys)\n        both(x, n, r + s)\n" +
        "    let known: Box = n\n    inner(n, [\"a\"])\n",
      "outer",
    )).toBe("Box -> Int");
  });

  test("a declared variable arriving late is refused as one known at the seat, in either order", () => {
    const refused = "`ys` has the generic type `c`, and `Iterable` declares an implied type and cannot " +
      "constrain a type variable in v1; take a `Seq(a)` parameter instead";
    expect(refusals(
      "fun h(ys, xs: c): Int =\n    let n = Seq.length(ys)\n    let same = [ys, xs]\n    n\n",
    )).toEqual([refused]);
    expect(refusals(
      "fun h(ys, xs: c): Int =\n    let same = [ys, xs]\n    let n = Seq.length(ys)\n    n\n",
    )).toEqual([refused]);
  });
});

describe("the rest of what never adapts, and what it costs", () => {
  test("a `Stream`, an existing function, and an unmet prerequisite", () => {
    expect(refusals(
      "let s: Stream(Int) = Stream.fromSeq(Vector.toSeq([1]))\nlet n = Seq.length(s)\n",
    )).toEqual(["type mismatch: expected Seq(a), found Stream(Int)"]);
    expect(refusals("let mk(): Vector(String) = [\"a\"]\nlet g: () -> Seq(String) = mk\n"))
      .toEqual(["type mismatch: expected Seq(String), found Vector(String)"]);
    expect(refusals(
      "record Tag(a) = {items: Vector(a)}\nhonor<a: Show> Iterable<Tag(a)> =\n    type Item = a\n" +
        "    toSeq(t) = t.items\nlet n = Seq.length(Tag({items = [(x) => x + 1]}))\n",
    )).toEqual(["functions have no `Show` instance"]);
  });

  test("a path with no instance under an open element is refused where it stands", () => {
    expect(refusals("let c = 1 > 2\nlet n = Seq.length(if c then True else [1])\n"))
      .toEqual(["type mismatch: expected Seq(a), found Bool"]);
  });

  test("a `match` on a waiting source reads it open", () => {
    expect(refusals("fun go(v) =\n    let t = sumInts(v)\n    match v\n        s => 1\n")).toEqual([
      "cannot match on a value of abstract type `a`; the parameter's type is not determined here; " +
        "give the parameter a type — bind the function with its own annotated `let`, or use it " +
        "where its parameter type is known",
    ]);
  });

  test("an adapted binding is no value (Functions §8 item 2)", () => {
    expect(refusals(
      "let vfs: Vector((a) -> Int) = Vector.empty\nlet fs: Seq((a) -> Int) = vfs\n",
    )).toEqual([
      "`a` is a declared type variable, but this right-hand side is a computation that cannot be " +
        "generalized in `a` (`a` occurs in argument position); bind where the type is known, or " +
        "remove the annotation",
    ]);
  });

  test("the source is evaluated once, inside the one call", () => {
    expect(emitted("let mk(): Vector(String) = [\"a\"]\nlet joined = String.fromSeq(mk())\n"))
      .toContain("const joined = fromSeq(toSeq(mk()));");
  });
});

describe("an unknown value on a form's path, or grouped, waits too (Part 5 §3.5)", () => {
  test("both branches unknown, described afterwards", () => {
    expect(typeOf(
      "let f(c: Bool, xs, ys) =\n    let n = Seq.length(if c then xs else ys)\n" +
        "    let a: Vector(String) = xs\n    let b: Set(String) = ys\n    n\n",
      "f",
    )).toBe("(Bool, Vector(String), Set(String)) -> Int");
    expect(typeOf(
      "let f(c: Bool, xs, ys) =\n    let a: Vector(String) = xs\n    let b: Set(String) = ys\n" +
        "    Seq.length(if c then xs else ys)\n",
      "f",
    )).toBe("(Bool, Vector(String), Set(String)) -> Int");
    expect(typeOf(
      "let f(c: Bool, xs, ys) =\n    let s: Seq(String) = if c then xs else ys\n" +
        "    let a: Vector(String) = xs\n    Seq.length(s)\n",
      "f",
    )).toBe("(Bool, Vector(String), Seq(String)) -> Int");
    expect(typeOf(
      "let f(c: Bool, xs, ys) =\n    let s = String.fromSeq(match c\n        True => xs\n" +
        "        False => ys)\n    let a: Vector(String) = xs\n    s\n",
      "f",
    )).toBe("(Bool, Vector(String), Seq(String)) -> String");
  });

  test("a grouped unknown value, in either order", () => {
    expect(typeOf("let f(xs) =\n    let s = Seq.length((xs))\n    Vector.length(xs)\n", "f"))
      .toBe("Vector(a) -> Int");
    expect(typeOf("let f(xs) =\n    let n = Vector.length(xs)\n    Seq.length((xs))\n", "f"))
      .toBe("Vector(a) -> Int");
    expect(typeOf("let f(xs) =\n    let s = String.fromSeq((xs))\n    Vector.length(xs)\n", "f"))
      .toBe("Vector(String) -> Int");
  });

  test("an absorbed seat inside the instance's own `toSeq` is refused as its own would be", () => {
    expect(refusals(
      "record Stack(a) = {items: Vector(a)}\n" +
        "honor Iterable<Stack(a)> =\n    type Item = a\n    toSeq(s) =\n" +
        "        var holder = Vector.empty\n" +
        "        let n = match Vector.first(holder)\n            Some(b) =>\n" +
        "                var t = 0\n                for x in b\n                    t := t + 1\n" +
        "                t + Seq.length(b)\n            None => 0\n" +
        "        holder := [s]\n        s.items\n",
    )).toEqual([
      "type mismatch: expected Seq(a), found Stack(a); inside `Iterable<Stack(a)>`'s own `toSeq`, " +
        "a `Stack(a)` is not converted to a sequence, since that would call the member being " +
        "defined; convert its contents, or write `Iterable.toSeq(…)` where recursion on a smaller " +
        "value is meant",
    ]);
  });
});

