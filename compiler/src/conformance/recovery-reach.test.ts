import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **where §4.4's recovery stands** (#1115): Effects §4.4, and
 * §3.4's defaulting clause at calls.
 *
 * A refused `->?` recovers as the impure constant, marked, and binds nothing it
 * meets. What reads as that recovery is decided in three places, and in each
 * the recovery yields to anything real, so no outcome depends on the order in
 * which a program's parts meet:
 *
 * - an annotation that wrote it declares the name or result at it (ruling D1);
 * - a colour several values share — a callee's instantiation, a form's paths —
 *   is decided by any real colour that reaches it, the pure constant included
 *   (ruling D2 (a)), and is the recovery only where nothing real does;
 * - a body's own colour takes a real impure call before a recovered one, and a
 *   written `->?` on the body is left as it was (row 7, ruled as intended).
 *
 * Every program is checked beside the one refusal the fixture makes, and most
 * owe nothing else: the recovery is scaffolding, not a second claim.
 */

const HEADER = "module Main\n\n";
const FIXTURES =
  'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n' +
  "type Step = () ->? Unit\n" +
  'let save0(): Unit = save!("x")\n' +
  "export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n" +
  "export let pick(f: () ->! Unit): () ->? Unit = f\n";

const files = (source: string): [string, string][] => [
  ["/main.hex", HEADER + FIXTURES + source],
  ["/world.js", ""],
];

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly [string, string])[] {
  const text = HEADER + FIXTURES + source;
  return compileFiles(files(source)).diagnostics.map(({ primary, message }) =>
    [text.slice(primary.start.offset, primary.end.offset), message] as const
  );
}

/** What a hover at the last place `needle` is written shows as the type there. */
function hovered(source: string, needle: string): string | undefined {
  const text = HEADER + FIXTURES + source;
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", text);
  return session.hover("/main.hex", text.lastIndexOf(needle))?.displayedType;
}

/** The `.d.ts` documentation line published for `name`. */
function published(source: string, name: string): string | undefined {
  const main = compileFiles(files(source)).modules.find((module) => module.source.path === "/main.hex");
  const lines = (main?.declarations.text ?? "").split("\n");
  const at = lines.findIndex((line) => new RegExp(`\\b${name}\\b`, "u").test(line) && !line.includes("*"));
  return lines.slice(0, at).reverse().find((line) => line.includes("Hexagon:"))?.trim();
}

/** §4.4's alias refusal — the fixture's `type Step`. */
const REFUSAL = [
  "->?",
  "`->?` is the caller's colour, and this position has no caller to choose it — " +
  "an alias is a type fragment, not a signature; " +
  "write `->!` for a function that pulls the world, or `->` for one that does not",
] as const;

const wantsBang = (subject: string, at: string): readonly [string, string] =>
  [at, `this call may touch the world, so ${subject} wants \`!\`, not no mark`];
const wantsNoMark = (subject: string): readonly [string, string] =>
  ["!", `this call is pure, so ${subject} wants no mark, not \`!\``];

describe("an annotation that wrote the recovery declares the name at it (#1115, D1)", () => {
  test("a binding annotated with the refused alias reads as the recovery", () => {
    const source = `export let outer(action: () ->! Unit): Unit =
    let s: Step = action
    s!()
`;
    expect(reports(source)).toEqual([REFUSAL]);
    expect(hovered(source, "s!()")).toBe("() ->! Unit");
  });

  test("so does one in an instance body, under a linked contract", () => {
    expect(reports(`constraint Runner<r> =
    run(runner: r, action: () ->! Unit) ->? Unit

export record Job = { id: Int }

honor Runner<Job> =
    run(job, action) =
        let s: Step = action
        s!()
        action!()
`)).toEqual([REFUSAL]);
  });

  test("a return annotation declares the result at the recovery", () => {
    const named = `export let outer(n: Int): Int =
    fun h(): Step = () => ()
    h()!()
    n
`;
    expect(reports(named)).toEqual([REFUSAL]);
    expect(hovered(named, "h()!")).toBe("() -> () ->! Unit");
    expect(reports(`export let outer(n: Int): Int =
    let mk = (): Step => () => ()
    mk()!()
    n
`)).toEqual([REFUSAL]);
  });

  test("a block's final value and an ascription reach it as a lambda directly under it does", () => {
    expect(reports(`export let outer(n: Int): Int =
    let h: Step =
        let x = 1
        () => ()
    h!()
    n
`)).toEqual([REFUSAL]);
    const ascribed = `export let outer(n: Int): Int =
    let h = ((() => ()) : Step)
    h!()
    n
`;
    expect(reports(ascribed)).toEqual([REFUSAL]);
    expect(hovered(ascribed, "h!()")).toBe("() ->! Unit");
  });

  test("the annotation decides over a real value's colour", () => {
    // The value is `->!`, which would demand `s!()`; the name is declared at
    // `Step`, and that demand holds under one repair of the alias only.
    expect(reports(`export let outer(n: Int): Unit =
    let s: Step = save0
    s()
`)).toEqual([REFUSAL]);
  });

  test("a recovered arrow inside a written container is the name's, and nothing else moves", () => {
    const option = `export let outer(action: () ->! Unit): Unit =
    let o: Option(Step) = Some(action)
    match o
        Some(g) => g!()
        None => ()
`;
    expect(reports(option)).toEqual([REFUSAL]);
    expect(hovered(option, "o:")).toBe("Option(() ->! Unit)");
    expect(hovered(`export let outer(action: () ->! Unit): Unit =
    let p: (Step, Int) = (action, 1)
    ()
`, "p:")).toBe("(() ->! Unit, Int)");
  });

  test("an annotated `var` is declared at it as an annotated `let` is", () => {
    expect(reports(`export let outer(action: () ->! Unit): Unit =
    var r: Option(Step) = Some(action)
    match r
        Some(g) => g!()
        None => ()
`)).toEqual([REFUSAL]);
  });
});

describe("a shared colour takes the recovery only where nothing real reaches it (#1115, D2)", () => {
  test.each([
    ["apply2(s, save0)", "apply2(save0, s)"],
    ['apply2(s, () => save!("y"))', 'apply2(() => save!("y"), s)'],
  ])("a real `->!` argument decides the callee's colour in either order: %s", (first, second) => {
    for (const call of [first, second]) {
      expect(reports(`export let go(s: Step): Unit = ${call}\n`)).toEqual([
        REFUSAL,
        wantsBang("`apply2`", call),
      ]);
    }
  });

  test("a written `->?` argument is left as it was, and the face is published in either order", () => {
    for (const call of ["apply2!(s, action)", "apply2!(action, s)"]) {
      const source = `export let outer(action: () ->! Unit, s: Step): Unit = ${call}\n`;
      expect(reports(source)).toEqual([REFUSAL]);
      expect(hovered(source, "outer(")).toBe("(() ->! Unit, () ->! Unit) ->? Unit");
      expect(published(source, "outer")).toBe("/** Hexagon: `(() ->! Unit, () ->! Unit) ->? Unit` */");
    }
  });

  test.each([
    ["if True then s else save0", "if True then save0 else s"],
    ["match True\n        True => s\n        False => save0", "match True\n        True => save0\n        False => s"],
    ["try s catch\n        _ => save0", "try save0 catch\n        _ => s"],
    ["if True then (if False then s else s) else save0", "if True then save0 else (if False then s else s)"],
  ])("a form's real path decides its colour in either order: %s", (first, second) => {
    for (const form of [first, second]) {
      expect(reports(`export let go(s: Step): Unit =
    let g = ${form}
    g()
`)).toEqual([REFUSAL, wantsBang("`g`", "g()")]);
    }
  });

  test("and inside the containers a form joins", () => {
    for (const form of ["if True then Some(s) else Some(save0)", "if True then Some(save0) else Some(s)"]) {
      expect(reports(`export let go(s: Step): Unit =
    let o = ${form}
    match o
        Some(g) => g()
        None => ()
`)).toEqual([REFUSAL, wantsBang("`g`", "g()")]);
    }
    for (const form of ["if True then (s, 1) else (save0, 2)", "if True then (save0, 2) else (s, 1)"]) {
      expect(reports(`export let go(s: Step): Unit =
    let (g, n) = ${form}
    g()
`)).toEqual([REFUSAL, wantsBang("`g`", "g()")]);
    }
  });

  test("and among the arguments a call reads against one bare type variable", () => {
    for (const call of ["first(s, save0)", "first(save0, s)"]) {
      expect(reports(`export let first<a>(x: a, y: a): a = x

export let go(s: Step): Unit =
    let g = ${call}
    g()
`)).toEqual([REFUSAL, wantsBang("`g`", "g()")]);
    }
  });

  test("and among a vector literal's elements, lambdas included", () => {
    for (const elements of ["[s, save0]", "[save0, s]", '[() => s(), () => save!("y")]', '[() => save!("y"), () => s()]']) {
      expect(reports(`export let go(s: Step): Unit =
    match ${elements}
        [g, _] => g()
        _ => ()
`)).toEqual([REFUSAL, wantsBang("`g`", "g()")]);
    }
  });

  test("a written `->?` that joins a colour the recovery reached first keeps its face", () => {
    // `pick(s)`'s colour is the recovery's before `action`'s written `->?`
    // joins it; the one colour is then the signature's, and the face it
    // publishes is the one it writes (review round 1, BLOCKER 1).
    const face = "(() ->! Unit, () ->! Unit) ->? Unit";
    for (const body of [
      "apply2!(action, pick(s))",
      "\n    let g = if True then action else pick(s)\n    g!()",
      "\n    let run = () => apply2!(action, pick(s))\n    run!()",
    ]) {
      const source = `export let outer(action: () ->! Unit, s: Step): Unit = ${body}\n`;
      expect(reports(source)).toEqual([REFUSAL]);
      expect(hovered(source, "outer(")).toBe(face);
    }
    expect(published("export let outer(action: () ->! Unit, s: Step): Unit = apply2!(action, pick(s))\n", "outer"))
      .toBe(`/** Hexagon: \`${face}\` */`);
    const knot = `export let outer(action: () ->! Unit, s: Step): Unit =
    fun
        a(m: Int): Unit = if m == 0 then apply2!(action, pick(s)) else b!(m)
        b(m: Int): Unit = a!(m - 1)
    a!(1)
`;
    expect(reports(knot)).toEqual([REFUSAL]);
    expect(hovered(knot, "outer(")).toBe(face);
  });

  test("under a written face, a form's real path pins it in either order", () => {
    // The paths meet the face one at a time (#1107) and then join: the join
    // publishes `save0`'s `->!`, not the recovery `s` brings, and the written
    // `->?` it reaches is pinned whichever path is written first.
    const pin = [
      "this signature's `->?` promises a colour the caller chooses, but the body solves it " +
      "to the impure constant — a function that performs its own unconditional effects " +
      "rounds up, and its face is `->!`",
    ];
    for (const form of ["if True then s else save0", "if True then save0 else s"]) {
      const source = `export let outer(action: () ->! Unit, s: Step): Unit =
    let g: () ->? Unit = ${form}
    action!()
`;
      expect(reports(source)).toEqual([REFUSAL, [form, ...pin]]);
    }
  });

  test("under a written vector face, the elements join in either order (review round 2)", () => {
    // Each element meets the face on its own (#1107) and then they join one
    // another, each bringing its recovery as a marked variable: the report is
    // the one the alias-free literal draws, whichever element comes first.
    const purity = "a `->` arrow promises purity, and this function performs effects — the demand " +
      "is written `->`, the function's face `->?` or `->!`";
    const solvedImpure = "this signature's `->?` promises a colour the caller chooses, but the body " +
      "solves it to the impure constant — a function that performs its own unconditional effects " +
      "rounds up, and its face is `->!`";
    const at = (face: string, elements: string): string =>
      `export let outer(action: () ->! Unit, s: Step): Unit =
    let v: Vector(${face}) = ${elements}
    action!()
`;
    for (const [face, first, second, report] of [
      ["() -> Unit", "[s, save0]", "[save0, s]", ["Vector(() -> Unit)", purity]],
      ["() ->! Unit", "[s, action]", "[action, s]", ["Vector(() ->! Unit)", solvedImpure]],
      ["() ->? Unit", "[s, save0]", "[save0, s]", undefined],
    ] as const) {
      for (const elements of [first, second]) {
        expect(reports(at(face, elements))).toEqual([
          REFUSAL,
          report ?? [elements, solvedImpure],
        ]);
      }
    }
    // A pure lambda fits a `->!` face beside the recovery, as it would alone
    // (#1119): the one report is the alias's.
    for (const elements of ["[s, () => ()]", "[() => (), s]"]) {
      expect(reports(at("() ->! Unit", elements))).toEqual([REFUSAL]);
    }
    // The pure lambda decides a `->` face's colour with the recovery, as it
    // would alone.
    for (const elements of ["[s, () => ()]", "[() => (), s]"]) {
      expect(reports(at("() -> Unit", elements))).toEqual([REFUSAL]);
    }
    // At an argument and a return annotation, as at a binding.
    for (const elements of ["[s, save0]", "[save0, s]"]) {
      expect(reports(`export let takeV(v: Vector(() -> Unit)): Unit = ()
export let outer(s: Step): Unit = takeV(${elements})
`)).toEqual([REFUSAL, [`takeV(${elements})`, purity]]);
      expect(reports(`export let go(s: Step): Vector(() -> Unit) = ${elements}\n`))
        .toEqual([REFUSAL, ["Vector(() -> Unit)", purity]]);
    }
    // Three elements: the later two meet each other through the recovery's
    // marked colour, and the pin stands where the alias-free literal puts it.
    for (const [elements, pinned] of [
      ["[s, action, save0]", "save0"],
      ["[action, s, save0]", "save0"],
      ["[s, save0, action]", "action"],
    ] as const) {
      expect(reports(at("() ->? Unit", elements))).toEqual([REFUSAL, [pinned, solvedImpure]]);
    }
  });

  test("at any depth of a form, a later path's real colour decides in either order", () => {
    // The recovery a first path brings is no home the later paths are absorbed
    // into (review round 1, MAJOR 2): the inner `if`'s impure path decides the
    // whole form — its pure path fits beside it (#1119) — whichever side of the
    // outer form the recovery stands on, so the bare call on it is the report.
    const clash = ["g()", "this call may touch the world, so `g` wants `!`, not no mark"] as const;
    for (const form of [
      "if True then s else (if False then (() => ()) else save0)",
      "if True then (if False then (() => ()) else save0) else s",
      "try s catch\n        _ => (if False then (() => ()) else save0)",
    ]) {
      expect(reports(`export let go(s: Step): Unit =
    let g = ${form}
    g()
`)).toEqual([REFUSAL, clash]);
    }
  });

  test("the recovery decides a colour it shares with a pure function, in either order (#1119)", () => {
    // A pure function adds nothing to a colour it shares, so what the recovery
    // reached and nothing real did is the recovery: `apply2!` and `g!()` owe
    // no mark report, whichever order the two arrive in. (Before #1119 the
    // pure one decided, #1115 D2 (a).)
    for (const call of ["apply2!(s, () => ())", "apply2!(() => (), s)"]) {
      expect(reports(`export let go(s: Step): Unit = ${call}\n`)).toEqual([REFUSAL]);
    }
    for (const form of ["if True then s else (() => ())", "if True then (() => ()) else s"]) {
      expect(reports(`export let go(s: Step): Unit =
    let g = ${form}
    g!()
`)).toEqual([REFUSAL]);
    }
  });

  test("a colour only the recovery reaches is the recovery, whatever mark reads it", () => {
    const bare = "export let go(s: Step): Unit = apply2(s, s)\n";
    expect(reports(bare)).toEqual([REFUSAL]);
    expect(hovered(bare, "go(")).toBe("(() ->! Unit) ->! Unit");
    expect(reports("export let go(s: Step): Unit = apply2!(s, s)\n")).toEqual([REFUSAL]);
  });

  test("it is the recovery before the body's arms read it, so a conduit body does not claim it", () => {
    // Left a variable, the conduit arm would make the call's colour the
    // body's, which `action!()` links to the header's `->?` — and `apply2!`
    // would be asked for a `?` the recovery's reading does not owe.
    const conduit = `export let outer(action: () ->! Unit, s: Step): Unit =
    action!()
    apply2!(s, s)
`;
    expect(reports(conduit)).toEqual([REFUSAL]);
    expect(hovered(conduit, "outer(")).toBe("(() ->! Unit, () ->! Unit) ->! Unit");
    expect(reports(`constraint Runner<r> =
    run(runner: r, action: () ->! Unit) ->? Unit

export record Job = { id: Int }

honor Runner<Job> =
    run(job, action) =
        let s: Step = action
        apply2!(s, s)
        action!()
`)).toEqual([REFUSAL]);
  });

  test("it moves with the variable it joins", () => {
    // `pick(h)` hands `apply2` a colour of `h`'s, still a variable when the
    // recovery's reaches it: the two are one colour, and it is the recovery.
    const source = `export let outer(s: Step): Unit =
    let run = (h) => apply2!(s, pick(h))
    ()
`;
    expect(reports(source)).toEqual([REFUSAL]);
    expect(hovered(source, "run =")).toBe("(() ->! Unit) ->! Unit");
  });

  test("a knot's members and a module-level call reach it as a lone body does", () => {
    const knot = `fun
    a(s: Step, m: Int): Unit = if m == 0 then apply2!(s, s) else b!(s, m)
    b(s: Step, m: Int): Unit = a!(s, m - 1)
`;
    expect(reports(knot)).toEqual([REFUSAL]);
    expect(hovered(knot, "b(s")).toBe("(() ->! Unit, Int) ->! Unit");
    expect(reports(`export let outer(n: Int): Unit =
    fun
        a(s: Step): Unit = apply2!(s, s)
        b(s: Step): Unit = a!(s)
    ()
`)).toEqual([REFUSAL]);
    // No body encloses a module-level binding's call: its colour meets the
    // defaulting clause only where marks are checked.
    expect(reports(`let sTop: Step = save0
let r = apply2!(sTop, sTop)
`)).toEqual([REFUSAL]);
  });

  test("it is settled before a binding would generalize it, and a later use meets it as any recovery", () => {
    const source = `export let go(s: Step): Unit =
    let k = pick(s)
    k!()
`;
    expect(reports(source)).toEqual([REFUSAL]);
    expect(hovered(source, "k!()")).toBe("() ->! Unit");
    for (const call of ["apply2(k, save0)", "apply2(save0, k)"]) {
      expect(reports(`export let go(s: Step): Unit =
    let k = pick(s)
    ${call}
`)).toEqual([REFUSAL, wantsBang("`apply2`", call)]);
    }
  });
});

describe("a body's own colour counts a recovered call as the constant it reads as (#1115)", () => {
  test.each([
    ['s()\n        save!("x")'],
    ['save!("x")\n        s()'],
  ])("a real impure call decides before a recovered one, in either order", (body) => {
    const source = `export let outer(s: Step): Unit =
    let f = () =>
        ${body}
    f()
`;
    expect(reports(source)).toEqual([REFUSAL, wantsBang("`f`", "f()")]);
    expect(hovered(source, "f()")).toBe("() ->! Unit");
  });

  test("a recovered call alone makes the body the recovery", () => {
    for (const call of ["f()", "f!()"]) {
      expect(reports(`export let outer(s: Step): Unit =
    let f = () => s()
    ${call}
`)).toEqual([REFUSAL]);
    }
  });

  test("a written `->?` on the body is left as it was, so a pure callback makes its call pure", () => {
    // Ruled as intended (#1115, row 7): the recovery leaves `f`'s written face,
    // and the call reads that face with a pure callback — §4.4's "no face,
    // colour, or mark outside the refused position changes on the recovery's
    // account".
    const source = `export let outer(n: Int): Int =
    let h: Step = () => ()
    let f: (() ->! Unit) ->? Unit = (cb) =>
        h!()
        cb!()
    f!(() => ())
    n
`;
    expect(reports(source)).toEqual([REFUSAL, wantsNoMark("`f`")]);
    expect(hovered(source, "f!(")).toBe("(() ->! Unit) ->? Unit");
  });

  test("a knot member calling through the recovered alias is the recovery, and so is its sibling", () => {
    const source = `export let go(n: Int): Unit =
    fun
        a(): Unit =
            let s: Step = b
            s!()
        b(): Unit = a!()
    a!()
`;
    expect(reports(source)).toEqual([REFUSAL]);
    expect(hovered(source, "a!()")).toBe("() ->! Unit");
    expect(hovered(source, "b(): Unit")).toBe("() ->! Unit");
  });
});
