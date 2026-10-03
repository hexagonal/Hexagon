import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for Numeric Literals §4: **a number is decided where the text
 * decides it.** Inside one expression a number takes the type its expression
 * asks for, as it always has. Where a new name is made from a number type
 * nothing has decided — a `var`, a `for`, a `match` arm's pattern, as a `let`
 * already did — the type becomes `Int` there; a type a name already holds is
 * the name's, left to inference. A lambda's parameters are its inputs, not new
 * names: before a call opens a lambda (a box), a number type that reaches only
 * its input, which no box still to be opened outputs, becomes `Int` (the box
 * rule); and a direct lambda's output joins the call right after its body, as a
 * spine lambda's does (Functions §4.3). So no later line chooses what a number
 * already named is: every program below reads the same in every order of its
 * lines.
 */

const HEADER = "module Main\n\n";
const FLOAT = "let useFloat(f: Float): Unit = ()";
const NAT = "let useNat(v: Nat): Unit = ()";
const ZERO = "let zero<t: Num>(): t = 0";
const USING = "let using(f: () -> a, g: (a) -> b): b = g(f())";

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

/** Each case: its name, the declarations it uses, a body whose slots take the lines, the lines, and the reports. */
const ORDERS: readonly (readonly [string, string, string, readonly string[], readonly string[]])[] = [
  [
    "V1-var-float",
    FLOAT,
    "let f() =\n    var n = 0\n    {0}\n    {1}\n    ()",
    ["let s = n.show()", "useFloat(n)"],
    [],
  ],
  [
    "V2-var-nat",
    NAT,
    "let f() =\n    var n = 0\n    {0}\n    {1}\n    ()",
    ["let s = n.show()", "useNat(n)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "V3-var-assign",
    "",
    "let f() =\n    var n = 0\n    {0}\n    {1}\n    ()",
    ["let s = n.show()", "n := 1.5"],
    ["type mismatch: expected Int, found Float"],
  ],
  [
    "V4-var-zero",
    ZERO,
    "let f() =\n    var n = zero()\n    {0}\n    {1}\n    ()",
    ["let s = n.show()", "n := n + 1.5"],
    ["an operand of type `Float` cannot enter `Int`, so the addition could not run at `Int`"],
  ],
  [
    "V5-var-checked",
    FLOAT,
    "let f() =\n    var n = 0\n    {0}\n    {1}\n    ()",
    ["let c = n.checkedAdd(1)", "useFloat(n)"],
    [],
  ],
  [
    "V6-var-bigint",
    "",
    "let f() =\n    var n = 0\n    {0}\n    {1}\n    ()",
    ["let s = n.show()", "let m: BigInt = n"],
    [],
  ],
  [
    "V7-var-if",
    "",
    "let f(c: Bool) =\n    var x = if c then 0 else 1\n    {0}\n    {1}\n    ()",
    ["let s = x.show()", "x := 1.5"],
    ["type mismatch: expected Int, found Float"],
  ],
  [
    "F1-for-float",
    FLOAT,
    "let f() =\n    for x in [1, 2, 3]\n        {0}\n        {1}\n    ()",
    ["ignore(x.show())", "useFloat(x)"],
    [],
  ],
  [
    "F2-for-checked",
    FLOAT,
    "let f() =\n    for x in [1, 2, 3]\n        {0}\n        {1}\n    ()",
    ["ignore(x.checkedAdd(1))", "useFloat(x)"],
    [],
  ],
  [
    "F3-for-nat",
    NAT,
    "let f() =\n    for x in [1, 2, 3]\n        {0}\n        {1}\n    ()",
    ["ignore(x.show())", "useNat(x)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "F4-for-floor",
    FLOAT,
    "let f() =\n    for x in [1, 2, 3]\n        {0}\n        {1}\n    ()",
    ["ignore(x.floor())", "useFloat(x)"],
    ["`Int` has no field `floor`, its companion exports no operation `floor`, and no constraint honored at `Int` has a subject-first member `floor`; call an available subject-first function explicitly"],
  ],
  [
    "O1-holder-loop",
    "",
    "let f() =\n    var xs = Vector.empty\n    {0}\n    {1}\n    {2}\n    ()",
    ["xs := xs.append(1)", "for x in xs\n        ignore(x.show())", "xs := xs.append(2.5)"],
    ["the program's text does not decide `x`'s type here, so `.show(…)` cannot tell whose `show` it is — write `x`'s type, or call the operation by its module (`Module.show(x, …)`); a record's field is called as `(x.show)(…)`"],
  ],
  [
    "O2-holder-bare",
    "",
    "let f() =\n    var xs = Vector.empty\n    {0}\n    {1}\n    {2}\n    ()",
    ["xs := xs.append(1)", "for x in xs\n        ignore(show(x))", "xs := xs.append(2.5)"],
    [],
  ],
  [
    "O3-param-box",
    FLOAT,
    "let f(p) =\n    {0}\n    {1}\n    ()",
    ["let a = Some(p).map((x) => x.show())", "useFloat(p)"],
    ["the program's text does not decide `x`'s type here, so `.show(…)` cannot tell whose `show` it is — write `x`'s type, or call the operation by its module (`Module.show(x, …)`); a record's field is called as `(x.show)(…)`"],
  ],
  [
    "O4-param-literal-box",
    FLOAT,
    "let f(p) =\n    {0}\n    {1}\n    ()",
    ["let a = Some(1).map((x) => x.show())", "useFloat(p)"],
    [],
  ],
  [
    "O5-param-vector",
    FLOAT,
    "let f(p) =\n    {0}\n    {1}\n    ()",
    ["for x in [p, 1]\n        ignore(x.show())", "useFloat(p)"],
    ["the program's text does not decide `x`'s type here, so `.show(…)` cannot tell whose `show` it is — write `x`'s type, or call the operation by its module (`Module.show(x, …)`); a record's field is called as `(x.show)(…)`"],
  ],
  [
    "O6-param-var",
    FLOAT,
    "let f(p) =\n    var s = p + 1\n    {0}\n    {1}\n    ()",
    ["ignore(s.show())", "useFloat(p)"],
    ["the program's text does not decide `s`'s type here, so `.show(…)` cannot tell whose `show` it is — write `s`'s type, or call the operation by its module (`Module.show(s, …)`); a record's field is called as `(s.show)(…)`"],
  ],
  [
    "M1-match-float",
    FLOAT,
    "let f() =\n    match (1, 2)\n        (a, b) =>\n            {0}\n            {1}\n    ()",
    ["ignore(a.show())", "useFloat(a)"],
    [],
  ],
  [
    "M2-match-nat",
    NAT,
    "let f() =\n    match (1, 2)\n        (a, b) =>\n            {0}\n            {1}\n    ()",
    ["ignore(a.show())", "useNat(a)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "M3-let-pattern",
    NAT,
    "let f() =\n    let (a, b) = (1, 2)\n    {0}\n    {1}\n    ()",
    ["ignore(a.show())", "useNat(a)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "B1-box-float",
    FLOAT,
    "let f() =\n    let o = Some(1).map((x) =>\n        {0}\n        {1}\n        0)\n    ()",
    ["ignore(x.show())", "useFloat(x)"],
    [],
  ],
  [
    "B2-box-nat",
    NAT,
    "let f() =\n    let o = Some(1).map((x) =>\n        {0}\n        {1}\n        0)\n    ()",
    ["ignore(x.show())", "useNat(x)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "B3-box-module",
    NAT,
    "let f() =\n    let o = Option.map(Some(1), (x) =>\n        {0}\n        {1}\n        0)\n    ()",
    ["ignore(x.show())", "useNat(x)"],
    ["type mismatch: expected Nat, found Int"],
  ],
  [
    "B4-fold-float",
    "",
    "let f(xs: Seq(Float)) =\n    {0}\n    {1}\n    ()",
    ["let t = xs.fold(0, (acc, x) => acc + x)", "let u = xs.fold(0, (acc, x) => acc.add(x))"],
    ["the program's text does not decide `acc`'s type here, so `.add(…)` cannot tell whose `add` it is — write `acc`'s type, or call the operation by its module (`Module.add(acc, …)`); a record's field is called as `(acc.add)(…)`"],
  ],
  [
    "B5-fold-int",
    "",
    "let f(xs: Seq(Int)) =\n    {0}\n    {1}\n    ()",
    ["let t = xs.fold(0, (acc, x) => acc + x)", "let u = xs.fold(0, (acc, x) => acc.add(x))"],
    ["the program's text does not decide `acc`'s type here, so `.add(…)` cannot tell whose `add` it is — write `acc`'s type, or call the operation by its module (`Module.add(acc, …)`); a record's field is called as `(acc.add)(…)`"],
  ],
  [
    "B6-pipe",
    FLOAT,
    "let f() =\n    let o = 5 |> (n) =>\n        {0}\n        {1}\n        0\n    ()",
    ["ignore(n.show())", "useFloat(n)"],
    ["the program's text does not decide `n`'s type here, so `.show(…)` cannot tell whose `show` it is — write `n`'s type, or call the operation by its module (`Module.show(n, …)`); a record's field is called as `(n.show)(…)`"],
  ],
  [
    "S1-using",
    USING + "\n" + FLOAT,
    "let f() =\n    var k = 0\n    {0}\n    {1}\n    ()",
    ["let a = using(() => 1, (h) => h.show())", "useFloat(k)"],
    [],
  ],
  [
    "S2-using-float",
    USING + "\n" + FLOAT,
    "let f() =\n    {0}\n    {1}\n    ()",
    ["let a = using(() => 2.5, (h) => h.show())", "let b = using(() => [1, 2], (h) => h.length())"],
    [],
  ],
  [
    "S3-using-shared",
    USING + "\n" + NAT,
    "let f(p) =\n    {0}\n    {1}\n    ()",
    ["let a = using(() => p, (h) => h.show())", "useNat(p)"],
    ["the program's text does not decide `h`'s type here, so `.show(…)` cannot tell whose `show` it is — write `h`'s type, or call the operation by its module (`Module.show(h, …)`); a record's field is called as `(h.show)(…)`"],
  ],
];

describe("no order of the lines chooses a number's type (Numeric Literals §4)", () => {
  for (const [name, prelude, template, lines, reports] of ORDERS) {
    test(name, () => {
      for (const order of permutations(lines)) {
        expect(projectDiagnostics(HEADER + (prelude === "" ? "" : prelude + "\n") + fill(template, order) + "\n"))
          .toEqual(reports);
      }
    });
  }
});

describe("a new name made from a number nothing decided is an `Int` there", () => {
  test("a loop over literals, a `var`, and a `match` arm's parts read an `Int`", () => {
    compiles("let f(): Unit =\n    for x in [1, 2, 3]\n        Debug.log(x.show())\n");
    compiles("let f(): String =\n    var n = 42\n    n.show()\n");
    compiles("let f(): String =\n    match (1, 2)\n        (a, b) => a.show()\n");
    compiles("let f(): Int =\n    var h = 0x811c9dc5\n    h := h.shiftLeft(1)\n    h\n");
  });

  test("a type a name already holds is that name's: a later new name does not default it", () => {
    // `h`'s element is a number once `1` is appended, and `h` holds it; the
    // `var` made from it leaves it to inference, so `useNats` settles it.
    compiles(
      "let ident(x: a): a = x\nlet useNats(v: Vector(Nat)): Unit = ()\nlet f(): Unit =\n" +
        "    let h = ident(Vector.empty)\n    let w = Vector.append(h, 1)\n    var z = h\n    useNats(h)\n",
    );
    // The same for what a loop variable holds.
    compiles(
      NAT + "\nlet f(): Unit =\n    for x in Vector.empty\n        let a = x + 1\n        var z = x\n        useNat(x)\n",
    );
  });

  test("an `Int` widens into a seat that writes a wider type", () => {
    compiles(FLOAT + "\nlet f(): Unit =\n    var n = 0\n    useFloat(n)\n");
    compiles("let f(): Unit =\n    var n = 0\n    let m: BigInt = n\n    ()\n");
  });

  test("its later lines cannot choose another number type; its written type is the spelling", () => {
    const sum = (initializer: string): string =>
      `let f(xs: Vector(Float)): Unit =\n    var sum${initializer}\n    for x in xs\n        sum := sum + x\n`;
    expect(projectDiagnostics(HEADER + sum(" = 0"))).toEqual([
      "`x` is a `Float` and cannot enter `Int`, so the addition could not run at `Int`",
    ]);
    compiles(sum(" = 0.0"));
    compiles(sum(": Float = 0"));
    const loop = (source: string): string => NAT + `\nlet f(): Unit =\n    for i in ${source}\n        useNat(i)\n`;
    expect(projectDiagnostics(HEADER + loop("[1, 2, 3]"))).toEqual(["type mismatch: expected Nat, found Int"]);
    compiles(loop("([1, 2, 3]: Vector(Nat))"));
    expect(projectDiagnostics(HEADER + NAT + "\nlet f(): Unit =\n    var x = 5\n    useNat(x)\n"))
      .toEqual(["type mismatch: expected Nat, found Int"]);
    compiles(NAT + "\nlet f(): Unit =\n    var x: Nat = 5\n    useNat(x)\n");
    expect(projectDiagnostics(HEADER + NAT + "\nlet f(): Unit =\n    match 3\n        n => useNat(n)\n"))
      .toEqual(["type mismatch: expected Nat, found Int"]);
    compiles(NAT + "\nlet f(): Unit =\n    match (3: Nat)\n        n => useNat(n)\n");
    expect(projectDiagnostics(HEADER + ZERO + "\nlet f(): Unit =\n    var t = zero()\n    t := t + 1.5\n")).toEqual([
      "an operand of type `Float` cannot enter `Int`, so the addition could not run at `Int`",
    ]);
    compiles(ZERO + "\nlet f(): Unit =\n    var t: Float = zero()\n    t := t + 1.5\n");
  });

  test("an inferred function that passes a literal through a `var` is `Int`-only; a declared one stays generic", () => {
    expect(projectDiagnostics(
      HEADER + "let k(x) =\n    var acc = 0\n    acc := acc + x\n    acc\nlet a: Float = k(2.5)\n",
    )).toEqual(["type mismatch: expected Int, found Float"]);
    compiles("let k<a: Num>(x: a): a =\n    var acc: a = 0\n    acc := acc + x\n    acc\nlet a: Float = k(2.5)\n");
    // A literal that joins a parameter is the parameter's: no new name is made.
    compiles("let g(x) = x + 1\nlet a: Float = g(2.5)\nlet b: Int = g(1)\n");
  });
});

describe("a lambda is a box: a number reaching only its input is an `Int` before it is opened", () => {
  test("the dot and the module spelling read alike", () => {
    compiles("let f(): Option(String) = Some(1).map((x) => x.show())\n");
    compiles("let f(): Option(String) = Option.map(Some(1), (x) => x.show())\n");
  });

  test("a number inside the input decides the input whole", () => {
    compiles(
      "let f(): Option(Int) = Some([1, 2]).map((xs) =>\n    for v in xs\n        Debug.log(v.show())\n    0)\n",
    );
  });

  test("a box that outputs the number leaves it to inference", () => {
    compiles("let f(xs: Seq(Float)): Float = xs.fold(0, (acc, x) => acc + x)\n");
    compiles("let f(xs: Seq(Int)): Int = xs.fold(0, (acc, x) => acc + x)\n");
  });

  test("a parameter's written type is the spelling for another number type", () => {
    expect(projectDiagnostics(HEADER + NAT + "\nlet f(): Option(Unit) = Some(1).map((x) => useNat(x))\n"))
      .toEqual(["type mismatch: expected Nat, found Int"]);
    compiles(NAT + "\nlet f(): Option(Unit) = Some(1).map((x: Nat) => useNat(x))\n");
  });

  test("a lambda on a pipe's right is a box, and its parameter is still not decided for a dot (Method Syntax §3.1)", () => {
    expect(projectDiagnostics(HEADER + "let f(): String = 5 |> (n) => n.show()\n")).toHaveLength(1);
    compiles("let f(): String = 5 |> (n: Int) => n.show()\n");
  });
});

describe("a direct lambda's output joins the call right after its body (Functions §4.3)", () => {
  test("a later lambda lands what an earlier one produced", () => {
    compiles(USING + "\nlet f(): Int = using(() => [\"p\"], (h) => h.length())\n");
    compiles(USING + "\nlet f(): String = using(() => 2.5, (h) => h.show())\n");
  });

  test("a declared number bound reads the earlier lambda's output, `Float` or `Int`", () => {
    const usingN = "let usingN<a: Num>(f: () -> a, g: (a) -> String): String = g(f())\n";
    compiles(usingN + "let s: String = usingN(() => 2.5, (h) => h.show())\n");
    compiles(usingN + "let s: String = usingN(() => 1, (h) => h.show())\n");
  });
});

describe("the report points to where the number became an `Int`, and says what to write", () => {
  const labels = (source: string): readonly string[] => {
    const text = HEADER + source;
    return compileFiles([["/main.hex", text]]).diagnostics.flatMap((diagnostic) =>
      (diagnostic.labels ?? []).map((label) => `[${text.slice(label.span.start.offset, label.span.end.offset)}] ${label.message}`)
    );
  };

  test("a `var`", () => {
    expect(labels("let f(xs: Vector(Float)): Unit =\n    var sum = 0\n    for x in xs\n        sum := sum + x\n")).toEqual([
      "[sum] `sum` became an `Int` here: the `var` made it from a number nothing had decided — write `var sum: Float`",
    ]);
  });

  test("a loop", () => {
    expect(labels(NAT + "\nlet f(): Unit =\n    for i in [1, 2, 3]\n        useNat(i)\n")).toEqual([
      "[[1, 2, 3]] `i` became an `Int` here: the loop made it from a number nothing had decided — " +
        "write the type of what this holds here (`Nat`)",
    ]);
  });

  test("a `match` arm", () => {
    expect(labels(NAT + "\nlet f(): Unit =\n    match 3\n        n => useNat(n)\n")).toEqual([
      "[3] an arm's name became an `Int` here: the `match` made it from a number nothing had decided — " +
        "write the type here (`Nat`)",
    ]);
  });

  test("a box's input", () => {
    expect(labels(NAT + "\nlet f(): Option(Unit) = Some(1).map((x) => useNat(x))\n")).toEqual([
      "[x] `x` became an `Int` here: the number reached only the lambda's input — write `(x: Nat)`",
    ]);
  });
});
