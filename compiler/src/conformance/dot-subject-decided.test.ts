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

  test("a `var` holding a bare numeric literal is an `Int` where it is made", () => {
    // A new name made from a number type nothing has decided takes `Int` there
    // (Numeric Literals §4), so its later lines read an `Int` in either order;
    // an `Int` widens into a `BigInt` seat.
    bothOrders("let f() =\n    var n = 0", "let s = n.show()", "let m: BigInt = n", []);
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

  test("a lambda in a pipe stage, whose piped value is not decided, and a lambda piped into", () => {
    bothOrders(
      "let f(p) =",
      "let a = p |> Seq.map((x) => x.length())",
      "let b: Seq(Vector(Int)) = p",
      [refusal("x", "length")],
    );
    bothOrders("let f(p) =", "let a = p |> (x) => x.length()", "let b: Vector(Int) = p", [refusal("x", "length")]);
  });

  test("a curried lambda is not decided by the call its outer lambda is an argument of", () => {
    bothOrders(
      "let f(g) =",
      "let a = g((u: Int) => (w: Vector(Int)) => 0)",
      "let b = g((u) => (w) => w.length())",
      [refusal("w", "length")],
    );
  });

  test("an applied lambda is not decided by its arguments", () => {
    bothOrders("let f(p) =", "let a = ((x) => x.length())(p)", "let b: Vector(Int) = p", [refusal("x", "length")]);
  });

  test("a lambda under a constructor is not decided by the call the constructor is an argument of", () => {
    bothOrders(
      "let f(g) =",
      "let a = g(Some((x: Vector(Int)) => 0))",
      "let b = g(Some((x) => x.length()))",
      [refusal("x", "length")],
    );
  });

  test("a lambda handed a member of a `fun` block still open, in either member order", () => {
    const member = (order: readonly string[]): readonly string[] =>
      projectDiagnostics(HEADER + "fun\n" + order.map((line) => `    ${line}\n`).join(""));
    const a = "a(n: Int): Bool = if n > 3 then b(n) |> (v) => v.isEmpty() else a(n + 1)";
    const b = "b(n: Int): Vector(Int) = if n > 9 then [n] else (if a(n) then [] else [1])";
    expect(member([a, b])).toEqual([refusal("v", "isEmpty")]);
    expect(member([b, a])).toEqual([refusal("v", "isEmpty")]);
    const c = "c(n: Int): Bool = if n > 3 then Seq.any(b(n), (k) => k.show() == \"1\") else c(n + 1)";
    const d = "b(n: Int): Vector(Int) = if n > 9 then [n] else (if c(n) then [] else [1])";
    expect(member([c, d])).toEqual([refusal("k", "show")]);
    expect(member([d, c])).toEqual([refusal("k", "show")]);
    // A lambda handed to the open member itself, whatever its signature writes:
    // its subject is read as anywhere else, beside the refusal of a function
    // made inside the recursion (Effects §3.4, #1218).
    const go = "go(n: Int, k: (Vector(Int)) -> Int): Int = if n == 0 then k([]) else go(n - 1, (r) => k(r.append(n)))";
    const made = "this function is not one `go` was given, and a recursive call hands on only the callbacks " +
      "it was given";
    expect(member([go])).toEqual([made, refusal("r", "append")]);
    expect(member([go.replace("(r) =>", "(r: Vector(Int)) =>")])).toEqual([made]);
  });

  test("a local `fun` capturing an untyped parameter", () => {
    bothOrders(
      "let f(p) =\n    fun inner() = p",
      "let a = Vector.length(p)",
      "let b = inner().length()",
      [refusalOfSubject("length")],
    );
  });

  test("a `var` whose initializer is a number nothing decided: its assignments do not choose its type", () => {
    bothOrders(
      "let f(c: Bool) =\n    var x = if c then 0 else 1",
      "let s = x.show()",
      "x := 1.5",
      ["type mismatch: expected Int, found Float"],
    );
  });

  test("a part of a `match` arm, whatever order the arms come in", () => {
    const arms = (first: string, second: string): readonly string[] =>
      projectDiagnostics(
        HEADER + "let f() =\n    let a = match Vector.empty\n" +
          `        ${first}\n        ${second}\n        _ => ""\n    ()\n`,
      );
    const one = "[x] => Int.show(x)";
    const two = "[x, y] => y.show()";
    expect(arms(one, two)).toEqual([refusal("y", "show")]);
    expect(arms(two, one)).toEqual([refusal("y", "show")]);
  });

  test("an operation on an untyped parameter, read through every operator and form", () => {
    bothOrders("let f(p) =", "let a = (-p).show()", "let w: Int = p", [refusalOfSubject("show")]);
    bothOrders("let f(c: Bool, p) =", "let a = (if c then [] else p).isEmpty()", "let w: Vector(Int) = p", [
      refusalOfSubject("isEmpty"),
    ]);
    bothOrders("let ident(x: a): a = x\nlet f(p) =", "let a = (p |> ident).isEmpty()", "let w: Vector(Int) = p", [
      refusalOfSubject("isEmpty"),
    ]);
    bothOrders("let f(x) =", "let a = (x: _).show()", "let w: Int = x", [refusalOfSubject("show")]);
  });

  test("what a value is made of, read wholly", () => {
    bothOrders(
      "let f(x) =",
      "for v in (x: Vector(_))\n        ignore(v.isEmpty())",
      "let w: Vector(Vector(Int)) = x",
      [refusal("v", "isEmpty")],
    );
    bothOrders("let f(p) =\n    let k = () => p", "let a = k().isEmpty()", "let w: Vector(Int) = p", [
      refusalOfSubject("isEmpty"),
    ]);
    bothOrders("let f(p) =\n    let r = {g = p}", "let a = r.g.isEmpty()", "let w: Vector(Int) = p", [
      refusalOfSubject("isEmpty"),
    ]);
    bothOrders("let f(r) =", "let a = r.g.show()", "let z: {g: Int} = r", [refusalOfSubject("show")]);
    bothOrders(
      "let f(r) =\n    let q = {r with a = 1}",
      "let n = q.b.isEmpty()",
      "let w: {a: Int, b: Vector(Int)} = r",
      [refusalOfSubject("isEmpty")],
    );
    bothOrders("let f(r) =", "let n = {r with a = 1}.b.isEmpty()", "let w: {a: Int, b: Vector(Int)} = r", [
      refusalOfSubject("isEmpty"),
    ]);
    bothOrders(
      "let f(r) =",
      "let q = {r with cb = (x) => x.length()}",
      "let z: {cb: (Vector(Int)) -> Int} = r",
      [refusal("x", "length")],
    );
    bothOrders("let f(p, q) =", "for i in p..q\n        ignore(i.show())", "let w: Int = p", [
      refusal("i", "show"),
    ]);
  });

  test("a constructor a lambda hands back does not decide its lambdas", () => {
    bothOrders(
      "let apply2(v: a, f: (a) -> Option((a) -> Int)): Int = 0\nlet f(q) =",
      "let w: Vector(Int) = q",
      "let b = apply2(q, (u) => Some((x) => x.length()))",
      [refusal("x", "length")],
    );
  });

  test("a constructor whose expectation comes from a `var` or a `with` override's target", () => {
    bothOrders(
      "let f(g) =\n    var o = Some(g)",
      "let a = g([1])",
      "o := Some((x) => x.length())",
      [refusal("x", "length")],
    );
    bothOrders(
      "let f(r) =",
      "let q = {r with cb = Some((x) => x.length())}",
      "let z: {cb: Option((Vector(Int)) -> Int)} = r",
      [refusal("x", "length")],
    );
  });

  test("an earlier sibling lambda's body can settle what a later one lands", () => {
    bothOrders(
      "let both(f: (t) -> Bool, g: (t) -> Int): Int = 0\nlet f(q) =",
      "let w: Vector(Int) = q",
      "let b = both((a) => a == q, (b) => b.length())",
      [refusal("b", "length")],
    );
  });

  test("a constructor a lambda hands back, piped into an untyped function", () => {
    bothOrders(
      "let f(h) =",
      "let a = h((u: Int) => Some((v: Vector(Int)) => 0))",
      "let b = ((u) => Some((x) => x.length())) |> h",
      [refusal("x", "length")],
    );
  });

  test("a lambda, or a constructor holding one, piped into an untyped function", () => {
    bothOrders("let f(h) =", "let a = h((v: Vector(Int)) => 0)", "let b = ((x) => x.length()) |> h", [
      refusal("x", "length"),
    ]);
    bothOrders(
      "let f(h) =",
      "let a = h(Some((v: Vector(Int)) => 0))",
      "let b = Some((x) => x.length()) |> h",
      [refusal("x", "length")],
    );
  });

  test("a hole in a written type that an earlier element or path fills", () => {
    // The written slot is a hole, so the written type decides nothing for `x`;
    // what the earlier value put there came from wherever its type did.
    bothOrders(
      "let f(g) =",
      "let a: Int = g([1])",
      "let h: Vector((_) -> Int) = [g, (x) => x.length()]",
      [refusal("x", "length")],
    );
    bothOrders(
      "let f(q, c: Bool) =",
      "let a = Vector.length(q)",
      "let k: (_) -> Int = if c then (y) => Vector.length([y, q]) else (x) => x.length()",
      [refusal("x", "length")],
    );
    bothOrders(
      "let f(g, c: Bool) =",
      "let a: Int = g([1])",
      "let h: Option((_) -> Int) = if c then Some(g) else Some((x) => x.length())",
      [refusal("x", "length")],
    );
    bothOrders(
      "let f(g) =",
      "let a: Int = g([1])",
      "let h: Vector(Option((_) -> Int)) = [Some(g), Some((x) => x.length())]",
      [refusal("x", "length")],
    );
    // A head written above the hole decides the head, never the whole.
    bothOrders(
      "let f(g, w: Vector(Vector(Int))) =",
      "let a: Int = g(w)",
      "let h: Vector((Vector(_)) -> Int) = [g, (x) =>\n        for v in x\n            ignore(v.isEmpty())\n        0]",
      [refusal("v", "isEmpty")],
    );
  });

  test("a part of a lambda's parameter whose type landed with a part open", () => {
    // A hole in the written type, and a polymorphic value's instance in the
    // call, leave a part of the parameter's type to whichever line of the body
    // comes first, so the parameter is decided only at its head.
    const inBody = (head: string, first: string, second: string, tail = "        0"): readonly (readonly string[])[] =>
      [[first, second], [second, first]].map((lines) =>
        projectDiagnostics(
          HEADER + "let f() =\n" + head + "\n" + lines.map((line) => line.replace(/^/gm, "        ") + "\n").join("") +
            tail + "\n    ()\n",
        )
      );
    const loop = "for v in x\n    ignore(v.isEmpty())";
    for (
      const reports of [
        inBody("    let k: (Vector(_)) -> Int = (x) =>", loop, "let w: Vector(Vector(Int)) = x"),
        inBody("    let s = Seq.map(Seq.singleton(Vector.empty), (x) =>", loop, "let w: Vector(Vector(Int)) = x", "        0)"),
        inBody(
          "    let s = Seq.map(Seq.singleton(None), (x) =>",
          "let a = Option.map(x, (v) => v.isEmpty())",
          "let w: Option(Vector(Int)) = x",
          "        0)",
        ),
      ]
    ) {
      expect(reports).toEqual([[refusal("v", "isEmpty")], [refusal("v", "isEmpty")]]);
    }
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
    compiles("let f(xs: Seq(Int)): Seq(String) = xs |> Seq.map((x) => x.show())\n");
    compiles("let f(xs: Seq(Vector(Int))): Seq(Int) = Seq.map(xs, if True then (x) => x.length() else (x) => 0)\n");
  });

  test("a part of a lambda's parameter whose landed type holds only declared type variables", () => {
    compiles(
      "let f(xs: Seq(Vector(Vector(a)))): Seq(Int) = Seq.map(xs, (x) =>\n" +
        "    var n = 0\n    for v in x\n        n := n + v.length()\n    n)\n",
    );
  });

  test("a lambda inside a literal argument of a named function's call", () => {
    compiles("let use(fs: Vector((Vector(Int)) -> Int)): Int = 0\nlet n = use([(x) => x.length()])\n");
    compiles("let use(t: ((Vector(Int)) -> Int, Int)): Int = 0\nlet n = use(((x) => x.length(), 1))\n");
    compiles("let use(r: {f: (Vector(Int)) -> Int}): Int = 0\nlet n = use({f = (x) => x.length()})\n");
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

  test("a lambda's parameter its own written type decides, wherever the lambda stands", () => {
    compiles("let h: (Vector(Int)) -> Int = (w) => w.length()\n");
    compiles(
      "let f(g) =\n    let a = g({cb = (u: Int) => 0})\n    let b = g({cb = (u) =>\n" +
        "        let h: (Vector(Int)) -> Int = (w) => w.length()\n        0})\n    ()\n",
    );
  });

  test("an ascription whose written slot has a head decides the lambda it writes", () => {
    compiles("let k = ((x) => x.length() : (Vector(_)) -> Int)\n");
  });

  test("a lambda under a written type whose head is written, through forwarding forms", () => {
    compiles("let mk(): (Vector(a)) -> Int = (x) => x.length()\n");
    compiles("let f(y: Vector(a)): Int =\n    let k: (Vector(a)) -> Int = (x) => x.length()\n    k(y)\n");
    compiles("let k: (Vector(_)) -> Int = (x) => x.length()\n");
    compiles("let c: Bool = True\nlet k: (Vector(Int)) -> Int = if c then (x) => x.length() else (x) => 0\n");
    compiles("let k: (Int) -> (Vector(Int)) -> Int = (u) => (x) => x.length()\n");
    compiles("let f(y: Vector(a)): Int =\n    let t: ((Vector(a)) -> Int, Int) = ((x) => x.length(), 1)\n    1\n");
  });

  test("a lambda on a `try`'s value paths and a `match` arm's", () => {
    compiles(
      "let f(xs: Seq(Vector(Int))): Seq(Int) = Seq.map(xs, try\n" +
        "    (x) => x.length()\ncatch\n    _ => (x) => 0)\n",
    );
    compiles(
      "let g(h: (Vector(Int)) -> Int): Int = h([1])\nlet f(k: Int): Int = g(match k\n" +
        "    0 => (x) => x.length()\n    _ => (x) => 0)\n",
    );
  });

  test("a `match` or a `try` on a call's spine is read by its value paths, as an `if` is (#1193)", () => {
    // What the lambda asked about captures, and the scrutinee, are not read.
    bothOrders(
      "let f(xs: Seq(Vector(Int)), k, c: Bool) =",
      "let a = Seq.map(xs, match c\n        True => (x) => x.length() + k\n        False => (x) => 0)",
      "let b: Int = k",
      [],
    );
    bothOrders(
      "let f(xs: Seq(Vector(Int)), o) =",
      "let a = Seq.map(xs, match o\n        Some(_) => (x) => x.length()\n        None => (x) => 0)",
      "let b: Option(Int) = o",
      [],
    );
    bothOrders(
      "let f(xs: Seq(Vector(Int)), k) =",
      "let a = Seq.map(xs, try\n        (x) => x.length() + k\n    catch\n        _ => (x) => 0)",
      "let b: Int = k",
      [],
    );
    // A `match` as a dot's subject is its arms' type, whatever its scrutinee
    // and its guards read.
    bothOrders(
      "let f(c: Bool, k) =",
      "let w: Int = k",
      "let n = (match c\n        True when k > 0 => [1]\n        _ => [2]).length()",
      [],
    );
    bothOrders(
      "let f(o) =",
      "let n = (match o\n        Some(_) => [1]\n        None => [2]).length()",
      "let w: Option(Int) = o",
      [],
    );
  });

  test("a constructor's slot under a written type, as its declaration writes it", () => {
    compiles("let mk(): Option((Vector(Int)) -> Int) = Some((x) => x.length())\n");
    compiles("let k: Option((Vector(_)) -> Int) = Some((x) => x.length())\n");
    compiles("let k: Option(Option((Vector(_)) -> Int)) = Some(Some((x) => x.length()))\n");
    compiles(
      "let f(c: Bool) =\n    let k: Option((Vector(_)) -> Int) = if c then Some((x) => x.length()) else None\n    ()\n",
    );
    compiles(
      "let f(c: Bool) =\n    let k: Option((Vector(_)) -> Int) = match c\n" +
        "        True => Some((x) => x.length())\n        False => None\n    ()\n",
    );
    compiles("let k: Option((Vector(_)) -> Int) = try\n    Some((x) => x.length())\ncatch\n    _ => None\n");
    // A slot with no hole, beside a hole elsewhere in the shared type.
    compiles("let t: Vector((Option((Vector(Int)) -> Int), (_) -> Int)) = [(Some((x) => x.length()), (y) => 0)]\n");
    const w = "record W(a) = {f: (a) -> Int}\n";
    compiles(w + "let w: W(Vector(_)) = W({f = (x) => x.length()})\n");
    compiles("union U = Mk((Vector(Int)) -> Int)\nlet u: U = Mk((x) => x.length())\n");
    // Each of the declaration's parameters takes its own argument of the written type.
    const s2 = "union S(a, b) = MkS((a) -> Int, (b) -> Int)\n";
    compiles(s2 + "let s: S(Vector(Int), _) = MkS((x) => x.length(), (y) => 0)\n");
    // Grouping changes nothing.
    compiles("let k: Option((Vector(_)) -> Int) = (Some)((x) => x.length())\n");
    compiles(w + "let w: W(Vector(_)) = W(({f = (x) => x.length()}))\n");
    compiles(w + "let w: W(Vector(_)) = (W)({f = (x) => x.length()})\n");
    // A `with` update's overrides are the construction's slots too, whatever
    // the update's base is and whichever line types it.
    const wn = "record WN(a) = {f: (a) -> Int, n: Int}\n";
    bothOrders(
      wn + "let g(base) =",
      "let a: {f: (Vector(Int)) -> Int, n: Int} = base",
      "let w: WN(Vector(Int)) = WN({base with f = (x) => x.length()})",
      [],
    );
    compiles(
      "record W0 = {f: (Vector(Int)) -> Int, n: Int}\nlet g(base) =\n    let w = W0({base with f = (x) => x.length()})\n    ()\n",
    );
    // The slot's written head, whatever an earlier path's type is.
    bothOrders(
      "let f(g, c: Bool) =",
      "let a: Int = g([1])",
      "let h: Option((Vector(_)) -> Int) = if c then Some(g) else Some((x) => x.length())",
      [],
    );
    bothOrders(
      "let f(g) =",
      "let a: Int = g([1])",
      "let h: Vector(Option((Vector(_)) -> Int)) = [Some(g), Some((x) => x.length())]",
      [],
    );
  });

  test("a lambda's own body does not decide its parameter, so what it captures is read past", () => {
    compiles(
      "let f(xs: Seq(Vector(Int)), p): Seq(Int) = xs.map((x) =>\n" +
        "    let k = Vector.length(p)\n    x.length())\n",
    );
  });

  test("a range is a `Range` whatever its operands", () => {
    compiles("let f(p, q) = (p..q).toSeq()\n");
  });

  test("a call whose callee's declaration fixes its result, whatever it is handed", () => {
    compiles("let f(p) =\n    let a = Vector.length(p).show()\n    let w: Vector(Int) = p\n    a\n");
    compiles("let f(n) =\n    let a = Int.show(n).length()\n    a\n");
  });

  test("a logical operation is a `Bool`, and an ascription over a decided value decides it", () => {
    compiles("let f(p) = (p and True).show()\n");
    compiles("let f(p) = (not p).show()\n");
    compiles("let f(v: Vector(Int)) = (v: _).isEmpty()\n");
  });

  test("a caught exception's parts, which its declaration types", () => {
    compiles(
      "let f(xs: Vector(Int)): String =\n    try\n        xs[3].show()\n    catch\n" +
        "        IndexError(at, size) => at.show()\n",
    );
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

describe("a lambda no written type and no named call reaches is not decided, whatever surrounds it (§3.1)", () => {
  const refused = (source: string, subject: string, name: string): void => {
    expect(projectDiagnostics(HEADER + source)).toEqual([refusal(subject, name)]);
  };
  const compiles = (source: string): void => {
    expect(projectDiagnostics(HEADER + source)).toEqual([]);
  };

  test("a lambda on a pipe's right is decided as a `let` of the piped value is, and only so", () => {
    compiles("let f(v: Vector(Int)): Int = v |> (x) => x.length()\n");
    compiles("let f(): String = 5 |> (n) => n.show()\n");
    refused("let f(v) = v |> (x) => x.length()\n", "x", "length");
    compiles("let f(v) = v |> (x: Vector(Int)) => x.length()\n");
  });

  test("a `with` override's lambda, where no constructor holds the update", () => {
    const q = "record Q = {f: (Vector(Int)) -> Int}\n";
    refused(q + "let g(q: Q): Q = {q with f = (x) => x.length()}\n", "x", "length");
    compiles(q + "let g(q: Q): Q = {q with f = (x: Vector(Int)) => x.length()}\n");
  });

  test("a curried lambda is not decided; an applied one reads its argument", () => {
    const apply2 = "let apply2(f: (Int) -> (Vector(Int)) -> Int): Int = f(1)([2])\n";
    refused(apply2 + "let n = apply2((u) => (w) => w.length())\n", "w", "length");
    compiles(apply2 + "let n = apply2((u) => (w) => Vector.length(w))\n");
    // Applied where it is written, a lambda reads its argument as a `let` does.
    compiles("let f(v: Vector(Int)): Int = ((x) => x.length())(v)\n");
    refused("let f(v) = ((x) => x.length())(v)\n", "x", "length");
  });

  test("a lambda handed to a call whose callee is not a named function", () => {
    const mk = "let mk(n: Int): ((Vector(Int)) -> Int) -> Int = (g) => g([n])\n";
    refused(mk + "let k = mk(1)((x) => x.length())\n", "x", "length");
    compiles(mk + "let k = mk(1)((x: Vector(Int)) => x.length())\n");
  });

  test("a record's construction decides a lambda only where the field's declaration writes the slot whole", () => {
    compiles("record Q = {f: (Vector(Int)) -> Int}\nlet h() =\n    let q = Q({f = (x) => x.length()})\n    ()\n");
    const r = "record R(a) = {sample: a, apply: (Vector(a)) -> Int}\n";
    refused(r + "let h() =\n    let q = R({sample = 1, apply = (d) => d.length()})\n    ()\n", "d", "length");
    compiles(r + "let h() =\n    let q: R(Int) = R({sample = 1, apply = (d) => d.length()})\n    ()\n");
  });

  test("a hole in the written slot decides nothing, whatever an earlier element is", () => {
    refused("let f() =\n    let h: Vector((_) -> Int) = [(y: Vector(Int)) => 0, (x) => x.length()]\n    ()\n", "x", "length");
    compiles("let f() =\n    let h: Vector((Vector(_)) -> Int) = [(y: Vector(Int)) => 0, (x) => x.length()]\n    ()\n");
  });

  test("a hole in a constructor's slot decides nothing, whatever the constructor's other arguments are", () => {
    // A constructor is never read as a call: only its slot, as the written type gives it.
    const g0 = "let g0(v: Vector(Int)): Int = 0\n";
    refused(g0 + "let f() =\n    let k: Option(Vector((_) -> Int)) = Some([g0, (x) => x.length()])\n    ()\n", "x", "length");
    const pair = "union P(a) = Pair(a, (a) -> Int)\n";
    refused(pair + "let f() =\n    let p: P(_) = Pair([1], (x) => x.length())\n    ()\n", "x", "length");
    const w = "record W(a) = {f: (a) -> Int}\n";
    refused(w + "let f() =\n    let w: W(_) = W({f = (x) => x.length()})\n    ()\n", "x", "length");
    const s2 = "union S(a, b) = MkS((a) -> Int, (b) -> Int)\n";
    refused(s2 + "let f() =\n    let s: S(_, Vector(Int)) = MkS((x) => x.length(), (y) => 0)\n    ()\n", "x", "length");
    // A head written above the hole decides the head, never the whole.
    const mv = "union MV(a) = MkV(a, (Vector(a)) -> Int)\n";
    refused(
      mv + "let f() =\n    let m: MV(_) = MkV([1], (x) =>\n        for v in x\n            ignore(v.isEmpty())\n        0)\n    ()\n",
      "v",
      "isEmpty",
    );
    // A sibling argument typed on another line decides nothing either.
    bothOrders(
      pair + "let f(g) =",
      "let a: Vector(Int) = g",
      "let p: P(_) = Pair(g, (x) => x.length())",
      [refusal("x", "length")],
    );
    // The written type that gives the slot its head is the spelling.
    compiles(pair + "let f() =\n    let p: P(Vector(Int)) = Pair([1], (x) => x.length())\n    ()\n");
    compiles(mv + "let f() =\n    let m: MV(Vector(Int)) = MkV([1], (x) =>\n        for v in x\n            ignore(v.isEmpty())\n        0)\n    ()\n");
    compiles(g0 + "let f() =\n    let k: Option(Vector((Vector(Int)) -> Int)) = Some([g0, (x) => x.length()])\n    ()\n");
  });

  test("a constructor applied to the wrong number of arguments under a written type", () => {
    expect(projectDiagnostics(
      HEADER + "let f() =\n    let k: Option((Vector(_)) -> Int) = Some((x) => x.length(), 1)\n    ()\n",
    )).toEqual(["function expects 1 arguments, got 2", refusal("x", "length")]);
  });

  test("a value path a `match` or a `try` takes from an untyped name", () => {
    bothOrders(
      "let f(c: Bool, v) =",
      "let n = (match c\n        True => v\n        False => [1]).length()",
      "let w: Vector(Int) = v",
      [refusalOfSubject("length")],
    );
    bothOrders(
      "let f(v) =",
      "let n = (try\n        v\n    catch\n        _ => [1]).length()",
      "let w: Vector(Int) = v",
      [refusalOfSubject("length")],
    );
    bothOrders(
      "let f(v) =",
      "let n = (try\n        [1]\n    catch\n        _ => v).length()",
      "let w: Vector(Int) = v",
      [refusalOfSubject("length")],
    );
    // A `match`'s catch arms are value paths too.
    bothOrders(
      "exception Boom(line: Int)\nlet source(c: Bool): Bool = if c then throw(Boom(3)) else True\nlet f(c: Bool, v) =",
      "let m =\n        match source(c)\n            True => [1]\n            False => [2]\n        catch\n            _ => v\n    let n = m.length()",
      "let w: Vector(Int) = v",
      [refusal("m", "length")],
    );
    bothOrders(
      "let f(xs: Seq(Vector(Int)), o) =",
      "let a = Seq.map(xs, match o\n        Some(k) => k\n        None => (x) => x.length())",
      "let b: Option((Vector(Int)) -> Int) = o",
      [refusal("x", "length")],
    );
  });

  test("a constructor's lambda assigned to a `var` whose type is written", () => {
    refused(
      "let f() =\n    var o: Option((Vector(Int)) -> Int) = None\n    o := Some((x) => x.length())\n    ()\n",
      "x",
      "length",
    );
  });

  test("a constructor's lambda, where no written type reaches the constructor", () => {
    const pair = "union P(a) = Pair(a, (a) -> Int)\n";
    refused(pair + "let f(v: Vector(Int)) =\n    let p = Pair(v, (x) => x.length())\n    ()\n", "x", "length");
    const col = "record Col(a) = {values: Vector(a), format: (a) -> String}\n";
    refused(
      col + "let f(vs: Vector(Int)) =\n    let c = Col({values = vs, format = (e) => e.show()})\n    ()\n",
      "e",
      "show",
    );
    refused(
      "let use(o: Option((Vector(Int)) -> Int)): Int = 0\nlet n = use(Some((x) => x.length()))\n",
      "x",
      "length",
    );
    // The bare, module, or written spelling is the one that compiles.
    compiles(col + "let f(vs: Vector(Int)) =\n    let c = Col({values = vs, format = (e) => show(e)})\n    ()\n");
    compiles(pair + "let f(v: Vector(Int)) =\n    let p = Pair(v, (x) => Vector.length(x))\n    ()\n");
    compiles(pair + "let f(v: Vector(Int)) =\n    let p: P(Vector(Int)) = Pair(v, (x) => x.length())\n    ()\n");
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

  test("a lambda parameter of a call whose argument was refused", () => {
    expect(projectDiagnostics(HEADER + "let f(o) = Seq.map(o.items(), (x) => x.show())\n")).toEqual([
      refusal("o", "items"),
    ]);
  });

  test("a lambda parameter of a refused call, or a part of a refused value", () => {
    expect(projectDiagnostics(HEADER + "let f(v: Vector(Int)) = v.nope((x) => x.show())\n")).toHaveLength(1);
    expect(projectDiagnostics(
      HEADER + "let f(o): String = match o.first()\n    Some(g) => g.show()\n    None => \"\"\n",
    )).toEqual([refusal("o", "first")]);
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
