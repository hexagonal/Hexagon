import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for Method Syntax §3: **a dot call's subject is decided by the
 * program's text, or the dot is refused.**
 *
 * A dot call is sugar for its module's function, `Module.name(subject, …)`. It
 * chooses that function from its subject's type, so the type must be one the
 * text decides: a written type, a literal, a name from outside the function, a
 * parameter whose type lands from a decided call, or a value made from those
 * (§3.1). Nothing waits for a later line to say what the subject is: where the
 * text does not decide it, the dot is refused at the dot (§3.5), and the
 * fundamental spellings remain — write the type, call the function by its
 * module, or call a record's field as `(e.name)(…)`.
 *
 * The pairs below are the same lines in both orders: the verdict, and the
 * report, never follow the order the lines come in.
 */

const HEADER = "module Main\n\n";

function refusal(subject: string, name: string): string {
  return `the program's text does not decide \`${subject}\`'s type here, so \`.${name}(…)\` ` +
    `cannot tell whose \`${name}\` it is — write \`${subject}\`'s type, or call the operation ` +
    `by its module (\`Module.${name}(${subject}, …)\`); a record's field is called as ` +
    `\`(${subject}.${name})(…)\``;
}

/** The refusal where the subject is not a name. */
function refusalOfSubject(name: string): string {
  return `the program's text does not decide the subject's type here, so \`.${name}(…)\` cannot tell ` +
    `whose \`${name}\` it is — write the subject's type, or call the operation by its module ` +
    `(\`Module.${name}(…, …)\`); a record's field is called as \`(….${name})(…)\``;
}

/** The diagnostics of `head`, then `lines` in the given order, then `tail`. */
function inOrder(head: string, lines: readonly string[], tail = "    ()\n"): readonly string[] {
  return projectDiagnostics(HEADER + head + "\n" + lines.map((line) => `    ${line}\n`).join("") + tail);
}

/** The same two lines in both orders give the same reports, which are `expected`. */
function bothOrders(head: string, first: string, second: string, expected: readonly string[]): void {
  expect(inOrder(head, [first, second])).toEqual(expected);
  expect(inOrder(head, [second, first])).toEqual(expected);
}

describe("a subject a later or an earlier line fixes is not decided by the text (§3.1, §3.5)", () => {
  test("an untyped parameter that a qualified call shows is a `Vector`", () => {
    bothOrders("let f(v) =", "let a = v.get(0)", "let b = Vector.isEmpty(v)", [refusal("v", "get")]);
  });

  test("an untyped parameter that an annotation shows is a `Vector`", () => {
    bothOrders("let f(v) =", "let a = v.isEmpty()", "let w: Vector(Int) = v", [refusal("v", "isEmpty")]);
  });

  test("an untyped sequence source", () => {
    bothOrders("let f(s) =", "let a = s.map((x) => x)", "let p: Seq(String) = s", [refusal("s", "map")]);
  });

  test("an untyped parameter that a `Map` annotation fixes", () => {
    bothOrders(
      "let f(m) =",
      "let a = m.containsKey(1)",
      "let w: Map(Int, String) = m",
      [refusal("m", "containsKey")],
    );
  });

  test("an untyped parameter that arithmetic shows is an `Int`", () => {
    bothOrders("let f(x) =", "let a = x.show()", "let b: Int = x + 1", [refusal("x", "show")]);
  });

  test("an untyped structural record: the dot is refused, the field call is not", () => {
    bothOrders("let f(r) =", "let a = r.cb()", "let z: {cb: () -> Unit} = r", [refusal("r", "cb")]);
    bothOrders("let f(r) =", "let a = (r.cb)()", "let z: {cb: () -> Unit} = r", []);
  });

  test("a pattern's part of an untyped parameter", () => {
    bothOrders(
      "let f(o) =",
      "let a = match o\n        Some(v) => v.isEmpty()\n        None => True",
      "let w: Option(Vector(Int)) = o",
      [refusal("v", "isEmpty")],
    );
  });

  test("a loop variable over an untyped parameter", () => {
    bothOrders(
      "let f(xs) =",
      "for v in xs\n        ignore(v.isEmpty())",
      "let w: Vector(Vector(Int)) = xs",
      [refusal("v", "isEmpty")],
    );
  });

  test("a lambda's parameter whose type comes through an untyped callback", () => {
    bothOrders(
      "let f(s: Seq(Int), g) =",
      "let a = Seq.map(Seq.map(s, g), (y) => y.show())",
      "let h: (Int) -> Int = g",
      [refusal("y", "show")],
    );
  });

  test("a part of a `var` its assignments fill", () => {
    bothOrders(
      "let f() =\n    var holder = Vector.empty",
      "let n = match Vector.first(holder)\n        Some(b) => b.isEmpty()\n        None => True",
      "holder := [[1]]",
      [refusal("b", "isEmpty")],
    );
  });

  test("a `var` holding a bare numeric literal, whose assignments choose its type", () => {
    bothOrders("let f() =\n    var n = 0", "let s = n.show()", "let m: BigInt = n", [refusal("n", "show")]);
    // Its written type decides it.
    bothOrders("let f() =\n    var n: Int = 0", "let s = n.show()", "n := n + 1", []);
  });

  test("a call to a member of a `fun` block still open, whatever its signature writes", () => {
    const member = (order: readonly string[]): readonly string[] =>
      projectDiagnostics(HEADER + "fun\n" + order.map((line) => `    ${line}\n`).join(""));
    const a = "a(n: Int): Bool = if n > 3 then b(n).isEmpty() else a(n + 1)";
    const b = "b(n: Int): Vector(Int) = if n > 9 then [n] else (if a(n) then [] else [1])";
    const refused = [refusalOfSubject("isEmpty")];
    expect(member([a, b])).toEqual(refused);
    expect(member([b, a])).toEqual(refused);
    // The module's spelling is the fundamental one.
    expect(member([a.replace("b(n).isEmpty()", "Vector.isEmpty(b(n))"), b])).toEqual([]);
  });

  test("a `var` its assignment fills before the dot is still not decided", () => {
    bothOrders(
      "let f() =\n    var holder = Vector.empty",
      "for b in holder\n        ignore(b.isEmpty())",
      "holder := [[\"a\"]]",
      [refusal("b", "isEmpty")],
    );
  });

  test("a loop variable over a literal holding an untyped parameter", () => {
    bothOrders("let f(x) =", "for v in [x]\n        ignore(v.isEmpty())", "let w: Vector(Int) = x", [
      refusal("v", "isEmpty"),
    ]);
  });

  test("arithmetic on an untyped parameter", () => {
    bothOrders("let f(x) =", "let a = (x + 1).show()", "let b: Float = x", [refusalOfSubject("show")]);
  });

  test("a lambda inside a literal argument, typed through an untyped argument", () => {
    bothOrders(
      "let applyIn(fs: Vector((a) -> String), x: a): Int = Vector.length(fs)\nlet f(x) =",
      "let a = applyIn([(y) => y.show()], x)",
      "let w: Int = x",
      [refusal("y", "show")],
    );
  });

  test("a call whose result comes through a lambda capturing an untyped parameter", () => {
    bothOrders(
      "let apply(f: (a) -> b, x: a): b = f(x)\nlet f(y) =",
      "let a = apply((u) => y, 1).isEmpty()",
      "let w: Vector(Int) = y",
      [refusalOfSubject("isEmpty")],
    );
  });

  test("a branch holding an untyped parameter", () => {
    bothOrders(
      "let f(c: Bool, x) =",
      "let a = (if c then x else []).isEmpty()",
      "let w: Vector(Int) = x",
      [refusalOfSubject("isEmpty")],
    );
  });

  test("a part beneath a hole in a written type", () => {
    bothOrders(
      "let f(o: Option(_)) =",
      "let a = match o\n        Some(v) => v.isEmpty()\n        None => True",
      "let w: Option(Vector(Int)) = o",
      [refusal("v", "isEmpty")],
    );
  });

  test("a part of a `let` whose type kept a part a later line fills", () => {
    bothOrders(
      "let ident(x: a): a = x\nlet f() =\n    let holder = ident(Vector.empty)",
      "let n = match Vector.first(holder)\n        Some(b) => b.isEmpty()\n        None => True",
      "let w: Vector(Vector(Int)) = holder",
      [refusal("b", "isEmpty")],
    );
  });

  test("a part of a destructuring `let` whose part a later line fills", () => {
    bothOrders(
      "let ident(x: a): a = x\nlet f() =\n    let (held, k) = ident((Vector.empty, 1))",
      "let n = match Vector.first(held)\n        Some(b) => b.isEmpty()\n        None => True",
      "let w: Vector(Vector(Int)) = held",
      [refusal("b", "isEmpty")],
    );
  });

  test("a body that waits on nothing: #1173's shape is one report in either order", () => {
    bothOrders(
      "let noop(): Unit = ()\nlet run(source) =",
      "let act = () =>\n        let u = source.forEach((value) => ())\n        ()",
      "let pinned: Seq(String) = source",
      [refusal("source", "forEach")],
    );
  });
});

describe("a subject the text decides dispatches at the dot (§3.1)", () => {
  const compiles = (source: string): void => {
    expect(projectDiagnostics(HEADER + source)).toEqual([]);
  };

  test("a written type, whole or with a hole beneath its head", () => {
    compiles("let f(v: Vector(Int)): Bool = v.isEmpty()\n");
    compiles("let f(v: Vector(_)): Bool = v.isEmpty()\n");
  });

  test("a comparison is a `Bool` whatever it compares", () => {
    compiles("let f(x): String = (x == 1).show()\n");
  });

  test("an ascription decides the subject it writes", () => {
    compiles("let f(v): Bool = (v: Vector(Int)).isEmpty()\n");
  });

  test("a literal: a numeric one takes its default at the dot", () => {
    compiles("let s: String = 42.show()\nlet d: Int = 7.div(2)\nlet t: String = \"a,b\".toUpper()\n");
  });

  test("a `let` made from literals is decided where it is bound", () => {
    compiles("let f() =\n    let n = 40 + 2\n    let m: BigInt = n\n    n.show()\n");
  });

  test("a `var` whose initializer fixes its head, and one its written type fixes", () => {
    compiles("let f(): Bool =\n    var acc = []\n    acc := Vector.append(acc, 1)\n    acc.isEmpty()\n");
    compiles("let f(): Bool =\n    var acc: Vector(Int) = []\n    acc.isEmpty()\n");
  });

  test("a lambda's parameter whose type lands from a decided call", () => {
    compiles("let f(xs: Seq(Int)): Seq(String) = xs.map((x) => x.show())\n");
    compiles("let f(xs: Seq(Int)): Seq(String) = Seq.map(xs, (x) => x.show())\n");
  });

  test("a pattern's part and a loop variable taken from a decided value", () => {
    compiles(
      "let f(o: Option(Vector(Int))): Bool = match o\n    Some(v) => v.isEmpty()\n    None => True\n",
    );
    compiles("let f(xs: Vector(Vector(Int))) =\n    for v in xs\n        ignore(v.isEmpty())\n");
  });

  test("a value made from decided names", () => {
    compiles("let f(): Bool =\n    let v = Vector.singleton(1)\n    v.isEmpty()\n");
    compiles("let f(xs: Seq(Int)): Int = xs.map((x) => x + 1).length()\n");
  });

  test("an honor member's parameters, which the contract types", () => {
    compiles(
      "record Box = {n: Int}\n" +
        "honor Show<Box> =\n    show(b) = b.n.show()\n" +
        "let s: String = Box({n = 4}).show()\n",
    );
  });

  test("a decided structural record's field, called through the dot", () => {
    compiles("let f(r: {cb: (Int) -> Int, ...}): Int = r.cb(3)\n");
  });
});

describe("#1182: a lambda's parameter typed only through a generic call", () => {
  const IDENT = "let ident(x: a): a = x\n";

  test("the dot is refused, where it once compiled and called `undefined`", () => {
    expect(projectDiagnostics(
      HEADER + IDENT + "export let probe(): Unit = ident((r) => r.run())({run = () => ()})\n",
    )).toEqual([refusal("r", "run")]);
  });

  test("the field call is the spelling that runs", async () => {
    const exports = await runMain(
      HEADER + IDENT + "export let probe(): Int = ident((r) => (r.run)())({run = () => 7})\n",
    );
    expect((exports["probe"] as () => number)()).toBe(7);
  });
});

describe("a subject that already failed draws no second report (§3.5)", () => {
  test("an unknown name", () => {
    expect(projectDiagnostics(HEADER + "let s: String = nope.show()\n")).toEqual(["unknown name `nope`"]);
  });

  test("a subject its own elaboration refused", () => {
    const reports = projectDiagnostics(HEADER + "let s: String = (1 + \"a\").show()\n");
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.filter((report) => report.includes("does not decide"))).toEqual([]);
  });
});

test("a `match` on a refused dot call says nothing more", () => {
  expect(projectDiagnostics(
    HEADER + "let f(o): Int = match o.first()\n    Some(g) => 1\n    None => 0\n",
  )).toEqual([refusal("o", "first")]);
});

test("the refusal stands at the dot's name", () => {
  const source = HEADER + "let f(v) = v.isEmpty()\n";
  const [report] = compileFiles([["/main.hex", source]]).diagnostics;
  expect(source.slice(report!.primary.start.offset, report!.primary.end.offset)).toBe("isEmpty");
});
