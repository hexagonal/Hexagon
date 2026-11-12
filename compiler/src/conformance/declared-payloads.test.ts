import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for #1518: **a constructor's declaration decides the parts it
 * writes.** A pattern's part is decided where the value it is taken from is
 * decided, and where the declarations of the constructors the pattern names
 * write the part, read down the pattern's steps: the declaration is text,
 * and only what its type parameters become is the value's (Method Syntax
 * §3.1, as for a constructor's application). The one reading serves the
 * three places that ask what the text decides: a dot call on the part
 * (Method Syntax §3.1), a use of it (Effects §3.4), and a type a pattern
 * writes over it (Pattern Matching §2.9), which is a use of the part.
 */

const HEADER = "module Main\n\n";
const WORLD = 'extern from "./world.js"\n    export fun save(s: String) ->! Unit\n' +
  'let save0(): Unit = save!("x")\nlet noop(): Unit = ()\n';
const OUT = "export let out: Int = 0\n";
const U = "union U =\n    | A(n: Int, f: () -> Unit)\n    | B\n";
const FIXED = "this position's arrow says the function is impure and may fail, and the pure arrow meeting it, which " +
  "cannot fail, was fixed before it arrived — by another use, by a type written where it was made, inside an " +
  "argument read invariantly, or in a parameter's type — so it cannot fit as a function used here does; write the " +
  "arrow where it was fixed";

function messages(source: string): readonly string[] {
  return projectDiagnostics(HEADER + source);
}

function undecided(subject: string, name: string): string {
  return `the program's text does not decide \`${subject}\`'s type here, so \`.${name}(…)\` ` +
    `cannot tell whose \`${name}\` it is — write \`${subject}\`'s type, or call the operation ` +
    `by its module (\`Module.${name}(${subject}, …)\`); a record's field is called as ` +
    `\`(${subject}.${name})(…)\``;
}

/** The arm's body over a `u` whose type is written, one whose type is not, and at a `catch` arm. */
function everywhere(arm: string): readonly (readonly [string, string])[] {
  return [
    ["over `u: U`", WORLD + U + `let g(u: U): Unit = match u\n    ${arm}\n    _ => ()\n` + OUT],
    ["over an untyped `u`", WORLD + U + `let g(u) = match u\n    ${arm}\n    _ => ()\nexport let k: Unit = g(B)\n` + OUT],
    [
      "at a `catch` arm",
      WORLD + "exception A(n: Int, f: () -> Unit)\nlet g(): Unit = try throw^(A(1, noop))\n    catch\n" +
        `        ${arm.replaceAll("\n", "\n    ")}\n        _ => ()\n` + OUT,
    ],
  ];
}

describe("a constructor's declaration decides the parts it writes (#1518)", () => {
  test("a dot call, a use and a claim on a declared payload, wherever the value comes from", () => {
    for (
      const arm of [
        "A(n, _) => ignore(n.show())",
        "A(_, f) =>\n        let h: () ->! Unit = f\n        ()",
        "A(_, f) =>\n        let hs: Vector(() ->! Unit) = [f, save0]\n        ()",
        "A(_, (f: () ->! Unit)) => ()",
      ]
    ) {
      for (const [where, source] of everywhere(arm)) expect([where, messages(source)]).toEqual([where, []]);
    }
  });

  test("a slot the declaration writes as a type parameter is the value's to give", () => {
    // Nothing written gives `Option`'s `a`: the dot is refused, and an arrow another line fixed meets a use and a
    // claim as it was fixed.
    expect(messages("let g(o) = match o\n    Some(n) => n.show()\n    None => \"\"\n" + OUT))
      .toEqual([undecided("n", "show")]);
    for (
      const arm of [
        "Some(f) =>\n            let h: () ->! Unit = f\n            ()",
        "Some((f: () ->! Unit)) => ()",
      ]
    ) {
      expect(messages(WORLD + `let g(o) =\n    let p: Option(() -> Unit) = o\n    match o\n        ${arm}\n        _ => ()\n` + OUT))
        .toEqual([FIXED]);
    }
    // A written type around the slot gives the parameter: the part is decided as that type writes it.
    expect(messages("let g(o: Option(Int)): String = match o\n    Some(n) => n.show()\n    None => \"\"\n" + OUT)).toEqual([]);
    // A slot that writes a parameter beneath a written head decides the head alone.
    const listed = "union L(a) =\n    | L(xs: Vector(a))\n";
    expect(messages(listed + "let g(l) = match l\n    L(xs) => xs.length()\nexport let k: Int = g(L([1]))\n" + OUT)).toEqual([]);
    // Its element is the value's, though another line has given it a type.
    expect(messages(listed + "let g(l) = match l\n    L(xs) =>\n        let y = xs[0]\n        let z: Int = y\n        y.show()\n" + OUT))
      .toEqual([undecided("y", "show")]);
    // So is a nominal record's field that writes the parameter.
    const recorded = "record RL(a) = {xs: Vector(a)}\n";
    expect(messages(recorded + "let g(r) = match r\n    RL({xs = xs}) =>\n        let y = xs[0]\n        let z: Int = y\n        y.show()\n" + OUT))
      .toEqual([undecided("y", "show")]);
  });

  test("read down the pattern's steps: a tuple, a constructor, a record's field, an `as`, a claim, a vector, a pattern declaration", () => {
    for (
      const [declaration, arm, handed] of [
        // A tuple the slot writes, beside a type parameter.
        ["union T(a) =\n    | T(p: (a, () -> Unit))\n", "T((_, (f: () ->! Unit))) => ()", "T((1, noop))"],
        // A constructor the slot writes, its parameter given by the slot.
        ["union V =\n    | V(o: Option(() -> Unit))\n", "V(Some((f: () ->! Unit))) => ()\n    V(None) => ()", "V(None)"],
        // An or-pattern in the slot, each alternative given it.
        ["union V =\n    | V(o: Option(() -> Unit))\n", "V(Some((_: () ->! Unit)) | None) => ()", "V(None)"],
        // A nominal record's field.
        ["record R = {f: () -> Unit, n: Int}\n", "R({f = (f: () ->! Unit), n = _}) => ()", "R({f = noop, n = 1})"],
        // A name beneath an `as`, and beneath a claim that writes a hole.
        ["union U2 =\n    | A2(n: Int)\n    | B2\n", "A2(n) as w => ignore(n.show())\n    B2 => ()", "B2"],
        ["union U2 =\n    | A2(n: Int)\n    | B2\n", "A2(n as m) => ignore(m.show())\n    B2 => ()", "B2"],
        ["union U2 =\n    | A2(n: Int)\n    | B2\n", "A2((n: _)) => ignore(n.show())\n    B2 => ()", "B2"],
        // A vector's elements and its rest.
        ["union UV =\n    | UV(xs: Vector(Int))\n", "UV([n, ...rest]) => ignore((n.show(), rest.length()))\n    UV([]) => ()", "UV([])"],
        // A constructor in a pattern declaration's component.
        [
          "union U3 =\n    | A3(n: Int)\n    | B3\nrecord Box = {u: U3, m: Int}\npattern parts(u: U3, m: Int): Box\n    view(b) = (b.u, b.m)\n",
          "(A3(n), _)parts => ignore(n.show())\n    _ => ()",
          "Box({u = B3, m = 1})",
        ],
      ] as const
    ) {
      expect(messages(WORLD + declaration + `let g(v) = match v\n    ${arm}\nexport let k: Unit = g(${handed})\n` + OUT))
        .toEqual([]);
    }
    // The element the tuple's type parameter stands at is the value's.
    expect(messages(
      WORLD + "union T(a) =\n    | T(p: (a, () -> Unit))\nlet g(t) =\n    let q: T(() -> Unit) = t\n    match t\n" +
        "        T(((f: () ->! Unit), _)) => ()\n" + OUT,
    )).toEqual([FIXED]);
  });

  test("a slot written beside a type parameter: each arrow the declaration spells is the text's", () => {
    const pair = "union W(a) =\n    | W(p: (() -> Unit, a))\n";
    const arrow = "union F(a) =\n    | F(f: (a) -> Unit)\n";
    for (
      const source of [
        pair + "let g(w) = match w\n    W(p) =>\n        let h: (() ->! Unit, Int) = p\n        ()\nexport let k: Unit = g(W((noop, 1)))\n",
        pair + "let g(w) = match w\n    W((p: (() ->! Unit, Int))) => ()\nexport let k: Unit = g(W((noop, 1)))\n",
        arrow + "let g(v) = match v\n    F(f) =>\n        let h: (Int) ->! Unit = f\n        ()\nexport let k: Unit = g(F((n: Int) => ()))\n",
        arrow + "let g(v) = match v\n    F((f: (Int) ->! Unit)) => ()\nexport let k: Unit = g(F((n: Int) => ()))\n",
      ]
    ) {
      expect(messages(WORLD + source + OUT)).toEqual([]);
    }
    // What the type parameter stands for is the value's: an arrow another line fixed meets a use and a claim as it
    // was fixed.
    const fixed = WORLD + pair + "let g(w) =\n    let q: W(() -> Unit) = w\n    match w\n";
    expect(messages(fixed + "        W(p) =>\n            let h: (() ->! Unit, () ->! Unit) = p\n            ()\n" + OUT))
      .toEqual([FIXED]);
    expect(messages(fixed + "        W((p: (() ->! Unit, () ->! Unit))) => ()\n" + OUT)).toEqual([FIXED]);
    // A value made from such a part is not made from the text: the parameter's arrow stays the value's.
    expect(messages(
      fixed.replace("let g(w)", "let pass(x: a): a = x\nlet g(w)") +
        "        W(p) =>\n            let h: (() ->! Unit, () ->! Unit) = pass(p)\n            ()\n" + OUT,
    )).toEqual([FIXED]);
    // Over a value whose type a later line fills, read in place or bound, as over one the text decides.
    for (
      const scrutinee of ["let g(): Unit = match pass(W((noop, [])))\n", "let g(): Unit =\n    let w = pass(W((noop, [])))\n    match w\n"]
    ) {
      for (
        const arm of [
          "W(p) =>\n        let h: (() ->! Unit, Vector(Int)) = p\n        ()",
          "W((p: (() ->! Unit, Vector(Int)))) => ()",
          "W((f, _)) =>\n        let h: () ->! Unit = f\n        ()",
        ]
      ) {
        const indent = scrutinee.endsWith("match w\n") ? "        " : "    ";
        const source = WORLD + "let pass(x: a): a = x\n" + pair + scrutinee + indent + arm.replaceAll("\n", "\n" + indent.slice(4)) +
          "\n" + OUT;
        expect([arm, messages(source)]).toEqual([arm, []]);
      }
    }
    // Where the value's own written type spells more than the declaration, as a written result type does, its
    // reading stands, at every use.
    const made = "record RR(a) = {f: (() -> Unit, a)}\nlet mk(x: b): (RR(() -> Unit), b) = (RR({f = (noop, noop)}), x)\n";
    for (const [head, handed] of [["let g(y) =\n", "export let k: Unit = g(1)\n"], ["let g(y: Int): Unit =\n", ""]]) {
      const body = "    let (RR({f = p}), _) = mk(y)\n    let h1: (() -> Unit, () -> Unit) = p\n" +
        "    let h2: (() ->! Unit, () ->! Unit) = p\n    ()\n";
      expect([head, messages(WORLD + made + head + body + handed + OUT)]).toEqual([head, []]);
    }
  });

  test("a part's every arrow, and a declared field's type as its value's own, as over a value whose type is written", () => {
    // A slot written whole: every arrow in it, not only the part's own.
    const union = "union U =\n    | A(p: (() -> Unit, Int))\n    | B\n";
    expect(messages(
      WORLD + union + "let g(u) = match u\n    A(p) =>\n        let h: (() ->! Unit, Int) = p\n        ()\n    B => ()\n" +
        "export let k: Unit = g(B)\n" + OUT,
    )).toEqual([]);
    // A value made from the part is made from the text: a call of it, and a field read of a call handed it.
    const holder = "record Holder = {run: () -> Unit}\nunion M =\n    | M(mk: () -> (() -> Unit), h: Holder)\n" +
      "let pass(x: a): a = x\n";
    for (const use of ["let k: () ->! Unit = mk()", "let k: () ->! Unit = pass(h).run"]) {
      const source = WORLD + holder + `let g(m) = match m\n    M(mk, h) =>\n        ${use}\n        ()\n` +
        "export let k: Unit = g(M(() => noop, Holder({run = noop})))\n" + OUT;
      expect([use, messages(source)]).toEqual([use, []]);
    }
    // A record's field is its value's own written type: a `->!` it writes in a parameter accepts any function, at a
    // use and under a claim, written whole or beside a type parameter, as a field read of a typed value gives it.
    const record = "record R(a) = {f: (() ->! Unit) -> Unit, x: a}\nrecord S = {run: (() -> Unit) -> Unit}\n";
    for (const [head, handed] of [["let g(r) = match r\n", "export let k: Unit = g(R({f = (c) => (), x = 1}))\n"], ["let g(r: R(Int)): Unit = match r\n", ""]]) {
      for (const arm of ["R({f = f, x = _}) => ignore(S({run = f}))", "R({f = (f: (() -> Unit) -> Unit), x = _}) => ()"]) {
        expect([head, arm, messages(WORLD + record + head + "    " + arm + "\n" + handed + OUT)]).toEqual([head, arm, []]);
      }
    }
    // So over a value the text decides with no type written for it, and with a type argument a written type gives.
    expect(messages(
      WORLD + record + "let g(): Unit =\n    let r = R({f = (c) => (), x = 1})\n    match r\n" +
        "        R({f = (f: (() -> Unit) -> Unit), x = _}) => ()\n" + OUT,
    )).toEqual([]);
    expect(messages(
      WORLD + "record RA(a) = {f: (a) -> Unit}\nlet g(r: RA(() ->! Unit)): Unit = match r\n" +
        "    RA({f = (f: (() -> Unit) -> Unit)}) => ()\n" + OUT,
    )).toEqual([]);
    // A union's slot is not its value's own written type, whether the value's type is written or not.
    const slot = "union V =\n    | V(f: (() ->! Unit) -> Unit)\nrecord S = {run: (() -> Unit) -> Unit}\n";
    for (
      const head of ["let g(v) = match v\n", "let g(v: V): Unit = match v\n"]
    ) {
      for (const arm of ["V(f) => ignore(S({run = f}))", "V((f: (() -> Unit) -> Unit)) => ()"]) {
        expect([head, arm, messages(WORLD + slot + head + "    " + arm + "\nexport let k: Unit = g(V((c) => ()))\n" + OUT)])
          .toEqual([head, arm, [FIXED]]);
      }
    }
    // Nor where it writes the part beside a type parameter.
    const beside = "union Q(a) =\n    | Q(p: ((() ->! Unit) -> Unit, a))\nrecord S = {run: ((() -> Unit) -> Unit, Int)}\n";
    for (const head of ["let g(v) = match v\n", "let g(v: Q(Int)): Unit = match v\n"]) {
      for (const arm of ["Q(p) => ignore(S({run = p}))", "Q((p: ((() -> Unit) -> Unit, Int))) => ()"]) {
        const source = WORLD + beside + head + "    " + arm + "\nexport let k: Unit = g(Q(((c) => (), 1)))\n" + OUT;
        expect([head, arm, messages(source)]).toEqual([head, arm, [FIXED]]);
      }
    }
    // Nor where a union's or an exception's slot gives a record's type parameter: the arrow is the slot's, whatever the
    // value, a value the text decides included.
    const given = "record RA(a) = {f: (a) -> Unit}\nrecord S = {run: (() -> Unit) -> Unit}\n";
    const slotted = given + "union V =\n    | V(r: RA(() ->! Unit))\n";
    for (
      const head of [
        "let g(v) = match v\n",
        "let g(v: V): Unit = match v\n",
        "let g(): Unit =\n    let v = V(RA({f = (c) => ()}))\n    match v\n",
      ]
    ) {
      for (const arm of ["V(RA({f = f})) => ignore(S({run = f}))", "V(RA({f = (f: (() -> Unit) -> Unit)})) => ()"]) {
        const indent = head.includes("let v =") ? "        " : "    ";
        expect([head, arm, messages(WORLD + slotted + head + indent + arm + "\n" + OUT)]).toEqual([head, arm, [FIXED]]);
      }
    }
    for (const arm of ["E(RA({f = f})) => ignore(S({run = f}))", "E(RA({f = (f: (() -> Unit) -> Unit)})) => ()"]) {
      const source = WORLD + given + "exception E(r: RA(() ->! Unit))\nlet g(): Unit = try throw^(E(RA({f = (c) => ()})))\n" +
        `    catch\n        ${arm}\n        _ => ()\n` + OUT;
      expect([arm, messages(source)]).toEqual([arm, [FIXED]]);
    }
    expect(messages(
      WORLD + given + "union V3 =\n    | V3(p: (RA(() ->! Unit), Int))\nlet g(v) = match v\n" +
        "    V3((RA({f = f}), _)) => ignore(S({run = f}))\n" + OUT,
    )).toEqual([FIXED]);
    // So a union's slot beneath another's, whose type that slot writes.
    expect(messages(
      WORLD + "record S = {run: (() -> Unit) -> Unit}\nunion V4 =\n    | V4(f: (() ->! Unit) -> Unit)\n" +
        "union O =\n    | O(v: V4)\nlet g(o) = match o\n    O(V4(f)) => ignore(S({run = f}))\n" + OUT,
    )).toEqual([FIXED]);
    // A record's own field keeps its reading in a union's slot.
    const own = "record R3 = {f: (() ->! Unit) -> Unit}\nrecord S = {run: (() -> Unit) -> Unit}\nunion V2 =\n    | V2(r: R3)\n";
    for (const head of ["let g(v) = match v\n", "let g(v: V2): Unit = match v\n"]) {
      expect([head, messages(WORLD + own + head + "    V2(R3({f = f})) => ignore(S({run = f}))\n" + OUT)]).toEqual([head, []]);
    }
    // A part a written type reaches through a record's field, though the value is not decided wholly.
    const partial = "record R2(a) = {f: () -> Unit, x: a}\nlet g(t: (R2(_), Int)): Unit = match t\n";
    for (const arm of ["(R2({f = (f: () ->! Unit), x = _}), _) => ()", "(R2({f = f, x = _}), _) =>\n        let h: () ->! Unit = f\n        ()"]) {
      expect([arm, messages(WORLD + partial + "    " + arm + "\n" + OUT)]).toEqual([arm, []]);
    }
  });

  test("an or-pattern: a claim in the alternative that holds it, and a name what every alternative writes alike", () => {
    const both = "union XY =\n    | X(f: () -> Unit, n: Int)\n    | Y(f: () -> Unit, n: Int)\n";
    for (
      const arm of [
        "X((f: () ->! Unit), _) | Y((f: () ->! Unit), _) => ()",
        "X(f, _) | Y(f, _) =>\n        let h: () ->! Unit = f\n        ()",
        "X(_, n) | Y(_, n) => ignore(n.show())",
      ]
    ) {
      expect([arm, messages(WORLD + both + `let g(v) = match v\n    ${arm}\nexport let k: Unit = g(X(noop, 1))\n` + OUT)])
        .toEqual([arm, []]);
    }
    // So in a slot, which gives every alternative its type.
    const slot = "union V3 =\n    | V3(p: (Option(() -> Unit), Option(() -> Unit)))\n";
    expect(messages(
      WORLD + slot + "let g(v) = match v\n    V3((Some(f), _) | (_, Some(f))) =>\n        let h: () ->! Unit = f\n        ()\n" +
        "    _ => ()\nexport let k: Unit = g(V3((None, None)))\n" + OUT,
    )).toEqual([]);
    // Position by position: a head every alternative writes, and an arrow every one writes beside a type parameter.
    const heads = "union L(a) =\n    | X(xs: Vector(a), o: Option(a))\n    | Y(xs: Vector(a), o: Option(a))\n";
    for (const arm of ["X(xs, _) | Y(xs, _) => xs.length()", "X(_, o) | Y(_, o) => if o.isSome() then 1 else 0"]) {
      expect([arm, messages(heads + `let g(l) = match l\n    ${arm}\nexport let k: Int = g(X([1], None))\n` + OUT)])
        .toEqual([arm, []]);
    }
    const beside = "union P(a) =\n    | X(p: (() -> Unit, a))\n    | Y(p: (() -> Unit, a))\n";
    expect(messages(
      WORLD + beside + "let g(v) = match v\n    X(p) | Y(p) =>\n        let h: (() ->! Unit, Int) = p\n        ()\n" +
        "export let k: Unit = g(X((noop, 1)))\n" + OUT,
    )).toEqual([]);
    // An arrow a union's slot writes on one path keeps that reading on every path.
    const mixed = "record R = {f: (() ->! Unit) -> Unit}\nrecord S = {run: (() -> Unit) -> Unit}\n";
    for (
      const [alternatives, expected] of [
        ["union W =\n    | X(r: R)\n    | Y(f: (() ->! Unit) -> Unit)\n", [FIXED]],
        ["union W =\n    | X(r: R)\n    | Y(r: R)\n", []],
      ] as const
    ) {
      const arm = alternatives.includes("Y(f") ? "X(R({f = f})) | Y(f)" : "X(R({f = f})) | Y(R({f = f}))";
      expect([arm, messages(WORLD + mixed + alternatives + `let g(w) = match w\n    ${arm} => ignore(S({run = f}))\n` + OUT)])
        .toEqual([arm, expected]);
    }
    // Alternatives that write the name different types are refused, and that is the one report, as over a typed value.
    for (
      const [x, y, body, report] of [
        ["Int", "String", "ignore(n.show())", "type mismatch: expected Int, found String"],
        ["Vector(Int)", "Set(Int)", "ignore(n.length())", "type mismatch: expected Vector(Int), found Set(Int)"],
        [
          "() -> Unit",
          "(Int, Int)",
          "\n        let h: () ->! Unit = n\n        ()",
          "type mismatch: expected () -> Unit, found (Int, Int)",
        ],
        [
          "Vector(() -> Unit)",
          "Option(a)",
          "\n        let h: Vector(() ->! Unit) = n\n        ()",
          "type mismatch: expected Vector(() -> Unit), found Option(a)",
        ],
        [
          "(Int) -> (() -> Unit)",
          "(Int, a) -> Int",
          "\n        let h: (Int) ->! (() ->! Unit) = n\n        ()",
          "function arity mismatch: 1 and 2",
        ],
      ] as const
    ) {
      const source = WORLD + `union XY(a) =\n    | X(n: ${x})\n    | Y(n: ${y})\n` + `let g(v) = match v\n    X(n) | Y(n) => ${body}\n` + OUT;
      expect([x, y, messages(source)]).toEqual([x, y, [report]]);
    }
    // A name one alternative takes from a type parameter is the value's on that path, in either order, beneath a
    // head they all write too.
    const nothing = "union R(a) =\n    | P(p: a)\n    | Q(q: {n: Int})\n";
    for (const arm of ["Q({n = n}) | P({n = n})", "P({n = n}) | Q({n = n})"]) {
      expect([arm, messages(nothing + `let g(v) = match v\n    ${arm} => n.show()\n` + OUT)]).toEqual([arm, [undecided("n", "show")]]);
    }
    const result = "union XY(a) =\n    | X(f: () -> (() -> Unit))\n    | Y(f: () -> a)\n";
    for (const arm of ["X(f) | Y(f)", "Y(f) | X(f)"]) {
      const source = WORLD + result + `let g(v) = match v\n    ${arm} =>\n        let h: () ->! (() ->! Unit) = f\n        ()\n` + OUT;
      expect([arm, messages(source)]).toEqual([arm, [FIXED]]);
    }
    const one = "union XZ(a) =\n    | X(n: Int)\n    | Z(n: a)\n";
    expect(messages(one + "let g(v) = match v\n    X(n) | Z(n) => n.show()\nexport let k: String = g(X(1))\n" + OUT))
      .toEqual([undecided("n", "show")]);
  });

  test("a constructor the type its position meets names is read only where the declarations above write that type", () => {
    const files = (source: string): readonly string[] =>
      compileFiles([
        ["/main.hex", HEADER + WORLD + "import M1\nimport M2\n" + source + OUT],
        ["/m1.hex", "module M1\n\nexport union W1 =\n    | WC(f: () -> Unit)\n"],
        ["/m2.hex", "module M2\n\nexport union W2 =\n    | WC(n: Int)\n"],
      ]).diagnostics.map(({ message }) => message);
    // Beneath a slot written as a type parameter, another line chose `WC`: what it writes is the value's.
    const param = "union T(a) =\n    | T(x: a)\n";
    expect(files(param + "let g(t) =\n    let q: T(M2.W2) = t\n    match t\n        T(WC(n)) => n.show()\n"))
      .toEqual([undecided("n", "show")]);
    for (
      const arm of [
        "T(WC(f)) =>\n            let h: () ->! Unit = f\n            ()",
        "T(WC((f: () ->! Unit))) => f!()",
      ]
    ) {
      expect([arm, files(param + `let g(t) =\n    let q: T(M1.W1) = t\n    match t\n        ${arm}\n`)]).toEqual([arm, [FIXED]]);
    }
    // Written qualified, or beneath a slot that writes its union, it is the text's.
    expect(files(param + "let g(t) = match t\n    T(M2.WC(n)) => n.show()\n")).toEqual([]);
    expect(files("union T2 =\n    | T2(x: M2.W2)\nlet g(t) = match t\n    T2(WC(n)) => n.show()\n")).toEqual([]);
    expect(files(
      "union T3 =\n    | T3(x: M1.W1)\nlet g(t) = match t\n    T3(WC(f)) =>\n        let h: () ->! Unit = f\n        ()\n",
    )).toEqual([]);
  });

  test("in a `let`, a `for` head and a lambda's parameter, as at an arm", () => {
    const one = "union One =\n    | One(f: () -> Unit)\n";
    for (
      const source of [
        "let g(u) =\n    let One((f: () ->! Unit)) = u\n    f!()\nexport let k: Unit = g!(One(noop))\n",
        "let g(us) =\n    for One((f: () ->! Unit)) in us\n        f!()\nexport let k: Unit = g!([One(noop)])\n",
        "let k: (One) ->! Unit = ((One((f: () ->! Unit)))) => f!()\n",
        "let g(u) =\n    let One(f) = u\n    let h: () ->! Unit = f\n    h!()\nexport let k: Unit = g!(One(noop))\n",
      ]
    ) {
      expect(messages(WORLD + one + source + OUT)).toEqual([]);
    }
  });
});
